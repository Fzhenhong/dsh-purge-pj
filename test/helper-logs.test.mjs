import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HELPER_LOG_FILES,
  helperLogDiagnostics,
  nonEmptyHelperLogs,
  readLogTail,
} from "../lib/helper-logs.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-helperlogs-"));
}

test("日志文件名与写日志处一致", () => {
  // 这几个名字是 helper 里写死的；改一处不改另一处就再也读不到日志。
  assert.equal(HELPER_LOG_FILES.restart_desktop, "dsh-purge-restart-desktop.log");
  assert.equal(HELPER_LOG_FILES.internal, "dsh-purge-desktop.log");
  assert.equal(HELPER_LOG_FILES.official_restart, "dsh-purge-official-restart.log");
  assert.equal(HELPER_LOG_FILES.sealed_restart, "dsh-purge-sealed-restart.log");
});

test("文件不存在是正常状态，不算错误", () => {
  const dir = tmp();
  const r = readLogTail(path.join(dir, "nope.log"));
  assert.equal(r.exists, false);
  assert.equal(r.error, "");
  assert.deepEqual(r.lines, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("空路径返回 no-path", () => {
  assert.equal(readLogTail("").error, "no-path");
});

test("只读尾部并丢掉被截断的半行", () => {
  const dir = tmp();
  const fp = path.join(dir, "a.log");
  const filler = "x".repeat(500) + "\n";
  fs.writeFileSync(fp, filler.repeat(40) + "2026-10-31T00:00:00Z tail-line\n", "utf8");
  const r = readLogTail(fp, { maxBytes: 256, maxLines: 5 });
  assert.equal(r.exists, true);
  assert.equal(r.truncated, true);
  // 尾部最后一行一定在，且不会是半个时间戳。
  assert.equal(r.lines.at(-1), "2026-10-31T00:00:00Z tail-line");
  for (const line of r.lines) assert.ok(!line.startsWith("xxx"), "不该带出被切断的半行");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("maxLines 生效且过滤空行", () => {
  const dir = tmp();
  const fp = path.join(dir, "b.log");
  fs.writeFileSync(fp, "l1\n\nl2\n\n\nl3\n", "utf8");
  const r = readLogTail(fp, { maxLines: 2 });
  assert.deepEqual(r.lines, ["l2", "l3"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("目录不是文件", () => {
  const dir = tmp();
  const r = readLogTail(dir);
  assert.equal(r.error, "not-file");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("helperLogDiagnostics 覆盖全部四个键", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, HELPER_LOG_FILES.restart_desktop), "boom\n", "utf8");
  const d = helperLogDiagnostics(dir);
  assert.equal(d.tmp_dir, dir);
  assert.deepEqual(Object.keys(d.logs).sort(), Object.keys(HELPER_LOG_FILES).sort());
  assert.equal(d.logs.restart_desktop.exists, true);
  assert.equal(d.logs.internal.exists, false);
  const picked = nonEmptyHelperLogs(d);
  assert.deepEqual(Object.keys(picked), ["restart_desktop"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("没有日志时 nonEmptyHelperLogs 返回空对象", () => {
  const dir = tmp();
  assert.deepEqual(nonEmptyHelperLogs(helperLogDiagnostics(dir)), {});
  fs.rmSync(dir, { recursive: true, force: true });
});
