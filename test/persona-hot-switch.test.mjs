// persona 热切单元测试：lib/persona.js 的文件层 + applyPersonaSignal 与内存
// 钉子的联动（rememberCommittedOverride / peekCommittedOverride / rev 递增）。
// 不 spawn 宿主：refreshHungOperator 的接线（缓存键含 active.json mtime、
// resolve 前跑 applyPersonaSignal）是每轮 refresh 的真实链路，靠 --probe-request
// 与真机验证。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";
import * as persona from "../lib/persona.js";

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-persona-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  return dir;
}

function seedInject(home, text) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "prompt-inject.md"), text, "utf8");
}

test("persona 名字 sanitize：拒绝穿越与空名，接受中文名", () => {
  assert.throws(() => persona.sanitizePersonaName("../evil"), /不合法/);
  assert.throws(() => persona.sanitizePersonaName("a/b"), /不合法/);
  assert.throws(() => persona.sanitizePersonaName(""), /不合法/);
  assert.throws(() => persona.sanitizePersonaName("x".repeat(65)), /不合法/);
  assert.equal(persona.sanitizePersonaName("工作-模式_2"), "工作-模式_2");
  assert.equal(persona.sanitizePersonaName("  red  "), "red");
});

test("write/read/list roundtrip + 状态文件与信号 mtime", (t) => {
  const home = tmpHome(t);
  assert.equal(persona.listPersonas(home).length, 0);
  assert.equal(persona.personaSignalMtimeMs(home), 0);
  persona.writePersona(home, "alpha", "# alpha 人设\n第一段");
  persona.writePersona(home, "beta-β", "beta 正文");
  const list = persona.listPersonas(home);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => p.name), ["alpha", "beta-β"]);
  assert.equal(persona.readPersona(home, "alpha"), "# alpha 人设\n第一段\n");
  assert.equal(persona.readPersona(home, "nope"), null);
  const st0 = persona.readPersonaState(home);
  assert.deepEqual(st0, { active: null, rev: 0, ts: 0 });
});

test("switchPersona：信号先行 + 磁盘标记块，status 判一致", (t) => {
  const home = tmpHome(t);
  seedInject(home, "基线正文。\n");
  persona.writePersona(home, "alpha", "ALPHA-正文");
  const st = persona.switchPersona(home, "alpha");
  assert.equal(st.active, "alpha");
  assert.equal(st.rev, 1);
  assert.ok(persona.personaSignalMtimeMs(home) > 0);
  const disk = fs.readFileSync(path.join(home, "prompt-inject.md"), "utf8");
  assert.ok(disk.startsWith("基线正文。"));
  assert.ok(disk.includes(persona.PERSONA_BEGIN));
  assert.ok(disk.includes("ALPHA-正文"));
  assert.ok(disk.includes(persona.PERSONA_END));
  assert.equal(persona.findPersonaBody(disk), "ALPHA-正文");
  const ps = persona.personaStatus(home);
  assert.equal(ps.active, "alpha");
  assert.equal(ps.onDisk, true);
  assert.equal(ps.consistent, true);
  // 再切一次 rev 递增
  persona.writePersona(home, "beta", "BETA-正文");
  const st2 = persona.switchPersona(home, "beta");
  assert.equal(st2.rev, 2);
  // --off：剥块 + 信号撤
  const off = persona.clearActivePersona(home);
  assert.equal(off.active, null);
  assert.equal(off.rev, 3);
  assert.equal(off.removed, true);
  const disk2 = fs.readFileSync(path.join(home, "prompt-inject.md"), "utf8");
  assert.equal(persona.findPersonaBody(disk2), null);
  assert.ok(disk2.includes("基线正文。"));
  assert.equal(persona.personaStatus(home).consistent, true);
});

test("applyPersonaSignal：首拍只记录；切换写新钉 rev++；幂等", (t) => {
  const home = tmpHome(t);
  seedInject(home, "基线正文。\n");
  persona.writePersona(home, "alpha", "ALPHA-正文");
  persona.resetPersonaSeenForTest();
  // 首拍：只记录不写钉（启动 seed 已把含块的磁盘正文 pin 进内存的语义）
  assert.deepEqual(persona.applyPersonaSignal(home), { changed: false, first: true });
  const rev0 = core.committedOverrideRevision();
  persona.switchPersona(home, "alpha");
  const r1 = persona.applyPersonaSignal(home);
  assert.equal(r1.changed, true);
  assert.equal(r1.active, "alpha");
  assert.equal(core.peekCommittedOverride(home), "ALPHA-正文");
  assert.ok(core.committedOverrideRevision() > rev0, "rev 必须递增（hungCache/liveRewriteCache 双失效的机关）");
  const resolved = rules.resolveInjectText(home);
  assert.equal(resolved.source, "prompt");
  assert.equal(resolved.text, "ALPHA-正文");
  // 幂等：rev/active 没变就不再动钉
  const rev1 = core.committedOverrideRevision();
  assert.equal(persona.applyPersonaSignal(home).changed, false);
  assert.equal(core.committedOverrideRevision(), rev1);
});

test("applyPersonaSignal --off：空串软撤钉，resolve 落穿磁盘基线", (t) => {
  const home = tmpHome(t);
  seedInject(home, "基线正文。\n");
  persona.writePersona(home, "alpha", "ALPHA-正文");
  persona.resetPersonaSeenForTest();
  persona.applyPersonaSignal(home); // 首拍记录
  persona.switchPersona(home, "alpha");
  persona.applyPersonaSignal(home);
  const rev1 = core.committedOverrideRevision();
  persona.clearActivePersona(home);
  const r = persona.applyPersonaSignal(home);
  assert.equal(r.changed, true);
  assert.equal(r.active, null);
  assert.ok(core.committedOverrideRevision() > rev1);
  assert.equal(core.peekCommittedOverride(home), "");
  const resolved = rules.resolveInjectText(home);
  assert.equal(resolved.text.includes("基线正文。"), true);
  assert.equal(resolved.text.includes("ALPHA-正文"), false);
});

test("applyPersonaSignal persona 文件丢失：软撤钉不炸", (t) => {
  const home = tmpHome(t);
  seedInject(home, "基线正文。\n");
  persona.writePersona(home, "alpha", "ALPHA-正文");
  persona.resetPersonaSeenForTest();
  persona.applyPersonaSignal(home); // 首拍记录
  // 外部把 persona 文件删掉，随后信号里还指着它
  fs.rmSync(path.join(persona.personasDir(home), "alpha.md"), { force: true });
  // 模拟「信号已写、persona 文件被外部删掉」的窗口：
  // active.json 直接指到已删除的名字（rev 变了才会重新读文件）
  fs.writeFileSync(
    persona.personaStatePath(home),
    JSON.stringify({ active: "alpha", rev: 1, ts: Date.now() }),
    "utf8",
  );
  const r2 = persona.applyPersonaSignal(home);
  assert.equal(r2.changed, true);
  assert.equal(r2.active, "alpha");
  assert.equal(r2.missing, true);
  assert.equal(core.peekCommittedOverride(home), "");
});

test("savePersonaFromInject + deletePersona（删除激活中的 persona 连带撤信号）", (t) => {
  const home = tmpHome(t);
  seedInject(home, "基线正文。\n" + persona.personaBlock("OLD-正文"));
  const saved = persona.savePersonaFromInject(home, "saved-1");
  assert.equal(saved.name, "saved-1");
  assert.ok(persona.readPersona(home, "saved-1").includes("基线正文。"));
  assert.equal(persona.readPersona(home, "saved-1").includes("OLD-正文"), false, "保存时必须剥掉旧 persona 块");
  persona.switchPersona(home, "saved-1");
  const del = persona.deletePersona(home, "saved-1");
  assert.equal(del.removed, true);
  assert.equal(del.cleared.active, null);
  assert.equal(persona.readPersonaState(home).active, null);
  assert.equal(persona.personaStatus(home).onDisk, false);
});
