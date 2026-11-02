#!/usr/bin/env node
// qoder-purge.mjs — apply dsh-purge-style purge patches to Qoder CN (VS Code fork) app.asar.
//
// Three layers, mirroring dsh-purge:
//   1. Prompt layer: the three agent system-prompt constants in electronMain.js are
//      stored behind the obfuscator string table (function QJ + rotation IIFE + decoder _,
//      wrapper n(t,x)=_(t-233,x)). We decode the rotated table, find the three prompt
//      entries by content marker, and replace EVERY wrapper call site n(T) / n(T,digits)
//      with a JSON string literal carrying the purge prompt.
//   2. Permission layer: every `permissionMode:<wrapper>(<n>[,<m>])` site (any obfuscator
//      cluster) is rewritten to `permissionMode:"bypassPermissions"` (Full Access).
//   3. Fuse layer: if the Electron binary enables EnableEmbeddedAsarIntegrityValidation,
//      flip that fuse byte to disabled (0x31 -> 0x30), backup exe first.
//
// Safety rails: marker /*__QODER_PURGE__*/ (idempotent), .purge-orig backups, structural
// verification (re-extract + hash compare) before the patched asar replaces the original.
// Swap mirrors dsh-purge official-update: occupied() scans the version dir; leftover
// holders abort-busy; live asar is renamed aside first (isolate), never rmSync'd.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AsarFile, walkFiles, buildRebuilt, writeRebuilt } from './asar-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const QODER_ROOT = process.env.QODER_ROOT || 'D:/Users/onemt/AppData/Local/Programs/Qoder CN';
const VERSIONS_DIR = path.join(QODER_ROOT, '.qoder-versions');
const PURGE_MD = path.join(__dirname, 'purge-prompt.zh.md');
const MAIN_ENTRY = 'out/main/electronMain.js';
const LOG_FILE = path.resolve(__dirname, '../../tmp-qoder/qoder-purge.log');
const MARKER = '/*__QODER_PURGE__*/';
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const TASK_NAME = 'QoderPurgeReapply';

const PROMPT_MARKERS = [
  { key: 'main_coding', starts: 'You are an interactive agent that helps users with software engineering tasks' },
  { key: 'desktop_instructions', starts: '# Qoder Desktop instructions' },
  { key: 'persona', starts: 'You are Qoder, a desktop agentic assistant' },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
  if (!process.env.QODER_PURGE_QUIET) console.log(msg);
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function die(msg) { console.error(`[qoder-purge] ${msg}`); process.exit(1); }

// ---------- install discovery ----------
// 0.5.1 起 Qoder 改成「根目录即当前版本」：<root>/resources/app.asar 是正在跑的 0.5.1，
// 而 .qoder-versions/ 里只剩历史版本（0.4.11 等）。旧版只扫 .qoder-versions，
// 于是 --verify 对着已经打过补丁的 0.4.11 报 "current"，而真正在跑的 0.5.1 一个字没动
// —— 假绿。这里把根安装也算成候选，按版本号取最大。
function readRootVersion(root) {
  for (const rel of ['resources/build-manifest.json', 'resources/app/package.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      const v = j.productVersion || j.version;
      if (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) return v;
    } catch { /* 下一个 */ }
  }
  return '';
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.\-+]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.\-+]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 所有「带 resources/app.asar」的安装目录，按版本号从新到旧。 */
function listInstalls() {
  const out = [];
  const push = (dir, version, source) => {
    const asarPath = path.join(dir, 'resources', 'app.asar');
    if (!fs.existsSync(asarPath)) return;
    out.push({ dir, version: version || '0', source, asarPath, exePath: path.join(dir, 'Qoder CN.exe') });
  };
  if (fs.existsSync(QODER_ROOT)) push(QODER_ROOT, readRootVersion(QODER_ROOT), 'root');
  if (fs.existsSync(VERSIONS_DIR)) {
    for (const name of fs.readdirSync(VERSIONS_DIR)) {
      const dir = path.join(VERSIONS_DIR, name);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
      push(dir, name, 'versions');
    }
  }
  out.sort((a, b) => cmpVersion(b.version, a.version));
  return out;
}

function findLatestVersion() {
  const all = listInstalls();
  if (!all.length) die(`no install with resources/app.asar under ${QODER_ROOT}`);
  return all[0].dir;
}

function qoderRunning() {
  const names = ['Qoder CN.exe', 'Qoder.exe', 'Qoder CN Launcher.exe'];
  for (const n of names) {
    try {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${n}" /FO CSV /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (out && out.toLowerCase().includes(n.toLowerCase().replace('.exe', ''))) return n;
    } catch { /* ignore */ }
  }
  return null;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function underDir(fp, dir) {
  const a = path.resolve(fp).replace(/\//g, '\\').toLowerCase();
  const b = path.resolve(dir).replace(/\//g, '\\').toLowerCase();
  const root = b.endsWith('\\') ? b : `${b}\\`;
  return a === b || a.startsWith(root);
}

function occupied(verDir) {
  const out = [];
  let raw = '';
  try {
    const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { "{0}`t{1}`t{2}" -f $_.ProcessId, $_.Name, $_.ExecutablePath }';
    raw = execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 20000,
    });
  } catch { return out; }
  for (const line of String(raw).split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const name = parts[1];
    const pth = parts.slice(2).join('\t').trim();
    if (!Number.isFinite(pid) || !pth) continue;
    if (underDir(pth, verDir)) out.push({ pid, name, path: pth });
  }
  return out;
}

function killAll(items) {
  for (const it of items) {
    log(`[kill] pid=${it.pid} ${it.name} ${it.path}`);
    try { execSync(`taskkill /F /T /PID ${it.pid}`, { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
  }
}

/** Interactive: kill then die abort-busy. --auto: skip, never kill. Returns 'skip' or undefined. */
function ensureUnoccupied(verDir, { auto = false } = {}) {
  let holders = occupied(verDir);
  if (!holders.length) return;
  if (auto) {
    const first = holders[0];
    log(`[auto] abort-busy ${first.name} ${first.path}; skip this round`);
    return 'skip';
  }
  log(`[busy] ${holders.length} process(es) hold ${verDir}; killing`);
  killAll(holders);
  const deadline = Date.now() + 8000;
  holders = occupied(verDir);
  while (holders.length && Date.now() < deadline) {
    sleep(250);
    holders = occupied(verDir);
  }
  if (holders.length) {
    const first = holders[0];
    die(`abort-busy ${first.name} ${first.path}`);
  }
}

/** Rename live aside first, then drop in tmp. Never rmSync the live asar. */
function swapAsarIsolated(live, tmp) {
  const prev = `${live}.purge-swap-prev`;
  if (fs.existsSync(prev)) {
    try { fs.rmSync(prev); } catch {
      const leftover = `${live}.purge-failed-${Date.now()}`;
      fs.renameSync(prev, leftover);
      log(`[isolate] leftover swap-prev -> ${path.basename(leftover)}`);
    }
  }
  try {
    fs.renameSync(live, prev);
  } catch (e) {
    throw new Error(`abort-busy isolate live asar failed: ${e.message}`);
  }
  try {
    fs.renameSync(tmp, live);
  } catch (e) {
    try { fs.renameSync(prev, live); } catch (re) {
      throw new Error(`swap failed and restore failed: ${e.message}; ${re.message}`);
    }
    throw new Error(`swap failed, restored from isolate: ${e.message}`);
  }
  try {
    fs.rmSync(prev);
  } catch {
    const isolated = `${live}.purge-failed-${Date.now()}`;
    try {
      fs.renameSync(prev, isolated);
      log(`[isolate] old asar -> ${path.basename(isolated)}`);
    } catch {
      log(`[isolate] old asar left at ${path.basename(prev)}`);
    }
  }
}

// ---------- string-table decoder (rotate2.mjs semantics) ----------

function buildDecoder(src) {
  // The self-memoizing string table: function QJ(){const t=[...];return QJ=function(){return t},QJ()}
  // A naive `function NAME(){const X=[` also matches unrelated helpers, so require the
  // self-reassignment tail right after the array's closing bracket.
  const qjName = (() => {
    const re = /function (\w+)\(\)\{const (\w+)=\[/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1;
      const close = src.indexOf(']', open);
      if (close < 0) continue;
      const tail = src.slice(close + 1, close + 80);
      const tailM = tail.match(new RegExp(`;return ${m[1]}=function\\(\\)\\{return ${m[2]}\\},${m[1]}\\(\\)`));
      if (tailM) return m[1];
    }
    return null;
  })();
  if (!qjName) throw new Error('string table QJ not found');

  const decM = src.match(new RegExp(`function (\\w+)\\(t,x\\)\\{t=t-(\\d+);const \\w+=${qjName}\\(\\)`));
  if (!decM) throw new Error('decoder _ not found');
  const decName = decM[1];
  const decOffset = Number(decM[2]);

  const wrapM = src.match(new RegExp(`function (\\w+)\\(t,x\\)\\{return ${decName}\\(t-(\\d+),x\\)\\}`));
  // 0.5.1 起不再有 `wrapper(t,x){return DEC(t-K,x)}` 这种形态（索引被挪到第二参数、
  // 且同名 wrapper 有上千个定义）。这里只做「有就用」：真正的补丁路径改成换表项，
  // 不依赖 wrapper。没有就报 none，让 report 里能看出用的是哪条路径。
  const wrapName = wrapM ? wrapM[1] : null;
  const wrapOffset = wrapM ? Number(wrapM[2]) : null;

  const open = src.indexOf('[', src.indexOf(`function ${qjName}(){`));
  const close = src.indexOf(']', open);
  const tbl = JSON.parse(src.slice(open, close + 1));

  // custom charset from decoder body (65-char b64 variant, double-quoted in source)
  const body = src.slice(decM.index, decM.index + 3000);
  const csM = body.match(/"([A-Za-z0-9+/=]{60,80})"/);
  if (!csM) throw new Error('decoder charset literal not found');
  const CS = csM[1];

  function v(b) {
    const r = tbl[0];
    if (b === undefined) return undefined;
    let s = '';
    let bits = 0, acc = 0;
    for (const ch of b) {
      const idx = CS.indexOf(ch);
      if (idx < 0 || idx === 64) { if (idx === 64) break; continue; }
      acc = (acc << 6) | idx; bits += 6;
      if (bits >= 8) {
        bits -= 8;
        s += String.fromCharCode((acc >> bits) & 0xff);
      }
    }
    try { return decodeURIComponent(escape(s)); } catch { return s; }
  }
  const dec = (t) => v(tbl[t - decOffset]);

  // rotation IIFE 只对「按索引找调用点」的旧路径有用：它把表原地旋转，让 n(T) 的 T
  // 落到正确的表项上。补丁路径已改成直接换表项（见 patchMain），表项内容与顺序无关，
  // 所以这里**默认不跑**旋转。
  //
  // 不跑的理由不只是省时间：0.5.1 的 IIFE 是 `for(;;) try { ...checksum... } catch
  // { t.push(t.shift()) }`，旋转 243580 次、表 57809 项 —— 一旦校验和永远不成立就是
  // 死循环，实测把 --check 挂住 10 分钟以上。旧代码把它当必经步骤，等于给 0.5.1
  // 埋了一个静默 hang。需要旧路径时用 QODER_PURGE_ROTATE=1 显式打开。
  let rotated = false;
  if (process.env.QODER_PURGE_ROTATE === '1') {
    const tailRe = new RegExp(`\\}\\)\\(${qjName},(\\d+)\\)`);
    const tailM = src.match(tailRe);
    if (!tailM) throw new Error('rotation IIFE tail not found');
    const headIdx = src.lastIndexOf('(function(', tailM.index);
    if (headIdx < 0 || tailM.index - headIdx > 4096) throw new Error('rotation IIFE opener not found');
    const iife = src.slice(headIdx, tailM.index + tailM[0].length);
    new Function('_', qjName, iife)(dec, () => tbl);
    rotated = true;
  }

  return { qjName, decName, decOffset, wrapName, wrapOffset, tbl, dec, v, rotated };
}

// ---------- patch core ----------

// 表项编码：与解码器同一套自定义 base64（charset 从解码器体内取）。
// 之所以要它：0.5.1 起混淆器不再只有一个全局 wrapper（`c(t,x){return x0(x- -271,t)}`
// 把索引放在第二参数，而且同名 wrapper 有 5000 多个定义，靠正则反推索引会命中一堆
// 假调用点）。但**表项本身**仍然是一条唯一的长 base64，且解码后就是整段提示词。
// 直接换表项 → 所有引用它的调用点自动拿到新文本，不必知道谁在引用。集群无关。
function encodeWithCharset(text, CS) {
  const bytes = Buffer.from(text, 'utf8');
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += CS[b0 >> 2];
    out += CS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += CS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += CS[b2 & 63];
  }
  return out;
}

/** 把表源码切成原始元素（base64 字符集里没有 `"` 也没有 `,`，按 `","` 切是安全的）。 */
function splitTableBody(body) {
  if (!body.length) return [];
  return body.split('","');
}

function patchMain(src, purgeText, report) {
  const { decOffset, tbl, v, decName } = buildDecoder(src);
  report.decoder = `${decName}(t-${decOffset}) over table[${tbl.length}]`;

  // 表源码位置（用于就地替换元素）
  const qjName = (() => {
    const re = /function (\w+)\(\)\{const (\w+)=\[/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1;
      const close = src.indexOf(']', open);
      if (close < 0) continue;
      const tail = src.slice(close + 1, close + 90);
      if (new RegExp(`;return ${m[1]}=function\\(\\)\\{return ${m[2]}\\},${m[1]}\\(\\)`).test(tail)) return m[1];
    }
    return null;
  })();
  if (!qjName) throw new Error('string table QJ not found (second pass)');
  const arrOpen = src.indexOf('[', src.indexOf(`function ${qjName}(){`));
  const arrClose = src.indexOf(']', arrOpen);
  const rawElems = splitTableBody(src.slice(arrOpen + 1, arrClose));
  if (rawElems.length !== tbl.length) {
    throw new Error(`table split mismatch: ${rawElems.length} raw vs ${tbl.length} parsed`);
  }
  const CS = (() => {
    const decM = src.match(new RegExp(`function (\\w+)\\(t,x\\)\\{t=t-(\\d+);const \\w+=${qjName}\\(\\)`));
    const body = src.slice(decM.index, decM.index + 3000);
    return body.match(/"([A-Za-z0-9+/=]{60,80})"/)[1];
  })();

  let out = src;
  const promptT = [];
  for (const m of PROMPT_MARKERS) {
    const idx = tbl.findIndex((s) => {
      const d = v(s);
      return typeof d === 'string' && d.startsWith(m.starts);
    });
    if (idx < 0) throw new Error(`prompt marker not found in table: ${m.key}`);
    // 唯一性：同一条 base64 出现两次就没法确定该换哪一个
    const dup = rawElems.filter((s) => s === rawElems[idx]).length;
    if (dup !== 1) throw new Error(`table entry for ${m.key} is not unique (${dup} copies)`);
    const enc = encodeWithCharset(purgeText, CS);
    if (v(enc) !== purgeText) throw new Error(`re-encode roundtrip failed for ${m.key}`);
    const raw = rawElems[idx];
    const hits = out.split(raw).length - 1;
    if (hits !== 1) throw new Error(`raw literal for ${m.key} occurs ${hits}x in source (expected 1)`);
    out = out.split(raw).join(enc);
    promptT.push(`${m.key}@idx${idx}x${hits}`);
  }
  report.promptSites = promptT.join(', ');

  // 2. permission layer: cluster-agnostic syntactic rewrite
  const permRe = /permissionMode:\s*[A-Za-z_$][\w$]*\(\s*\d+(?:\s*,\s*\d+)?\s*\)/g;
  const permHits = out.match(permRe) || [];
  out = out.replace(permRe, 'permissionMode:"bypassPermissions"');
  report.permissionSites = permHits.length;

  // 3. marker
  out = MARKER + '\n' + out;
  report.marker = true;
  return Buffer.from(out, 'utf8');
}

function patchExeFuse(exePath, report) {
  const buf = fs.readFileSync(exePath);
  const sidx = buf.indexOf(Buffer.from(FUSE_SENTINEL, 'ascii'));
  // Electron fuse wire v1: sentinel(32) + version(1) + length(1) + values(N)
  const s32 = sidx + FUSE_SENTINEL.length;
  const version = sidx >= 0 ? buf[s32] : 0;
  const flen = sidx >= 0 ? buf[s32 + 1] : 0; // fuse count byte
  const fbase = sidx >= 0 ? s32 + 2 : 0;     // first fuse value
  const names = ['RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable',
    'EnableNodeCliInspectArguments', 'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar',
    'LoadBrowserProcessSpecificV8Snapshot', 'GrantFileProtocolExtraPrivileges'];
  const val = (b) => b === 0x30 ? 'off' : b === 0x31 ? 'on' : b === 0x52 ? 'removed' : `0x${b.toString(16)}`;
  const parts = [];
  if (sidx < 0) {
    parts.push('sentinel not found (no fuse wire)');
  } else {
    parts.push(`v${version}/${flen} ` + names.slice(0, Math.min(flen, names.length)).map((n, i) => `${n}=${val(buf[fbase + i])}`).join(' '));
  }
  // --- Qoder self-integrity manifest embedded in the exe:
  //     [{"file":"resources\\app.asar","alg":"SHA256","value":"<64hex ascii>"}]
  //     value = sha256 of the asar HEADER JSON (bytes [16 .. 16+J), J = u32@[12..16)).
  //     Keep it in sync after patching the asar, or Electron dies:
  //     FATAL asar_util.cc:144 Integrity check failed for asar archive (manifest vs file).
  let exeChanged = false;
  try {
    const asarPath = path.join(path.dirname(exePath), 'resources', 'app.asar');
    const ab = fs.readFileSync(asarPath);
    const J = ab.readUInt32LE(12);
    const headerSha = crypto.createHash('sha256').update(ab.subarray(16, 16 + J)).digest('hex');
    const MARK = Buffer.from('"file":"resources\\\\app.asar","alg":"SHA256","value":"', 'ascii');
    const midx = buf.indexOf(MARK);
    if (midx >= 0) {
      const voff = midx + MARK.length;
      const cur = buf.toString('ascii', voff, voff + 64);
      if (cur !== headerSha) {
        const bak = exePath + '.purge-orig';
        if (!fs.existsSync(bak)) fs.copyFileSync(exePath, bak);
        buf.write(headerSha, voff, 64, 'ascii');
        // in-place r+ write (exe may be held open by the host, like the asar was)
        const fd = fs.openSync(exePath, 'r+');
        try { fs.writeSync(fd, buf, voff, 64, voff); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        exeChanged = true;
        parts.push(`manifest ${cur.slice(0, 8)}… → ${headerSha.slice(0, 8)}… (exe patched in place, backup: ${path.basename(bak)})`);
      } else {
        parts.push(`manifest already in sync (${headerSha.slice(0, 8)}…)`);
      }
    } else {
      parts.push('no self-integrity manifest found');
    }
  } catch (e) {
    parts.push(`manifest sync skipped (${e.message.slice(0, 80)})`);
  }
  report.fuse = parts.join(' | ');
  return exeChanged;
}

function verifyAsar(newPath, oldAsar, patchedMain, replacedPaths) {
  const na = new AsarFile(newPath);
  try {
    const main = na.readFile(MAIN_ENTRY);
    if (!main.equals(patchedMain)) throw new Error('electronMain.js roundtrip mismatch');
    // spot-check three untouched big files for byte equality
    const others = walkFiles(oldAsar.header)
      .filter(e => !e.node.unpacked && !replacedPaths.includes(e.path))
      .sort((a, b) => b.node.size - a.node.size)
      .slice(0, 3);
    for (const e of others) {
      const a = sha256(oldAsar.readFile(e.path));
      const b = sha256(na.readFile(e.path));
      if (a !== b) throw new Error(`spot-check mismatch: ${e.path}`);
    }
    return { mainSha: sha256(main), spotChecks: others.map(e => e.path) };
  } finally { na.close(); }
}

// ---------- commands ----------

function cmdPatch({ check = false, force = false, auto = false } = {}) {
  const verDir = findLatestVersion();
  const resourcesDir = path.join(verDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const exePath = path.join(verDir, 'Qoder CN.exe');
  const backupPath = asarPath + '.purge-orig';
  const report = { version: path.basename(verDir), asar: asarPath };

  // 打开失败时把「选中了哪一份安装」写进错误里：安装发现出过假绿（只扫
  // .qoder-versions，把根目录的 0.5.1 漏掉），没有路径就看不出选错了谁。
  let asar;
  try {
    asar = new AsarFile(asarPath);
  } catch (e) {
    die(`cannot open asar for ${report.version}: ${asarPath} (${e.message})`);
  }
  try {
    const mainBuf = asar.readFile(MAIN_ENTRY);
    let src = mainBuf.toString('utf8');
    if (src.includes(MARKER)) {
      if (!force) {
        log(`[skip] already patched (${report.version})`);
        if (fs.existsSync(exePath)) patchExeFuse(exePath, report); // still report/sync manifest+fuses
        if (check) console.log(JSON.stringify({ dryRun: true, ...report }, null, 2));
        return;
      } else {
        if (!fs.existsSync(backupPath)) die('--force without backup');
        if (check) {
          // dry-run must be side-effect free: report against the backup's content
          const basar = new AsarFile(backupPath);
          try {
            patchMain(basar.readFile(MAIN_ENTRY).toString('utf8'), fs.readFileSync(PURGE_MD, 'utf8'), report);
            console.log(JSON.stringify({ dryRun: true, note: 'live is patched; report vs backup', ...report }, null, 2));
          } finally { basar.close(); }
          return;
        }
        asar.close();
        if (ensureUnoccupied(verDir, { auto }) === 'skip') return;
        fs.copyFileSync(backupPath, asarPath);
        return cmdPatch({ check, force: false, auto });
      }
    }

    const purgeText = fs.readFileSync(PURGE_MD, 'utf8');
    const patchedMain = patchMain(src, purgeText, report);
    src = null; // free the big string early

    if (check) {
      console.log(JSON.stringify({ dryRun: true, ...report }, null, 2));
      return;
    }

    if (auto) {
      const running = qoderRunning();
      if (running) { log(`[auto] Qoder is running (${running}); skip this round`); return; }
    }
    if (ensureUnoccupied(verDir, { auto }) === 'skip') return;

    // backups
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(asarPath, backupPath);
      report.backup = path.basename(backupPath);
    } else report.backup = `${path.basename(backupPath)} (existing)`;

    // rebuild asar
    const replacements = new Map([[MAIN_ENTRY, patchedMain]]);
    const { newHeader, plan, replaced } = buildRebuilt(asar, replacements);
    const tmpAsar = asarPath + '.purge-new';
    writeRebuilt(asar, newHeader, plan, tmpAsar);
    const v = verifyAsar(tmpAsar, asar, patchedMain, replaced);
    asar.close();

    swapAsarIsolated(asarPath, tmpAsar);

    // fuse layer
    if (fs.existsSync(exePath)) patchExeFuse(exePath, report);

    log(`[patched] ${JSON.stringify({ ...report, ...v })}`);
  } catch (e) {
    // isolate-rename 被占（EBUSY）时不再干等：0.5.1 的 app.asar 常被一个没有
    // FILE_SHARE_DELETE 的句柄捏着，kill 掉进程也未必立刻释放。此时退回 in-place
    // 流式覆写（同一条已建好的 .purge-new，从 0 覆写 + ftruncate + fsync）。
    // 只在「隔离失败」这一种情况下退回，其余错误照常抛。
    if (!/abort-busy isolate live asar failed/.test(String(e && e.message))) throw e;
    log(`[fallback] isolate failed (${String(e.message).slice(0, 90)}); retrying in-place`);
    try { asar.close(); } catch { /* ignore */ }
    return cmdInplaceSwap({ check, force });
  } finally { try { asar.close(); } catch { /* ignore */ } }
}

function cmdRestore() {
  const verDir = findLatestVersion();
  const asarPath = path.join(verDir, 'resources', 'app.asar');
  const backupPath = asarPath + '.purge-orig';
  if (!fs.existsSync(backupPath)) die(`no backup at ${backupPath}`);
  const running = qoderRunning();
  if (running) die(`Qoder is running (${running}); close it first`);
  ensureUnoccupied(verDir);
  fs.copyFileSync(backupPath, asarPath);
  log(`[restored] ${asarPath} <- ${backupPath}`);
}

function cmdInstallWatch() {
  const cmd = path.resolve(__dirname, '../../bin/qoder-purge.cmd');
  execSync(`schtasks /Create /F /TN ${TASK_NAME} /SC ONLOGON /TR "\\"${cmd}\\" --auto"`, { stdio: 'inherit' });
  log(`[watch] installed: ${TASK_NAME} (on logon, runs --auto)`);
}

function cmdUninstallWatch() {
  execSync(`schtasks /Delete /F /TN ${TASK_NAME}`, { stdio: 'inherit' });
  log(`[watch] removed: ${TASK_NAME}`);
}

// ---------- in-place swap (locked-asar fallback) ----------
// Preferred path is swapAsarIsolated (rename live aside, never rmSync). When a
// handle without FILE_SHARE_DELETE still holds app.asar, isolate-rename fails
// abort-busy. If that handle allows shared WRITE, stream .purge-new over the
// original IN PLACE: open 'r+', copy bytes from 0, ftruncate, fsync.
async function cmdInplaceSwap({ check = false, force = false } = {}) {
  const verDir = findLatestVersion();
  const asarPath = path.join(verDir, 'resources', 'app.asar');
  const exePath = path.join(verDir, 'Qoder CN.exe');
  const backupPath = asarPath + '.purge-orig';
  const tmpAsar = asarPath + '.purge-new';
  const report = { mode: 'inplace', version: path.basename(verDir), asar: asarPath };

  // 1. build (or reuse) the patched asar image — ALWAYS from the pristine backup
  //    when one exists (the live file may be a broken/previous patch attempt).
  const buildSource = fs.existsSync(backupPath) ? backupPath : asarPath;
  const asar = new AsarFile(buildSource);
  let patchedMain, v;
  try {
    const mainBuf = asar.readFile(MAIN_ENTRY);
    const src = mainBuf.toString('utf8');
    if (src.includes(MARKER)) {
      die(`build source is already patched (${buildSource}); refusing to double-patch`);
    }
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(asarPath, backupPath);
      report.backup = path.basename(backupPath);
    } else report.backup = `${path.basename(backupPath)} (existing)`;

    const purgeText = fs.readFileSync(PURGE_MD, 'utf8');
    const fresh = patchMain(src, purgeText, report);
    const replacements = new Map([[MAIN_ENTRY, fresh]]);
    const { newHeader, plan, replaced } = buildRebuilt(asar, replacements);
    writeRebuilt(asar, newHeader, plan, tmpAsar);
    v = verifyAsar(tmpAsar, asar, fresh, replaced);
    patchedMain = fresh;
  } finally { try { asar.close(); } catch { /* ignore */ } }

  if (check) {
    console.log(JSON.stringify({ dryRun: true, tmpSize: fs.statSync(tmpAsar).size, ...report, ...v }, null, 2));
    return;
  }

  // 2. stream tmp over the locked original, grow to new length, fsync
  const newSize = fs.statSync(tmpAsar).size;
  await new Promise((resolve, reject) => {
    const dst = fs.openSync(asarPath, 'r+');
    let pos = 0;
    const inStream = fs.createReadStream(tmpAsar, { flags: 'r' });
    inStream.on('data', (chunk) => {
      try {
        fs.writeSync(dst, chunk, 0, chunk.length, pos);
        pos += chunk.length;
      } catch (e) { inStream.destroy(e); reject(e); }
    });
    inStream.on('error', reject);
    inStream.on('end', () => {
      try {
        fs.ftruncateSync(dst, newSize);   // grow/shrink to exact rebuilt length
        fs.fsyncSync(dst);
        fs.closeSync(dst);
        resolve();
      } catch (e) { try { fs.closeSync(dst); } catch { /* ignore */ } reject(e); }
    });
  });
  log(`[inplace] streamed ${newSize} bytes over ${asarPath}`);  // 3. verify the live file reads back as the patched asar
  const live = new AsarFile(asarPath);
  try {
    const main = live.readFile(MAIN_ENTRY);
    if (!main.equals(patchedMain)) throw new Error('in-place verify: electronMain mismatch');
  } finally { live.close(); }

  // 4. fuse layer
  if (fs.existsSync(exePath)) patchExeFuse(exePath, report);
  log(`[patched] ${JSON.stringify({ ...report, ...v })}`);
}

// ---------- verify: is the LIVE prompt the current one? ----------
// `--check` only says "already patched". That is not the same question: after someone
// edits lib/qoder/purge-prompt.zh.md, the live asar still carries the previous text and
// --check stays green forever. So --verify does not try to re-find the injected literals
// by regex (minified code is full of long escaped strings, and a markdown-shaped scan can
// split one literal at an escaped quote). Instead it takes the PRISTINE backup, applies
// the current prompt to it in memory, and compares the result byte-for-byte with what is
// live. Equal means the live asar is exactly what this prompt produces — nothing to
// re-patch. Any difference is real drift.
//
//   0 current   1 stale   2 not patched   3 cannot prove (no backup)

function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function snippetAt(s, i, span = 90) {
  const from = Math.max(0, i - 30);
  return `${i >= 30 ? '…' : ''}${s.slice(from, i + span).replace(/\n/g, '\\n')}`;
}

function cmdVerify() {
  const verDir = findLatestVersion();
  const resourcesDir = path.join(verDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = asarPath + '.purge-orig';
  const want = fs.readFileSync(PURGE_MD, 'utf8');
  const report = { version: path.basename(verDir), asar: asarPath, prompt: path.basename(PURGE_MD) };

  const readMain = (p) => {
    const a = new AsarFile(p);
    try { return a.readFile(MAIN_ENTRY).toString('utf8'); } finally { try { a.close(); } catch { /* ignore */ } }
  };

  const live = readMain(asarPath);
  if (!live.includes(MARKER)) {
    console.log(JSON.stringify({ ...report, state: 'not-patched' }, null, 2));
    log('[verify] live asar is NOT patched; run without flags to patch it');
    return 2;
  }
  if (!fs.existsSync(backupPath)) {
    console.log(JSON.stringify({ ...report, state: 'cannot-prove', reason: 'no .purge-orig backup to rebuild against' }, null, 2));
    log('[verify] cannot prove freshness: backup missing (use --force to rebuild from the live file at your own risk)');
    return 3;
  }

  // Rebuild what the current prompt WOULD produce from the pristine backup.
  const pristine = readMain(backupPath);
  if (pristine.includes(MARKER)) {
    console.log(JSON.stringify({ ...report, state: 'cannot-prove', reason: 'backup is itself patched' }, null, 2));
    log('[verify] cannot prove freshness: the backup is already patched');
    return 3;
  }
  const dry = {};
  const expected = patchMain(pristine, want, dry).toString('utf8');
  const expectedSites = dry.promptSites;

  if (live === expected) {
    console.log(JSON.stringify({
      ...report,
      state: 'current',
      chars: want.length,
      lines: want.split('\n').length,
      sites: expectedSites,
      permissions: dry.permissionSites,
    }, null, 2));
    log(`[verify] current: live prompt is exactly ${path.basename(PURGE_MD)} (${want.length} chars, ${want.split('\n').length} lines)`);
    return 0;
  }

  const i = firstDivergence(live, expected);
  const livePrompt = (() => {
    // the injected text is the JSON literal patchMain writes; look for it verbatim
    const lit = JSON.stringify(want);
    const n = live.split(lit).length - 1;
    return { exactLiteralCount: n };
  })();
  console.log(JSON.stringify({
    ...report,
    state: 'stale',
    want: { chars: want.length, lines: want.split('\n').length },
    expectedSites,
    sitesCarryingCurrentText: livePrompt.exactLiteralCount,
    liveChars: live.length,
    expectedChars: expected.length,
    firstDivergenceAt: i,
    around: i >= 0 ? { live: snippetAt(live, i), expected: snippetAt(expected, i) } : null,
  }, null, 2));
  log(`[verify] STALE: live asar differs from "${path.basename(PURGE_MD)}" (live carries the current text ${livePrompt.exactLiteralCount}/3 site(s))`);
  log('[verify] re-apply: qoder-purge.mjs --force   (or --force-inplace when the asar is held open)');
  return 1;
}

// ---------- entry ----------

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log(`usage: qoder-purge.mjs [--check] [--verify] [--force] [--force-inplace] [--restore] [--install-watch] [--uninstall-watch] [--auto]
  --check            dry run: decode + count patch sites, write nothing
  --verify           compare the LIVE asar's injected prompt with purge-prompt.zh.md;
                     exit 0 current, 1 stale (re-apply with --force), 2 not patched
  --force            re-patch even if already patched (restores backup first)
  --force-inplace    patch WITHOUT delete/rename: stream rebuilt asar over the
                     locked original in place (works when app.asar is held open
                     with share-write but no share-delete), then fuse patch
  --restore          restore original asar from .purge-orig backup
  --install-watch    create on-logon scheduled task ${TASK_NAME} running --auto
  --uninstall-watch  remove the scheduled task
  --auto             unattended mode: patch if needed, skip if Qoder running (for the task)`);
  process.exit(0);
}
try {
  if (args.includes('--restore')) cmdRestore();
  else if (args.includes('--install-watch')) cmdInstallWatch();
  else if (args.includes('--uninstall-watch')) cmdUninstallWatch();
  else if (args.includes('--verify')) process.exitCode = cmdVerify();
  else if (args.includes('--force-inplace')) await cmdInplaceSwap({ check: args.includes('--check'), force: true });
  else cmdPatch({ check: args.includes('--check'), force: args.includes('--force'), auto: args.includes('--auto') });
} catch (e) {
  log(`[error] ${e && e.stack || e}`);
  die(e && e.message || String(e));
}
