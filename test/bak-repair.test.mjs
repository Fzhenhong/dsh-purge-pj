import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_BAK_SUFFIX,
  appDirOfAiBase,
  findArchiveForAiBase,
  planBurnedBakRepair,
  repairBurnedBaksFromArchive,
  resourcesDirOfAiBase,
} from "../lib/bak-repair.js";

/** 造一棵假的宿主树：<root>/resources/app/dsh/node_modules/@deepseek-ai/dsh-x/lib/index.js */
function fakeHost({ withArchive = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-bak-"));
  const resources = path.join(root, "resources");
  const aiBase = path.join(resources, "app", "dsh", "node_modules", "@deepseek-ai");
  fs.mkdirSync(aiBase, { recursive: true });
  if (withArchive) fs.writeFileSync(path.join(resources, "app.asar"), "fake-asar", "utf8");
  return { root, resources, aiBase };
}

function writeHostFile(aiBase, rel, text, bakText) {
  const fp = path.join(aiBase, ...rel.split("/"));
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, text, "utf8");
  if (bakText !== undefined) fs.writeFileSync(fp + DEFAULT_BAK_SUFFIX, bakText, "utf8");
  return fp;
}

test("路径推导：aiBase → app → resources", () => {
  const { root, resources, aiBase } = fakeHost();
  assert.equal(path.resolve(appDirOfAiBase(aiBase)), path.join(resources, "app"));
  assert.equal(path.resolve(resourcesDirOfAiBase(aiBase)), resources);
  assert.equal(appDirOfAiBase(""), "");
  fs.rmSync(root, { recursive: true, force: true });
});

test("找得到 app.asar，也认 app.asar.bak 兜底", () => {
  const { root, resources, aiBase } = fakeHost({ withArchive: false });
  assert.equal(findArchiveForAiBase(aiBase).reason, "no-archive");
  fs.writeFileSync(path.join(resources, "app.asar.bak"), "x", "utf8");
  assert.equal(findArchiveForAiBase(aiBase).archive, path.join(resources, "app.asar.bak"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("只有 bak == current 的才算烧掉；干净 bak 不动", () => {
  const { root, resources, aiBase } = fakeHost();
  const burned = writeHostFile(aiBase, "dsh-a/lib/index.js", "patched", "patched");
  const clean = writeHostFile(aiBase, "dsh-b/lib/index.js", "patched", "original");
  const plan = planBurnedBakRepair(aiBase);
  assert.equal(plan.ok, true);
  assert.equal(plan.scanned, 2);
  const files = plan.burned.map((x) => x.file).sort();
  assert.deepEqual(files, [burned].sort());
  assert.ok(!files.includes(clean));
  assert.equal(plan.burned[0].rel, "dsh-a/lib/index.js");
  fs.rmSync(root, { recursive: true, force: true });
});

test("没有烧掉的 bak 时直接 ok 且 reason 说明", () => {
  const { root, resources, aiBase } = fakeHost();
  writeHostFile(aiBase, "dsh-a/lib/index.js", "patched", "original");
  const plan = planBurnedBakRepair(aiBase);
  assert.equal(plan.ok, true);
  assert.equal(plan.reason, "no-burned-bak");
  assert.deepEqual(plan.burned, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("没有 aiBase / 目录不存在时不抛", () => {
  assert.equal(planBurnedBakRepair("").reason, "no-ai-base");
  assert.equal(planBurnedBakRepair(path.join(os.tmpdir(), "definitely-missing-xyz")).reason, "no-ai-base");
});

test("有烧掉的 bak 但没有归档时，ok=false 并说明原因", () => {
  const { root, resources, aiBase } = fakeHost({ withArchive: false });
  writeHostFile(aiBase, "dsh-a/lib/index.js", "patched", "patched");
  const plan = planBurnedBakRepair(aiBase);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "no-archive");
  assert.equal(plan.burned.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("归档解不出来时 ok=false / extract-failed，临时目录被清掉", () => {
  const { root, resources, aiBase } = fakeHost();
  writeHostFile(aiBase, "dsh-a/lib/index.js", "patched", "patched");
  // fake-asar 不是合法归档，extractAsar 会抛。
  const out = repairBurnedBaksFromArchive(aiBase, { write: true });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "extract-failed");
  assert.ok(out.error.length > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("默认只出计划，不落盘", () => {
  const { root, resources, aiBase } = fakeHost();
  const fp = writeHostFile(aiBase, "dsh-a/lib/index.js", "patched", "patched");
  const out = repairBurnedBaksFromArchive(aiBase);
  assert.equal(out.written.length, 0);
  assert.equal(fs.readFileSync(fp + DEFAULT_BAK_SUFFIX, "utf8"), "patched");
  fs.rmSync(root, { recursive: true, force: true });
});
