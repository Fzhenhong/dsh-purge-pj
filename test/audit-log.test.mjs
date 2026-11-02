import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUDIT_FILE,
  AUDIT_MAX_BYTES,
  appendAudit,
  auditPath,
  readAuditTail,
  withAudit,
} from "../lib/audit-log.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-audit-"));
}

test("auditPath 拼在 <home>/dsh-purge/audit.jsonl", () => {
  const home = path.join("C:", "Users", "x", ".dsh");
  assert.equal(auditPath(home), path.join(home, "dsh-purge", AUDIT_FILE));
  assert.equal(auditPath(""), "");
});

test("appendAudit 落一行合法 JSON 并带上时间/pid/动作", () => {
  const home = tmp();
  const r = appendAudit(home, { action: "apply", ok: true, surface: "web", detail: { applied: 3 }, ms: 12.7 });
  assert.equal(r.written, true);
  assert.equal(r.error, "");
  const lines = fs.readFileSync(r.path, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.action, "apply");
  assert.equal(rec.ok, true);
  assert.equal(rec.surface, "web");
  assert.equal(rec.ms, 13);
  assert.deepEqual(rec.detail, { applied: 3 });
  assert.equal(rec.pid, process.pid);
  assert.ok(!Number.isNaN(Date.parse(rec.at)));
  fs.rmSync(home, { recursive: true, force: true });
});

test("没有 DSH_HOME 时不写，也不抛", () => {
  const r = appendAudit("", { action: "apply" });
  assert.equal(r.written, false);
  assert.equal(r.error, "no-home");
});

test("withAudit 成功与失败都记，失败原样抛出", async () => {
  const home = tmp();
  const okValue = await withAudit(home, "revert", { surface: "web" }, async () => 42);
  assert.equal(okValue, 42);
  await assert.rejects(
    withAudit(home, "uninstall", {}, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  const { entries } = readAuditTail(home);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].action, "revert");
  assert.equal(entries[0].ok, true);
  assert.equal(entries[1].action, "uninstall");
  assert.equal(entries[1].ok, false);
  assert.equal(entries[1].error, "boom");
  fs.rmSync(home, { recursive: true, force: true });
});

test("readAuditTail 只回最后 limit 条，坏行跳过", () => {
  const home = tmp();
  const fp = auditPath(home);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  // 坏行放在开头：尾部窗口里全是好行，limit 才应该正好取满。
  fs.writeFileSync(fp, "{not json\n", "utf8");
  for (let i = 0; i < 8; i += 1) appendAudit(home, { action: "apply", detail: { i } });
  const r = readAuditTail(home, { limit: 3 });
  assert.equal(r.exists, true);
  assert.equal(r.entries.length, 3);
  assert.equal(r.entries.at(-1).detail.i, 7);
  // 坏行本身也绝不抛：整份读完照样能拿到 8 条好记录。
  assert.equal(readAuditTail(home, { limit: 50 }).entries.length, 8);
  fs.rmSync(home, { recursive: true, force: true });
});

test("文件不存在时 readAuditTail 返回空且不算错误", () => {
  const home = tmp();
  const r = readAuditTail(home);
  assert.equal(r.exists, false);
  assert.equal(r.error, "");
  assert.deepEqual(r.entries, []);
  fs.rmSync(home, { recursive: true, force: true });
});

test("超过 AUDIT_MAX_BYTES 时翻滚成 .1，旧 .1 被覆盖", () => {
  const home = tmp();
  const dir = path.join(home, "dsh-purge");
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, AUDIT_FILE);
  fs.writeFileSync(fp, "x".repeat(AUDIT_MAX_BYTES + 10), "utf8");
  fs.writeFileSync(`${fp}.1`, "old\n", "utf8");
  const r = appendAudit(home, { action: "apply" });
  assert.equal(r.written, true);
  // 翻滚后当前文件只剩这一条新记录。
  assert.equal(fs.readFileSync(fp, "utf8").trim().split("\n").length, 1);
  assert.ok(fs.statSync(fp).size < AUDIT_MAX_BYTES);
  // 旧 .1 被这次的巨型文件顶掉，不是旧内容。
  assert.ok(fs.statSync(`${fp}.1`).size > AUDIT_MAX_BYTES);
  fs.rmSync(home, { recursive: true, force: true });
});
