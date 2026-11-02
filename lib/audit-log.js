/**
 * 破坏性操作的流水账（append-only JSONL）。
 *
 * 吸收自 54zhien/dsh-purge-plus 的 tool-gate.js 里的「审计永远要有」这一半判据，
 * 但只保留记录、不引入审批门 —— 本仓库的主入口是人自己点「应用」，人就是审批者，
 * 再弹一次只是多一次点击；而本机策略可能把 approval 一律自动拒绝，强制审批等于
 * 把插件锁死。
 *
 * 为什么必须有：apply / revert / uninstall 都是不可逆动作，长任务里出了问题只能靠
 * 记忆回溯。这里每次动作落一行 JSON，包含时间、动作、宿主、结果、耗时、错误。
 *
 * 落盘位置：`<DSH_HOME>/dsh-purge/audit.jsonl`，超过 AUDIT_MAX_BYTES 时把当前文件
 * 改名成 `.1`（覆盖旧 `.1`），新文件从头开始 —— 与内部探针日志同一套翻滚策略，
 * 保证长期开着不会把磁盘吃满。
 */

import fs from "node:fs";
import path from "node:path";

export const AUDIT_FILE = "audit.jsonl";
export const AUDIT_MAX_BYTES = 1 << 20; // 1 MB
export const AUDIT_KEEP = 2; // 当前 + 1 份历史

export function auditPath(dshHome) {
  const home = String(dshHome || "").trim();
  if (!home) return "";
  return path.join(home, "dsh-purge", AUDIT_FILE);
}

function rotate(fp) {
  try {
    const st = fs.statSync(fp);
    if (st.size <= AUDIT_MAX_BYTES) return;
  } catch {
    return; // 文件不存在，没什么可翻滚
  }
  try {
    fs.renameSync(fp, `${fp}.1`);
  } catch {
    // 并发翻滚失败下次再试；绝不因为翻滚失败丢掉这次记录
  }
}

/**
 * 追加一条流水。
 *
 * @param {string} dshHome
 * @param {{action:string, ok?:boolean, surface?:string, ai_base?:string, detail?:object, error?:string, ms?:number}} entry
 * @returns {{written:boolean, path:string, error:string}}
 */
export function appendAudit(dshHome, entry) {
  const fp = auditPath(dshHome);
  if (!fp) return { written: false, path: "", error: "no-home" };
  const record = {
    at: new Date().toISOString(),
    pid: process.pid,
    action: String(entry?.action || "unknown"),
    ok: entry?.ok !== false,
    surface: String(entry?.surface || ""),
    ai_base: String(entry?.ai_base || ""),
    ms: Number.isFinite(entry?.ms) ? Math.round(entry.ms) : undefined,
    error: entry?.error ? String(entry.error) : "",
    detail: entry?.detail && typeof entry.detail === "object" ? entry.detail : undefined,
  };
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    rotate(fp);
    fs.appendFileSync(fp, JSON.stringify(record) + "\n", "utf8");
    return { written: true, path: fp, error: "" };
  } catch (e) {
    // 记流水失败绝不能让动作本身失败。
    return { written: false, path: fp, error: String(e && e.message ? e.message : e) };
  }
}

/** 包一个异步动作，自动计时并落流水。动作抛错也记，然后原样抛出。 */
export async function withAudit(dshHome, action, meta, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    appendAudit(dshHome, {
      action,
      ok: true,
      surface: meta?.surface,
      ai_base: meta?.ai_base,
      detail: meta?.detail,
      ms: Date.now() - started,
    });
    return result;
  } catch (e) {
    appendAudit(dshHome, {
      action,
      ok: false,
      surface: meta?.surface,
      ai_base: meta?.ai_base,
      detail: meta?.detail,
      error: String(e && e.message ? e.message : e),
      ms: Date.now() - started,
    });
    throw e;
  }
}

/**
 * 读最近若干条流水（新的在后）。
 *
 * @param {string} dshHome
 * @param {{limit?:number, maxBytes?:number}} [opts]
 */
export function readAuditTail(dshHome, opts = {}) {
  const fp = auditPath(dshHome);
  const limit = Math.max(1, Number(opts.limit) || 20);
  const maxBytes = Math.max(1024, Number(opts.maxBytes) || 256 * 1024);
  const out = { path: fp, exists: false, size: 0, entries: [], truncated: false, error: "" };
  if (!fp) {
    out.error = "no-home";
    return out;
  }
  let st;
  try {
    st = fs.statSync(fp);
  } catch {
    return out;
  }
  if (!st.isFile()) {
    out.error = "not-file";
    return out;
  }
  out.exists = true;
  out.size = st.size;
  const start = Math.max(0, st.size - maxBytes);
  out.truncated = start > 0;
  let text = "";
  try {
    const fd = fs.openSync(fp, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      if (buf.length > 0) fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
    return out;
  }
  if (start > 0) {
    const nl = text.indexOf("\n");
    text = nl >= 0 ? text.slice(nl + 1) : "";
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const entries = [];
  for (const line of lines.slice(-limit)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") entries.push(parsed);
    } catch {
      // 半行或手改坏的行直接跳过，不让一条坏记录毁掉整份视图。
    }
  }
  out.entries = entries;
  return out;
}
