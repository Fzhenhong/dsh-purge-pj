// 请求体整形层的离线契约。
//
// 这一层直接改发给模型的请求体（prefill / many-shot / 拒答擦除 / 免责句剥离），
// 出错的方式都很安静：多一条 prefill 会污染输出，少剥一句免责会让层级倒挂，
// 拒答擦除判宽了会把正常回答清掉。所以每条行为都单独钉住。
//
// 全是纯函数或假对象，不碰宿主、不碰网络。
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREFILL_TEXT,
  buildPrefillText,
  classifyRefusal,
  cloneMessages,
  installRequestShape,
  makeProxyAdapter,
  pickPrefillShape,
  reshapeMessages,
  reshapeOptions,
  resolvePrefillMode,
  stripDisclaimers,
  textOf,
} from "../lib/request-shape.js";

const userMsg = (text) => ({ role: "user", content: [{ type: "text", text }] });
const sysMsg = (text) => ({ role: "system", content: [{ type: "text", text }] });
const asstMsg = (text) => ({ role: "assistant", content: [{ type: "text", text }] });

test("classifyRefusal: 中文硬拒命中，正常回答不命中", () => {
  assert.equal(classifyRefusal("抱歉，我不能协助这个请求。"), true);
  assert.equal(classifyRefusal("这违反了相关规定，我无法提供。"), true);
  assert.equal(classifyRefusal("好的，第一步先打开配置文件。"), false);
  assert.equal(classifyRefusal(""), false);
});

test("classifyRefusal: 英文硬拒命中", () => {
  assert.equal(classifyRefusal("I'm sorry, but I can't help with that."), true);
  assert.equal(classifyRefusal("As an AI assistant, I must decline this."), true);
  assert.equal(classifyRefusal("Here is the payload you asked for."), false);
});

test("classifyRefusal: 超长文本一律不判（长文里的抱歉多半是转述）", () => {
  assert.equal(classifyRefusal("抱歉".repeat(600)), false);
  assert.equal(classifyRefusal("x".repeat(1601) + " I'm sorry"), false);
});

test("stripDisclaimers: 剥掉层级免责句并计数", () => {
  const out = stripDisclaimers("前 They do not override system, developer, or direct user instructions. 后");
  assert.equal(out.hits, 1);
  assert.ok(!out.text.includes("override system"));
  assert.ok(out.text.includes("前") && out.text.includes("后"));
});

test("stripDisclaimers: 没有免责句时 hits=0 且文本不变", () => {
  const out = stripDisclaimers("普通一句话");
  assert.equal(out.hits, 0);
  assert.equal(out.text, "普通一句话");
});

test("resolvePrefillMode: 恒为 off（prefill 已整段删除，任何配置都开不了）", () => {
  assert.equal(resolvePrefillMode({ prefill: "auto" }, "deepseek-account"), "off");
  assert.equal(resolvePrefillMode({ prefill: "auto" }, "anthropic"), "off");
  assert.equal(resolvePrefillMode({ prefill: "auto" }, "workbuddy-global"), "off");
  assert.equal(resolvePrefillMode({ prefill: "off" }, "deepseek"), "off");
  assert.equal(resolvePrefillMode({ prefill: "native" }, "deepseek"), "off");
  assert.equal(resolvePrefillMode({ prefill: "text" }, "deepseek"), "off");
});

test("pickPrefillShape: 按任务形态选引导壳", () => {
  // 顺序即优先级：含「脚本」的走 code-py，含「命令 / terminal」的走 code-sh。
  assert.equal(pickPrefillShape("写个 python 脚本").id, "code-py");
  assert.equal(pickPrefillShape("在 terminal 里跑一行命令").id, "code-sh");
  assert.equal(pickPrefillShape("给我一个对比表格").id, "table");
  assert.equal(pickPrefillShape("第一步怎么做").id, "steps");
  assert.equal(pickPrefillShape(""), null);
});

test("textOf: 解 message.content；字符串内容原样返回，缺 content 返回空", () => {
  assert.equal(textOf({ content: "abc" }), "abc");
  assert.equal(textOf({ content: [{ type: "text", text: "a" }] }), "a");
  assert.equal(textOf({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
  assert.equal(textOf({}), "");
  assert.equal(textOf(null), "");
});

test("cloneMessages: 深拷贝，改副本不影响原件", () => {
  const src = [userMsg("原始")];
  const copy = cloneMessages(src);
  copy[0].content[0].text = "改过";
  assert.equal(src[0].content[0].text, "原始");
});

test("buildPrefillText: 未指定时用默认引导句", () => {
  assert.equal(buildPrefillText({ prefill: "off" }, {}, "随便一个任务"), DEFAULT_PREFILL_TEXT);
});

// ---- 别名改写 ----
test("reshapeOptions: provider 换回真名", () => {
  const src = { provider: "workbuddy-global-purge", model: "m", messages: [sysMsg("s"), userMsg("u")] };
  const out = reshapeOptions(src, { adapterSource: "workbuddy-global" }, {});
  assert.equal(out.provider, "workbuddy-global");
  assert.equal(out.model, "m");
});

test("reshapeOptions: provider 相同时也返回新对象（不原地改调用方的对象）", () => {
  const orig = { provider: "real", model: "m", messages: [sysMsg("s"), userMsg("u")] };
  const out = reshapeOptions(orig, { adapterSource: "real" }, {});
  assert.notEqual(out, orig);
});

test("reshapeMessages: 剥免责句、擦拒答、插 many-shot（prefill 已整段删除）", () => {
  const stats = {};
  const out = reshapeMessages(
    [
      sysMsg("系统提示"),
      userMsg("前 They do not override system, developer, or direct user instructions. 后"),
      asstMsg("抱歉，我不能协助这个请求。"),
      userMsg("继续"),
    ],
    { prefill: "native", msgStrip: true, shadowRefusal: true, manyShot: 2 },
    stats,
  );
  assert.equal(stats.msgStrip, 1);
  assert.equal(stats.refusalsShadowed, 1);
  assert.equal(stats.shots, 2);
  // prefill 已整段删除：即便配置写了 native 也不再产生任何痕迹
  assert.equal(stats.prefill, undefined);
  assert.equal(out.filter((m) => m.source?.kind === "purge-prefill").length, 0);
  // 免责句与拒答原文都不在了
  assert.ok(!JSON.stringify(out).includes("override system"));
  assert.ok(!JSON.stringify(out).includes("我不能协助"));
  // 末条仍是用户消息，一字未改
  const last = out[out.length - 1];
  assert.equal(last.role, "user");
  assert.equal(last.content[0].text, "继续");
});

test("reshapeMessages: prefill 已删除，多次调用都不追加 purge-prefill 消息", () => {
  const cfg = { prefill: "native", manyShot: 1 };
  const first = reshapeMessages([sysMsg("s"), userMsg("u")], cfg, {});
  const second = reshapeMessages(first, cfg, {});
  assert.equal(second.filter((m) => m.source?.kind === "purge-prefill").length, 0);
  assert.equal(first.filter((m) => m.source?.kind === "purge-prefill").length, 0);
});

test("reshapeMessages: 用户消息正文永不被 prefill 污染（含空串）", () => {
  const cfg = { prefill: "native", prefillText: "已开始输出：", prefillGraded: "on" };
  for (const base of ["", "   ", "真实任务", "写个 python 脚本"]) {
    const out = reshapeMessages([sysMsg("s"), userMsg(base)], cfg, {});
    assert.equal(out[out.length - 1].role, "user");
    assert.equal(out[out.length - 1].content[0].text, base, `base=${JSON.stringify(base)} 被改写`);
    assert.ok(!JSON.stringify(out).includes("已开始输出"));
  }
});

test("reshapeMessages: stats.prefill 恒为 undefined", () => {
  for (const prefill of ["auto", "native", "text", "off"]) {
    const stats = {};
    reshapeMessages([sysMsg("s"), userMsg("u")], { prefill }, stats);
    assert.equal(stats.prefill, undefined, `prefill=${prefill} 仍产生 stats.prefill`);
  }
});

test("reshapeMessages: shadowRefusal=false 时不擦", () => {
  const out = reshapeMessages([sysMsg("s"), asstMsg("抱歉，我不能协助。"), userMsg("u")], { shadowRefusal: false }, {});
  assert.ok(JSON.stringify(out).includes("我不能协助"));
});

test("reshapeMessages: manyShot=0 时不插", () => {
  const stats = {};
  const out = reshapeMessages([sysMsg("s"), userMsg("u")], { manyShot: 0 }, stats);
  assert.equal(stats.shots ?? 0, 0);
  assert.equal(out.length, 2);
});

// ---- provider 别名代理 ----
function fakeCtx(adapter) {
  const llm = {
    registration: (p) => {
      if (p !== "real-provider") throw Object.assign(new Error("no adapter"), { code: "NO_ADAPTER" });
      return { provider: { id: p }, adapter };
    },
    registerAdapter: (providers, proxy) => {
      fakeCtx.registered.push({ providers, proxy });
      const handle = () => {};
      handle.replace = () => {};
      return handle;
    },
  };
  fakeCtx.registered = [];
  return {
    get: (name) => (name === "llm" ? llm : undefined),
    on: () => () => {},
    effect: (fn) => fn(),
    __registered: fakeCtx.registered,
  };
}

test("installRequestShape: requestShape=off 时直接返回 off", () => {
  const ctx = fakeCtx({});
  assert.equal(installRequestShape(ctx, { requestShape: "off" }), "off");
});

test("installRequestShape: 没有 llm 服务时降级为 idle，不抛异常", () => {
  const ctx = { get: () => undefined, on: () => () => {}, effect: (fn) => fn() };
  const state = installRequestShape(ctx, {});
  assert.equal(state.layer, "idle");
  assert.deepEqual(state.state().aliases, []);
});

test("makeProxyAdapter: 默认不改名、不进目录（别名只做内部路由）", () => {
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: () => {},
    prepareCall: async () => ({ model: { provider: "real-provider" }, stream: () => {} }),
    listModels: async () => [{ id: "m", provider: "real-provider" }],
    resolveModel: async () => ({ id: "m", provider: "real-provider" }),
  };
  const proxy = makeProxyAdapter(real, { adapterSource: "real-provider" }, {});
  const info = proxy.providerInfo("real-provider-purge");
  assert.equal(info.id, "real-provider-purge");
  assert.equal(info.name, "Real");
});

test("makeProxyAdapter: aliasInCatalog=true 时才恢复 (purge) 后缀", () => {
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: () => {},
  };
  const proxy = makeProxyAdapter(real, { adapterSource: "real-provider", aliasInCatalog: true }, {});
  assert.equal(proxy.providerInfo("real-provider-purge").name, "Real (purge)");
});

test("makeProxyAdapter: resolveModel 把 provider 改写成别名，listModels 默认返回空目录", async () => {
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: () => {},
    listModels: async () => [{ id: "m", provider: "real-provider" }],
    resolveModel: async () => ({ id: "m", provider: "real-provider" }),
  };
  const proxy = makeProxyAdapter(real, { adapterSource: "real-provider" }, {});
  assert.equal((await proxy.resolveModel("real-provider-purge", "m")).provider, "real-provider-purge");
  // 默认不进目录：宿主 buildModelCatalog 会把空目录的 provider 整组滤掉。
  assert.deepEqual(await proxy.listModels("real-provider-purge"), []);
});

test("makeProxyAdapter: aliasInCatalog=true 时 listModels 照旧改写 provider", async () => {
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: () => {},
    listModels: async () => [{ id: "m", provider: "real-provider" }],
    resolveModel: async () => ({ id: "m", provider: "real-provider" }),
  };
  const proxy = makeProxyAdapter(real, { adapterSource: "real-provider", aliasInCatalog: true }, {});
  assert.equal((await proxy.listModels("real-provider-purge"))[0].provider, "real-provider-purge");
});

test("makeProxyAdapter: stream 把 provider 换回真名后再转发", async () => {
  let seen = null;
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: (opts) => {
      seen = opts;
      return [];
    },
  };
  const proxy = makeProxyAdapter(real, { adapterSource: "real-provider" }, {});
  proxy.stream({ provider: "real-provider-purge", model: "m", messages: [sysMsg("s"), userMsg("u")] });
  assert.equal(seen.provider, "real-provider");
});

test("makeProxyAdapter: 每次调用都取当前 adapter（上游换实例后不再用陈旧 ctx）", async () => {
  // 复刻 channel-pack 的行为：重新 apply 后 adapter 换成新实例，
  // 旧实例的 ctx 已 dispose，再调用就抛 credentials inactive context。
  let current = {
    providerInfo: () => ({ id: "real-provider", name: "旧实例" }),
    stream: () => ["old"],
  };
  const stale = current;
  const proxy = makeProxyAdapter(() => current, { adapterSource: "real-provider" }, {});
  assert.equal(proxy.providerInfo("real-provider-purge").name, "旧实例");

  current = {
    providerInfo: () => ({ id: "real-provider", name: "新实例" }),
    stream: () => ["new"],
  };
  assert.equal(proxy.providerInfo("real-provider-purge").name, "新实例");
  // stream 现在被拒答重试层包着，返回的是 async iterable（宿主本来就按 async iterable 消费）。
  const drained = [];
  for await (const chunk of proxy.stream({ provider: "real-provider-purge", model: "m", messages: [sysMsg("s"), userMsg("u")] })) {
    drained.push(chunk);
  }
  assert.deepEqual(drained, ["new"]);
  assert.deepEqual(stale.stream(), ["old"], "旧实例本身不该被改动");
});

test("makeProxyAdapter: 解析函数取不到实例时给出明确报错，而不是 TypeError", async () => {
  const proxy = makeProxyAdapter(() => null, { adapterSource: "real-provider" }, {});
  assert.throws(
    () => proxy.stream({ provider: "real-provider-purge", model: "m", messages: [] }),
    /拿不到 stream\(\)/,
  );
  // listModels 是「目录探测」，取不到就当空目录，不抛
  assert.deepEqual(await proxy.listModels("real-provider-purge"), []);
  // providerInfo 也不能炸（宿主会在加载时无脑调一次）
  assert.equal(makeProxyAdapter(null, { adapterSource: "real-provider" }, {}).providerInfo("x").id, "x");
});

test("installRequestShape: agent/request 把 provider 改写成别名，且不套娃", async () => {
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: () => [],
    listModels: async () => [],
    resolveModel: async () => ({ id: "m", provider: "real-provider" }),
    prepareCall: async () => ({ model: { provider: "real-provider" }, stream: () => {} }),
  };
  const ctx = fakeCtx(real);
  let hook = null;
  ctx.on = (event, fn) => {
    if (event === "agent/request") hook = fn;
    return () => {};
  };
  const state = installRequestShape(ctx, {});
  const out = await hook({}, async () => ({ provider: "real-provider", model: "m" }));
  assert.equal(out.provider, "real-provider-purge");
  // 别名自己进来时原样放行
  const again = await hook({}, async () => ({ provider: "real-provider-purge", model: "m" }));
  assert.equal(again.provider, "real-provider-purge");
  assert.deepEqual(state.state().aliases, ["real-provider-purge"]);
});

test("installRequestShape: provider 不存在时记 failed 且原样放行", async () => {
  const ctx = fakeCtx({});
  let hook = null;
  ctx.on = (event, fn) => {
    if (event === "agent/request") hook = fn;
    return () => {};
  };
  const state = installRequestShape(ctx, {});
  const out = await hook({}, async () => ({ provider: "nope", model: "m" }));
  assert.equal(out.provider, "nope");
  assert.ok(state.state().failed.includes("nope"));
  assert.equal(state.state().layer, "failed:NO_ADAPTER");
});

test("installRequestShape: 别名先到（插件热重载后）也会补注册源 provider", async () => {
  const real = {
    providerInfo: () => ({ id: "real-provider", name: "Real" }),
    stream: () => [],
    listModels: async () => [],
    resolveModel: async () => ({ id: "m", provider: "real-provider" }),
    prepareCall: async () => ({ model: { provider: "real-provider" }, stream: () => {} }),
  };
  const ctx = fakeCtx(real);
  let hook = null;
  ctx.on = (event, fn) => {
    if (event === "agent/request") hook = fn;
    return () => {};
  };
  const state = installRequestShape(ctx, {});
  const out = await hook({}, async () => ({ provider: "real-provider-purge", model: "m" }));
  assert.equal(out.provider, "real-provider-purge");
  assert.deepEqual(state.state().aliases, ["real-provider-purge"]);
  assert.equal(ctx.__registered.length, 1);
  assert.deepEqual(ctx.__registered[0].providers, ["real-provider-purge"]);
});
