// hostCompat 分档回归：曾经只认「与 dshTarget 逐字相同」，于是声明 rc.2、在跑 rc.3/rc.5
// 的宿主永远被标成「未适配」——而实际上官方原文没变、94 条补丁全 applied。
// 现在分 exact / prerelease / patch / minor / major 五档，只有跨 minor 及以上才算不适配。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostCompat, parseHostVersion } from "../lib/core.js";

function fakeHost(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-hostcompat-"));
  const pkgDir = path.join(root, "node_modules", "@deepseek-ai", "dsh");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@deepseek-ai/dsh", version }),
    "utf8",
  );
  return { aiBase: path.join(root, "node_modules", "@deepseek-ai"), root };
}

test("parseHostVersion 拆出 major/minor/patch/prerelease", () => {
  assert.deepEqual(parseHostVersion("0.2.1-rc.3"), {
    major: 0, minor: 2, patch: 1, pre: ["rc", "3"],
  });
  assert.deepEqual(parseHostVersion("v1.0.0"), { major: 1, minor: 0, patch: 0, pre: [] });
  assert.equal(parseHostVersion("garbage"), null);
});

test("rc 号不同只算 prerelease，不算不适配", () => {
  const { aiBase, root } = fakeHost("0.2.1-rc.3");
  try {
    const r = hostCompat(aiBase, "0.2.1-rc.2");
    assert.equal(r.known, true);
    assert.equal(r.ok, true, "rc.3 与声明的 rc.2 只是预发布号不同");
    assert.equal(r.level, "prerelease");
    assert.equal(r.host, "0.2.1-rc.3");
    assert.equal(r.target, "0.2.1-rc.2");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("完全一致算 exact", () => {
  const { aiBase, root } = fakeHost("0.2.1-rc.2");
  try {
    const r = hostCompat(aiBase, "0.2.1-rc.2");
    assert.equal(r.level, "exact");
    assert.equal(r.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("跨 patch / minor / major 都算不适配（原文可能已改）", () => {
  for (const [host, target, level] of [
    ["0.2.2", "0.2.1", "patch"],
    ["0.3.0", "0.2.1-rc.2", "minor"],
    ["1.0.0", "0.2.1-rc.2", "major"],
  ]) {
    const { aiBase, root } = fakeHost(host);
    try {
      const r = hostCompat(aiBase, target);
      assert.equal(r.level, level, `${host} vs ${target}`);
      // 只有 exact / prerelease 算 ok：patch 号变了也可能改了原文，
      // 真改了会由 drifted 状态单独报出来，不必在这里抢答。
      assert.equal(r.ok, false, `${host} vs ${target} ok`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("宿主版本读不到时 known=false、ok=null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-hostcompat-none-"));
  try {
    const r = hostCompat(path.join(root, "node_modules", "@deepseek-ai"), "0.2.1-rc.2");
    assert.equal(r.known, false);
    assert.equal(r.ok, null);
    assert.equal(r.level, "unknown");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
