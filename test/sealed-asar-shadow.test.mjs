import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealedAsarShadowWarning } from "../lib/core.js";

function layout({ withAsar = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-shadow-"));
  const resources = path.join(root, "resources");
  const appDir = path.join(resources, "app");
  const aiBase = path.join(appDir, "node_modules", "@deepseek-ai");
  fs.mkdirSync(aiBase, { recursive: true });
  const exe = path.join(root, "DSH NEXT.exe");
  fs.writeFileSync(exe, "");
  const asar = path.join(resources, "app.asar");
  if (withAsar) fs.writeFileSync(asar, "fake");
  return { root, exe, asar, appDir, aiBase };
}

test("归档还在时：补丁目录被影子覆盖，要报警", () => {
  const { exe, asar, aiBase } = layout();
  const warn = sealedAsarShadowWarning({ exe, asar, aiBase });
  assert.ok(warn, "应当报警");
  assert.equal(warn.asar, asar);
  assert.match(warn.message, /不会加载|不生效|实际加载/);
});

test("归档已改名（正常解包态）：不报警", () => {
  const { exe, asar, aiBase } = layout({ withAsar: false });
  assert.equal(sealedAsarShadowWarning({ exe, asar, aiBase }), null);
});

test("不是官方宿主可执行文件：不报警", () => {
  const { root, asar, aiBase } = layout();
  const other = path.join(root, "totally-other.exe");
  fs.writeFileSync(other, "");
  assert.equal(sealedAsarShadowWarning({ exe: other, asar, aiBase }), null);
});

test("aiBase 不在该 exe 的 app 目录下：不报警", () => {
  const { exe, asar } = layout();
  const stray = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-stray-"));
  assert.equal(sealedAsarShadowWarning({ exe, asar, aiBase: stray }), null);
});
