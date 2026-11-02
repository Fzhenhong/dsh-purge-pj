/**
 * 从官方归档（app.asar）重建被烧掉的 .dshpurge.bak 基线。
 *
 * 吸收自 555bbbAAA/dsh-purge 的 repair-baks.js，判据换成本仓库的路径解析。
 *
 * 【为什么需要】
 *
 * 1.1.72 之前的 refreshStaleBaksForUpgrade 把「当前文件里没有 dsh-purge 字串」当成
 * 「官方新版」，于是把唯一一份原始备份刷成了已打补丁的字节（审计实测 50/52 已烧）。
 * 之后 revertAll 看到 current == bak 就跳过，回滚与卸载都还原不了这些文件。
 *
 * 现在 refreshStaleBaksForUpgrade 已经不会再烧新备份，但**已经烧掉的那些**必须从
 * 别处取回原文 —— 唯一可靠的来源是官方归档 app.asar。
 *
 * 本模块的边界：
 *   · 只写 `<file>.dshpurge.bak`，正式文件一律不碰
 *   · 只处理「bak 与当前文件逐字节相同」的那种坏备份（burned）
 *   · 干净备份（bak != current）一律不动
 *   · 归档里没有对应条目、或当前文件本来就是官方原文的，跳过并记录原因
 *
 * 默认只出计划（write:false），加 write:true 才落盘。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAsar } from "./extract-asar.js";

export const DEFAULT_BAK_SUFFIX = ".dshpurge.bak";

/**
 * aiBase = `<app>/dsh/node_modules/@deepseek-ai`，往上三层就是 resources/app。
 *
 * @param {string} aiBase
 * @returns {string}
 */
export function appDirOfAiBase(aiBase) {
  const base = String(aiBase || "").trim();
  if (!base) return "";
  return path.resolve(base, "..", "..", "..");
}

/**
 * resources 目录（app.asar 的所在处）。appDir 的父目录。
 *
 * @param {string} aiBase
 */
export function resourcesDirOfAiBase(aiBase) {
  const app = appDirOfAiBase(aiBase);
  return app ? path.dirname(app) : "";
}

/**
 * 找一个能用的官方归档。
 *
 * @param {string} aiBase
 * @returns {{archive:string, reason:string}}
 */
export function findArchiveForAiBase(aiBase) {
  const resources = resourcesDirOfAiBase(aiBase);
  if (!resources) return { archive: "", reason: "no-ai-base" };
  for (const name of ["app.asar", "app.asar.bak"]) {
    const fp = path.join(resources, name);
    try {
      if (fs.statSync(fp).isFile()) return { archive: fp, reason: "" };
    } catch {
      // 继续试下一个
    }
  }
  return { archive: "", reason: "no-archive" };
}

/** 归档里的相对路径（POSIX 分隔）→ aiBase 下的绝对路径。 */
function relFromAiBase(aiBase, fp) {
  const rel = path.relative(aiBase, fp);
  if (!rel || rel.startsWith("..")) return "";
  return rel.split(path.sep).join("/");
}

function walkBaks(root, suffix, out, depth = 0) {
  if (depth > 12) return;
  let ents = [];
  try {
    ents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const fp = path.join(root, ent.name);
    if (ent.isDirectory()) {
      walkBaks(fp, suffix, out, depth + 1);
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith(suffix)) continue;
    out.push(fp);
  }
}

/**
 * 出计划：哪些 bak 已经烧掉（bak 与当前文件逐字节相同）。
 *
 * @param {string} aiBase
 * @param {{suffix?:string}} [options]
 */
export function planBurnedBakRepair(aiBase, options = {}) {
  const suffix = String(options.suffix || DEFAULT_BAK_SUFFIX);
  const out = {
    ok: false,
    reason: "",
    ai_base: String(aiBase || ""),
    app_dir: "",
    archive: "",
    scanned: 0,
    burned: [],
  };
  if (!aiBase) {
    out.reason = "no-ai-base";
    return out;
  }
  let isDir = false;
  try {
    isDir = fs.statSync(aiBase).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    out.reason = "no-ai-base";
    return out;
  }
  out.app_dir = appDirOfAiBase(aiBase);
  const found = findArchiveForAiBase(aiBase);
  out.archive = found.archive;

  const baks = [];
  walkBaks(aiBase, suffix, baks);
  out.scanned = baks.length;
  for (const bak of baks) {
    const original = bak.slice(0, -suffix.length);
    let cur;
    let b;
    try {
      cur = fs.readFileSync(original);
      b = fs.readFileSync(bak);
    } catch {
      continue; // 正式文件不在了：restoreMissingOriginalsFromBak 的事，不归这里
    }
    // 干净备份：bak 与当前不同，说明 bak 还是原文，别动。
    if (!cur.equals(b)) continue;
    out.burned.push({
      file: original,
      bak,
      rel: relFromAiBase(aiBase, original),
      available: false,
      reason: "",
    });
  }
  if (out.burned.length === 0) {
    out.ok = true;
    out.reason = "no-burned-bak";
    return out;
  }
  if (!out.archive) {
    out.reason = found.reason || "no-archive";
    return out;
  }
  out.ok = true;
  return out;
}

/**
 * 真正动手：把归档里对应的原文写进 `<file>.dshpurge.bak`。
 *
 * @param {string} aiBase
 * @param {{suffix?:string, write?:boolean, archive?:string}} [options]
 */
export function repairBurnedBaksFromArchive(aiBase, options = {}) {
  const suffix = String(options.suffix || DEFAULT_BAK_SUFFIX);
  const plan = planBurnedBakRepair(aiBase, { suffix });
  const out = { ...plan, written: [], skipped: [], extract_dir: "", error: "" };
  if (!plan.ok || plan.burned.length === 0 || !plan.archive) return out;

  let tmpDir = "";
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-bakrepair-"));
    out.extract_dir = tmpDir;
    extractAsar(plan.archive, tmpDir);
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.message ? e.message : e);
    out.reason = "extract-failed";
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return out;
  }

  try {
    for (const item of out.burned) {
      // 归档里的树形是 resources/app/**，aiBase 是 <app>/dsh/node_modules/@deepseek-ai，
      // 所以 rel 要再加一层 dsh/node_modules/@deepseek-ai 前缀。
      const inArchive = path.join(tmpDir, "dsh", "node_modules", "@deepseek-ai", ...item.rel.split("/"));
      let buf;
      try {
        buf = fs.readFileSync(inArchive);
      } catch {
        item.reason = "not-in-archive";
        out.skipped.push(item);
        continue;
      }
      // 归档里的那份如果和当前文件相同，说明当前文件本来就是官方原文：
      // 这时 bak 与 current 相同是**正确的**，不是烧掉，别动。
      let cur;
      try {
        cur = fs.readFileSync(item.file);
      } catch {
        item.reason = "current-unreadable";
        out.skipped.push(item);
        continue;
      }
      if (buf.equals(cur)) {
        item.reason = "current-is-official";
        out.skipped.push(item);
        continue;
      }
      item.available = true;
      if (options.write !== true) continue;
      try {
        fs.writeFileSync(item.bak, buf);
        out.written.push(item);
      } catch (e) {
        item.reason = "write-failed:" + String(e && e.message ? e.message : e);
        out.skipped.push(item);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  out.reason = out.written.length > 0 || out.burned.some((x) => x.available) ? "" : "nothing-repairable";
  return out;
}
