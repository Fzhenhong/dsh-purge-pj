// 槽位纪律（吸收自 ADWMC/helm-d 的会话隔离修复）。
//
// 背景：helm-d 的 e5a68f8 修的是一个很贵的坑 —— 它的 header 胶囊借用了官方
// `agent-preset` 的 slot id，于是把宿主自己的控件 shadow 掉了；同时它的
// header / gate / tab 在所有会话都渲染，非 helmd 会话里凭空多出不属于它的 UI。
//
// 落到我们身上是三条可机器检查的规矩：
//   1. 注册进宿主槽位的 id/key 必须带本插件前缀，绝不裸占官方 id；
//   2. 演练台源码（lib/redteam/client.js）不再自己注册槽位 —— 它的 apply()
//      会被 build-client 改写成 applyDrillParts()，那里的注册是死代码，
//      留着只会留下永远不会生效、却看着像在工作的 id；
//   3. 演练台入口必须被「当前会话是不是红队预设」闸住，非本插件会话不渲染。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "client.js");
const DRILL = path.join(ROOT, "lib", "redteam", "client.js");

const clientSrc = fs.readFileSync(CLIENT, "utf8");
const drillSrc = fs.readFileSync(DRILL, "utf8");

/** 抓所有 ctx.slots.register({...}) 的对象字面量。 */
function registeredSlots(source) {
  const out = [];
  const re = /ctx\.slots\.register\(\s*\{([\s\S]{0,400}?)\}\s*,/g;
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

const PREFIX = /^(dsh-purge|redteam)([-/]|$)/;

test("每个宿主槽位注册都用本插件前缀的 id/key，不裸占官方 id", () => {
  const slots = registeredSlots(clientSrc);
  // 1.1.90 合并后：上游 #208 把 undo 按钮挪出 conversation.input.right
  // （Android WebView composer 抛错会卸载输入框），rewind 改走
  // REWIND_HOST_ATTR fixed 宿主 + createPortal，不再注册槽位。
  // 剩余注册：conversation.chat.node 的 command-input + shell.overlay 的 dock。
  assert.ok(slots.length >= 2, `expected >= 2 slot registrations, got ${slots.length}`);
  for (const body of slots) {
    const id = /\bid:\s*["']([^"']+)["']/.exec(body);
    const key = /\bkey:\s*["']([^"']+)["']/.exec(body);
    const ident = id?.[1] ?? key?.[1];
    assert.ok(ident, `slot registration without id/key: ${body.trim().slice(0, 120)}`);
    assert.match(ident, PREFIX, `slot id "${ident}" must start with dsh-purge- or redteam-`);
  }
});

test("演练台源码不再注册槽位（那里的 apply 会被 build-client 改写掉）", () => {
  assert.equal(
    (drillSrc.match(/ctx\.slots\.register/g) || []).length,
    0,
    "lib/redteam/client.js must not register slots: build-client.mjs replaces apply()",
  );
  assert.equal(
    (drillSrc.match(/ctx\.slots\.inject/g) || []).length,
    0,
    "lib/redteam/client.js must not inject slots",
  );
});

test("演练台入口被红队预设闸住，非本插件会话不渲染", () => {
  // 页签本体：drillVisible 为假直接 null
  assert.match(
    clientSrc,
    /drillVisible \? h\("button", \{/,
    "drill tab must be conditional on drillVisible",
  );
  // body 兜底：即使 st.tab 残留 "drill"，也回落清洗页
  assert.match(
    clientSrc,
    /st\.tab === "clean" \|\| !drillVisible/,
    "drill body must fall back to the clean tab when the session is not redteam",
  );
  // 可见性来自会话预设探测，且并入已有的 1.5s sync 里（切会话/换预设会自己更新）
  assert.match(clientSrc, /const \[rtActive, setRtActive\] = useState\(\(\) => isRedteamModeActive\(\)\)/);
  assert.match(clientSrc, /setRtActive\(isRedteamModeActive\(\)\)/);
  // onTab 兜底，避免面板状态被写成 drill
  assert.match(clientSrc, /if \(id === "drill"\) \{\s*\n\s*if \(!drillVisible\) return;/);
});
