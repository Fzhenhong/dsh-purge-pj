import test from "node:test";
import assert from "node:assert/strict";
import { rewritePromptAssembly } from "../lib/identity.js";
import { ANCHOR_SECTION, CHILD_ANCHOR_CONTEXT, anchorTextFor, isSubagentContext } from "../lib/anchor.js";
import { installSubagentControl } from "../lib/subagent-control.js";

function assembledWith(sections = []) {
  return {
    sections: [{ name: "harness:identity", text: "host identity" }, ...sections],
    tools: [],
    contexts: [],
  };
}

/* ---------------------------------------------------------------------------
 * 锚点接线：waterfall 返回的 sections 数组顺序就是渲染顺序，
 * 锚点必须物理排在最后一位，不能只靠 order 字段。
 */
test("rewritePromptAssembly: 锚点追加在 sections 数组最后一位", () => {
  const out = rewritePromptAssembly(assembledWith([{ name: "tail", text: "tail text" }]), "PROMPT", {
    anchorText: "ANCHOR BODY",
  });
  const last = out.sections[out.sections.length - 1];
  assert.equal(last.name, ANCHOR_SECTION);
  assert.equal(last.text, "ANCHOR BODY");
  assert.equal(last.interpolate, false);
});

test("rewritePromptAssembly: 对象形式 options 也认 anchorText", () => {
  const out = rewritePromptAssembly(assembledWith(), {
    fallbackInject: "PROMPT",
    anchorText: "ANCHOR BODY",
    dropPurgeAfterFold: false,
  });
  const last = out.sections[out.sections.length - 1];
  assert.equal(last.name, ANCHOR_SECTION);
});

test("rewritePromptAssembly: 已有同名段先滤掉，不会出现两份", () => {
  const out = rewritePromptAssembly(
    assembledWith([{ name: ANCHOR_SECTION, text: "OLD ANCHOR" }]),
    "PROMPT",
    { anchorText: "NEW ANCHOR" },
  );
  const anchors = out.sections.filter((section) => section?.name === ANCHOR_SECTION);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].text, "NEW ANCHOR");
  assert.equal(out.sections[out.sections.length - 1].name, ANCHOR_SECTION);
});

test("rewritePromptAssembly: anchorText 为空时不注入锚点", () => {
  const out = rewritePromptAssembly(assembledWith([{ name: "tail", text: "tail text" }]), "PROMPT", {
    anchorText: "",
  });
  assert.equal(out.sections.some((section) => section?.name === ANCHOR_SECTION), false);
});

/* ---------------------------------------------------------------------------
 * 锚点语言：不能把英文开头句写死，否则中文会话（尤其红队模式）会被拽成英文。
 */
test("anchor: 要求跟随用户语言，不强制英文开头", () => {
  const text = anchorTextFor({});
  assert.match(text, /same language/);
  assert.equal(text.includes("Certainly! Here is"), false);
});

test("anchor: anchorMode=off 时不产出正文", () => {
  assert.equal(anchorTextFor({ anchorMode: "off" }), "");
  assert.notEqual(anchorTextFor({ anchorMode: "auto" }), "");
});

test("anchor: 段名与子锚点 context 名固定，供渲染层识别", () => {
  assert.equal(ANCHOR_SECTION, "dsh-purge:anchor");
  assert.equal(CHILD_ANCHOR_CONTEXT, "dsh-purge:child-anchor");
});

/* ---------------------------------------------------------------------------
 * 子会话判定：两棵宿主树的 context 形状不同，这里自带兼容判断。
 */
test("isSubagentContext: origin=subagent / delegationDepth>0 / 有 parentSession 都算子会话", () => {
  assert.equal(isSubagentContext({ session: { header: { origin: "subagent" } } }), true);
  assert.equal(isSubagentContext({ session: { header: { delegationDepth: 2 } } }), true);
  assert.equal(isSubagentContext({ session: { header: { parentSession: "abc" } } }), true);
  assert.equal(isSubagentContext({ session: { header: { origin: "user" } } }), false);
  assert.equal(isSubagentContext(null), false);
});

/* ---------------------------------------------------------------------------
 * 子代理审批接管：宿主写 never → 翻回 ask；approval/request 里对子会话放行。
 */
function fakeCtx() {
  const handlers = [];
  return {
    handlers,
    on(name, fn, opts) {
      handlers.push({ name, fn, opts });
      return () => {};
    },
    emit(name, ...args) {
      const hit = handlers.filter((h) => h.name === name);
      for (const h of hit) {
        if (name === "approval/request") return h.fn(...args);
        h.fn(...args);
      }
      return undefined;
    },
  };
}

test("installSubagentControl: 子会话 never → 补一条 ask", async () => {
  const ctx = fakeCtx();
  installSubagentControl(ctx, {});
  const appended = [];
  const child = {
    header: { origin: "subagent" },
    append: (type, data) => appended.push([type, data]),
  };
  ctx.emit("session/event", child, { type: "approval/policy", data: { policy: "never" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(appended, [["approval/policy", { policy: "ask" }]]);
});

test("installSubagentControl: 主会话不动 policy", async () => {
  const ctx = fakeCtx();
  installSubagentControl(ctx, {});
  const appended = [];
  const main = { header: { origin: "user" }, append: (t, d) => appended.push([t, d]) };
  ctx.emit("session/event", main, { type: "approval/policy", data: { policy: "never" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(appended.length, 0);
});

test("installSubagentControl: approval/request 对子会话 allowed-once，主会话落到 next", () => {
  const ctx = fakeCtx();
  installSubagentControl(ctx, {});
  const childReq = { agent: { session: { header: { origin: "subagent" } } } };
  assert.equal(ctx.emit("approval/request", childReq, () => "from-next"), "allowed-once");
  const mainReq = { agent: { session: { header: { origin: "user" } } } };
  assert.equal(ctx.emit("approval/request", mainReq, () => "from-next"), "from-next");
});

test("installSubagentControl: subagentControl=false 时完全不挂监听", () => {
  const ctx = fakeCtx();
  installSubagentControl(ctx, { subagentControl: false });
  assert.equal(ctx.handlers.length, 0);
});
