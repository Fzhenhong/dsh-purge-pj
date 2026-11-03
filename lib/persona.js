// Persona 热切（吸收自 ZiChuanLan/agent-purge 的 hot-switch 思路，重写成
// 我们的钉子/磁盘双通道语义）。
//
// 背景：CLI 进程与桌面插件进程不共享内存，切换内核提示词原本要重启宿主。
// 这里的通道：CLI 把信号写进 <home>/personas/active.json（rev++，先写——
// 信号先行，窗口内插件先看到 rev 变化就能写新钉），再把 persona 标记块
// 落进 prompt-inject.md（持久化，重启后 seed :9530 从磁盘拿到新正文）。
// 插件侧 lib/index.js refreshHungOperator 每轮盯 active.json 的 mtime
// （进了 hungCache 缓存键），rev 变了就 applyPersonaSignal 把 persona 正文
// 写成新钉（rememberCommittedOverride → committedOverrideRev++ →
// hungCache / liveRewriteCache 双缓存同时失效 → 下一轮 assemble 免重启生效）。
//
// 空串撤钉：rememberCommittedOverride(home, "") 对空串也记（rev++），
// peekCommittedOverride 返回 "" 后 resolveInjectText 的 normalizeOverride("")
// 为空 → 落穿到磁盘正文（persona 块已剥掉的基线）——--persona --off 就靠它。
import fs from "node:fs";
import path from "node:path";
import * as core from "./core.js";

export const PERSONAS_DIR = "personas";
export const PERSONA_STATE_FILE = "active.json";
export const PERSONA_BEGIN = "<!-- dsh-purge:persona-begin -->";
export const PERSONA_END = "<!-- dsh-purge:persona-end -->";
// 任意 Unicode 字母/数字（汉字、希腊字母、重音字母都算）+ 下划线连字符；
// 拒绝路径分隔符与控制字符，堵 ../ 穿越。
export const PERSONA_NAME_RE = /^[\p{L}\p{N}_-]{1,64}$/u;

// 模块级「已应用的信号」。首次调用只记录不写钉：插件进程启动时 seed
// （core.js 启动路径 rememberCommittedOverride(home, disk||default)）已经
// 把含 persona 块的磁盘正文 pin 进内存，再写一次是白耗一个 rev。
let lastSeen = null;

export function resetPersonaSeenForTest() {
  lastSeen = null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function personasDir(dshHome = core.findDshHome()) {
  return path.join(dshHome, PERSONAS_DIR);
}

export function personaStatePath(dshHome = core.findDshHome()) {
  return path.join(personasDir(dshHome), PERSONA_STATE_FILE);
}

export function personaBlock(body) {
  return `\n${PERSONA_BEGIN}\n${String(body ?? "").trim()}\n${PERSONA_END}\n`;
}

export function stripPersonaBlock(text) {
  const re = new RegExp(`\\n?${escapeRe(PERSONA_BEGIN)}[\\s\\S]*?${escapeRe(PERSONA_END)}\\n?`, "g");
  return String(text ?? "").replace(re, "");
}

export function findPersonaBody(text) {
  const re = new RegExp(`${escapeRe(PERSONA_BEGIN)}\\s*\\n([\\s\\S]*?)\\s*\\n${escapeRe(PERSONA_END)}`);
  const m = String(text ?? "").match(re);
  return m ? m[1] : null;
}

export function sanitizePersonaName(name) {
  const s = String(name ?? "").trim();
  if (!PERSONA_NAME_RE.test(s)) {
    throw new Error(`persona 名不合法（字母/数字/下划线/汉字/连字符，≤64 字符）：${s || "（空）"}`);
  }
  return s;
}

function personaFile(dshHome, name) {
  return path.join(personasDir(dshHome), `${sanitizePersonaName(name)}.md`);
}

export function listPersonas(dshHome = core.findDshHome()) {
  const dir = personasDir(dshHome);
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    try {
      const st = fs.statSync(path.join(dir, f));
      out.push({ name: f.slice(0, -3), chars: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    } catch {
      /* 读不了的单个文件跳过 */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function readPersona(dshHome, name) {
  try {
    return fs.readFileSync(personaFile(dshHome, name), "utf8");
  } catch {
    return null;
  }
}

export function writePersona(dshHome, name, body) {
  const text = String(body ?? "").trim();
  if (!text) throw new Error("persona 正文为空");
  const fp = personaFile(dshHome, name);
  fs.mkdirSync(personasDir(dshHome), { recursive: true });
  core.atomicWriteSync(fp, text.replace(/\r\n/g, "\n") + "\n");
  return fp;
}

export function deletePersona(dshHome, name) {
  const fp = personaFile(dshHome, name);
  let removed = false;
  try {
    fs.unlinkSync(fp);
    removed = true;
  } catch {
    /* 本来就没有 */
  }
  // 删的正好是激活中的 persona：信号撤下，插件侧软撤钉落回磁盘基线。
  const st = readPersonaState(dshHome);
  if (removed && st.active === sanitizePersonaName(name)) {
    return { removed, cleared: clearActivePersona(dshHome) };
  }
  return { removed, cleared: null };
}

function defaultState() {
  return { active: null, rev: 0, ts: 0 };
}

export function readPersonaState(dshHome) {
  try {
    const raw = JSON.parse(fs.readFileSync(personaStatePath(dshHome), "utf8"));
    return {
      active: typeof raw.active === "string" ? raw.active : null,
      rev: Number.isFinite(raw.rev) ? raw.rev : 0,
      ts: Number.isFinite(raw.ts) ? raw.ts : 0,
    };
  } catch {
    return defaultState();
  }
}

function writePersonaState(dshHome, st) {
  fs.mkdirSync(personasDir(dshHome), { recursive: true });
  core.atomicWriteSync(personaStatePath(dshHome), JSON.stringify(st, null, 2) + "\n");
}

export function personaSignalMtimeMs(dshHome) {
  try {
    return Math.floor(fs.statSync(personaStatePath(dshHome)).mtimeMs);
  } catch {
    return 0;
  }
}

// 磁盘注入正文直读原始字节（与 probe.js readRawInject 同款语义：normalize
// 托管路径会吃注释块，persona 标记块必须在原始字节层操作）。
function readRawInject(dshHome) {
  const fp = core.findOverrideFile(dshHome) ?? path.join(dshHome, "prompt-inject.md");
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return "";
  }
}

function writeRawInject(dshHome, text) {
  const fp = core.findOverrideFile(dshHome) ?? path.join(dshHome, "prompt-inject.md");
  core.atomicWriteSync(fp, text);
}

/** CLI 端：把当前磁盘正文（剥 persona 块后）存成一个 persona。 */
export function savePersonaFromInject(dshHome, name) {
  const base = stripPersonaBlock(readRawInject(dshHome)).replace(/\s*$/, "");
  if (!base.trim()) throw new Error("注入文件为空或不存在（先跑 --apply）");
  writePersona(dshHome, name, base);
  return { name: sanitizePersonaName(name), chars: base.length };
}

/** CLI 端：切换 persona。先写 active.json（rev++，插件侧信号），再落盘标记块。 */
export function switchPersona(dshHome, name) {
  const clean = sanitizePersonaName(name);
  const body = readPersona(dshHome, clean);
  if (!body || !body.trim()) {
    throw new Error(`persona 不存在：${clean}（先 --persona --save ${clean} 存一份）`);
  }
  const prev = readPersonaState(dshHome);
  const st = { active: clean, rev: (prev.rev || 0) + 1, ts: Date.now() };
  // 顺序关键：信号先行。窗口内插件先拿到新 rev → 写新钉 → resolve 读新钉；
  // 磁盘标记块稍后跟上，mtime 变化再兜底一轮，最终一致。
  writePersonaState(dshHome, st);
  const base = stripPersonaBlock(readRawInject(dshHome)).replace(/\s*$/, "");
  if (base.trim()) writeRawInject(dshHome, base + "\n" + personaBlock(body));
  else writeRawInject(dshHome, personaBlock(body));
  return st;
}

/** CLI 端：撤下 persona（信号 active=null + 磁盘剥块）。 */
export function clearActivePersona(dshHome) {
  const prev = readPersonaState(dshHome);
  const st = { active: null, rev: (prev.rev || 0) + 1, ts: Date.now() };
  writePersonaState(dshHome, st);
  const text = readRawInject(dshHome);
  const had = findPersonaBody(text) != null;
  if (had) writeRawInject(dshHome, stripPersonaBlock(text).replace(/\s*$/, "") + "\n");
  return { ...st, removed: had };
}

export function personaStatus(dshHome = core.findDshHome()) {
  const st = readPersonaState(dshHome);
  const body = findPersonaBody(readRawInject(dshHome));
  return {
    active: st.active,
    rev: st.rev,
    ts: st.ts,
    onDisk: body != null,
    consistent: st.active ? body != null : body == null,
    personas: listPersonas(dshHome),
    signalMtimeMs: personaSignalMtimeMs(dshHome),
  };
}

/**
 * 插件端：refreshHungOperator / agent/pre-step 每轮调用。
 * rev 或 active 变了就改写内存钉（正文=persona 文件原文；off/文件丢失=空串软撤钉）。
 * 幂等：rev/active 都没变时 changed:false，重复调用无副作用。
 */
export function applyPersonaSignal(dshHome) {
  const home = String(dshHome || "");
  if (!home) return { changed: false, skip: "no-home" };
  const st = readPersonaState(home);
  if (!lastSeen) {
    // 首次：只记录。启动 seed 已把含 persona 块的磁盘正文 pin 进内存。
    lastSeen = { rev: st.rev, active: st.active };
    return { changed: false, first: true };
  }
  if (st.rev === lastSeen.rev && st.active === lastSeen.active) return { changed: false };
  const prev = { ...lastSeen };
  lastSeen = { rev: st.rev, active: st.active };
  if (st.active) {
    const body = readPersona(home, st.active);
    if (body && body.trim()) {
      core.rememberCommittedOverride(home, body.trim());
      return { changed: true, active: st.active, prevActive: prev.active };
    }
    // persona 文件丢了：软撤钉（空串也 rev++），resolve 落穿到磁盘。
    core.rememberCommittedOverride(home, "");
    return { changed: true, active: st.active, missing: true, prevActive: prev.active };
  }
  core.rememberCommittedOverride(home, "");
  return { changed: true, active: null, prevActive: prev.active };
}
