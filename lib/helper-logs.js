/**
 * detached helper 的日志诊断（只读）。
 *
 * 吸收自 Crow-purge / dsh-purge 系列的 restart-diagnostics.js，文件名换成本仓库的。
 *
 * 【为什么需要】
 *
 * `lib/restart-desktop.js`、`lib/restart-web.js`、`lib/uninstall-restart.js` 都是
 * detached 子进程，stdio 是 ignore：宿主一退出，它们的 stdout/stderr 没有任何人接。
 * 失败时用户手里唯一能说明「死在哪一步」的就是它们自己往 %TEMP% 写的日志。过去这些
 * 路径只在桌面换包分支里透出，普通重启 / 卸载清理的日志用户根本不知道在哪。
 *
 * 本模块只做一件事：把日志的**路径 + 尾部若干行**读成结构化数据，供 `/status`
 * 直接返回。不写文件、不清理、不解析业务语义。
 *
 * 【为什么限制读取量】
 *
 * `/status` 是高频轮询（面板 5 秒一次）。日志是 append-only 的，跑上几个月可能到
 * MB 级；每次整文件读会白白拖慢面板。这里只读尾部 maxBytes（默认 8 KB），再从中
 * 取最后 maxLines 行，单次成本恒定。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * helper 日志文件名。与写日志处必须一致：
 *   restart-desktop   → lib/restart-desktop.js:18
 *   internal          → lib/index.js:475（PURGE_INTERNAL_LOG，assemble/apply 探针）
 *   official          → lib/desktop.js:1419（官方更新后重启脚本）
 *   sealed_restart    → lib/index.js:1339（密封 asar 换包重启）
 */
export const HELPER_LOG_FILES = {
  restart_desktop: "dsh-purge-restart-desktop.log",
  internal: "dsh-purge-desktop.log",
  official_restart: "dsh-purge-official-restart.log",
  sealed_restart: "dsh-purge-sealed-restart.log",
};

/**
 * 读一个日志文件的尾部。
 *
 * @param {string} fp 文件路径
 * @param {{maxLines?:number, maxBytes?:number}} [opts]
 * @returns {{path:string, exists:boolean, size:number, mtime:number, lines:string[], truncated:boolean, error:string}}
 */
export function readLogTail(fp, opts = {}) {
  const maxLines = Math.max(1, Number(opts.maxLines) || 12);
  const maxBytes = Math.max(256, Number(opts.maxBytes) || 8192);
  const out = {
    path: String(fp || ""),
    exists: false,
    size: 0,
    mtime: 0,
    lines: [],
    truncated: false,
    error: "",
  };
  if (!out.path) {
    out.error = "no-path";
    return out;
  }
  let st;
  try {
    st = fs.statSync(out.path);
  } catch {
    // 文件不存在是正常状态（helper 没跑过 / 系统清过 TEMP），不算错误。
    return out;
  }
  if (!st.isFile()) {
    out.error = "not-file";
    return out;
  }
  out.exists = true;
  out.size = st.size;
  out.mtime = st.mtimeMs;

  const start = Math.max(0, st.size - maxBytes);
  out.truncated = start > 0;
  let text = "";
  try {
    const fd = fs.openSync(out.path, "r");
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
  // 从中间切进来时第一行可能只有半截，丢掉它，避免把半个时间戳当成证据。
  if (start > 0) {
    const nl = text.indexOf("\n");
    text = nl >= 0 ? text.slice(nl + 1) : "";
  }
  out.lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(-maxLines);
  return out;
}

/**
 * 收集全部 helper 日志的尾部。
 *
 * @param {string} [tmpDir] 默认 `os.tmpdir()`（与 helper 的 `process.env.TEMP || TMPDIR` 同源）
 * @param {{maxLines?:number, maxBytes?:number}} [opts]
 */
export function helperLogDiagnostics(tmpDir, opts = {}) {
  const dir = String(tmpDir || "").trim() || os.tmpdir();
  const logs = {};
  for (const [key, name] of Object.entries(HELPER_LOG_FILES)) {
    logs[key] = readLogTail(path.join(dir, name), opts);
  }
  return { tmp_dir: dir, logs };
}

/** 只挑有内容的日志，供 CLI 打印用。 */
export function nonEmptyHelperLogs(diagnostics) {
  const logs = diagnostics && diagnostics.logs ? diagnostics.logs : {};
  const picked = {};
  for (const [key, value] of Object.entries(logs)) {
    if (value && value.exists && value.lines.length > 0) picked[key] = value;
  }
  return picked;
}
