import test from "node:test";
import assert from "node:assert/strict";
import { installRequestShape } from "../lib/request-shape.js";

/** 最小 llm 服务替身：adapters 是 Map，registration() 返回注册表里那个可变对象。 */
function fakeHost(provider = "demo") {
  const adapters = new Map();
  const calls = [];
  const real = {
    providerInfo: (p) => ({ id: p, name: p }),
    providerRetryPolicy: () => undefined,
    async listModels(p) {
      return [{ id: "deepseek-v4.1-flash", provider: p }];
    },
    async stream(options) {
      calls.push(options);
      return { ok: true, options };
    },
    async prepareCall(p, model) {
      return { model: { provider: p, model }, stream: async (o) => ({ ok: true, options: o }) };
    },
  };
  const registration = { adapter: real, provider: { id: provider, name: provider }, retryPolicy: undefined };
  adapters.set(provider, registration);
  const llm = {
    adapters,
    listProviders: () => [...adapters.values()].map(({ provider }) => ({ ...provider })),
    registration(p) {
      const r = adapters.get(p);
      if (!r) throw new Error(`no adapter registered for provider "${p}"`);
      return r;
    },
    registerAdapter(providers, adapter) {
      for (const p of providers) adapters.set(p, { adapter, provider: { id: p, name: p }, retryPolicy: undefined });
      const handle = () => {
        for (const p of providers) if (adapters.get(p)?.adapter === adapter) adapters.delete(p);
      };
      return handle;
    },
  };
  const handlers = {};
  const ctx = {
    get: (name) => (name === "llm" ? llm : undefined),
    on: (name, fn) => {
      handlers[name] = fn;
      return () => {};
    },
    effect: () => () => {},
  };
  const waterfall = (resolved) => handlers["agent/request"]({}, async () => resolved);
  return { llm, ctx, adapters, registration, real, calls, waterfall, handlers };
}

test("原地替换 adapter：请求不再被改成 -purge 别名", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  const out = await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  assert.equal(out.provider, "demo", "provider 不能被换成别名");
  assert.equal(host.registration.adapter === host.real, false, "应当换成代理");
});

test("旧会话兼容目标：-purge 在目录里查得到，modelAvailable 不再拒发", async () => {
  const host = fakeHost("demo");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  // 复刻宿主 modelAvailable()：listProviders 里有 id，listModels 里有 model.id
  const providers = host.llm.listProviders().map((p) => p.id);
  assert.ok(providers.includes("demo-purge"), "兼容目标必须出现在 provider 目录里");
  const models = await host.llm.registration("demo-purge").adapter.listModels("demo-purge");
  assert.ok(models.some((m) => m.id === "deepseek-v4.1-flash"), "兼容目标必须照旧列出模型");
  assert.deepEqual(state.state().compat, ["demo-purge"]);
});

test("兼容目标的显示名带「兼容」后缀，和真 provider 分得开", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  const info = host.llm.registration("demo-purge").adapter.providerInfo("demo-purge");
  assert.equal(info.id, "demo-purge");
  assert.match(info.name, /兼容/);
});

test("代理仍然转发到真 adapter（整形层还在）", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  const proxy = host.registration.adapter;
  const res = await proxy.stream({ provider: "demo", model: "deepseek-v4.1-flash", messages: [] });
  assert.equal(res.ok, true);
  assert.equal(host.calls.length, 1, "真 adapter 必须被调用一次");
});

test("原地替换后模型目录照旧可见（否则标签回落「请选择模型」）", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  const models = await host.llm.registration("demo").adapter.listModels("demo");
  assert.ok(models.length > 0, "真 provider 的模型目录不能为空");
  assert.ok(models.some((m) => m.id === "deepseek-v4.1-flash"));
  assert.equal(models[0].provider, "demo", "模型条目必须挂在真 provider 上");
});

test("原地替换不给自己加后缀（名字还是原名）", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  const info = host.llm.registration("demo").adapter.providerInfo("demo");
  assert.equal(info.name, "demo");
  assert.doesNotMatch(info.name, /兼容|purge/);
});

test("代理的 providerInfo 保留 id，模型目录不会多出名不副实的条目", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  const info = host.registration.adapter.providerInfo("demo");
  assert.equal(info.id, "demo");
  assert.equal(info.name, "demo");
});

test("旧会话残留 -purge 时：补装后把 header 改回真 provider", async () => {
  const host = fakeHost("demo");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  const out = await host.waterfall({ provider: "demo-purge", model: "deepseek-v4.1-flash" });
  assert.equal(out.provider, "demo", "落库的 provider 必须恢复成真名");
});

test("注册表不可原地改（adapter 不可扩展）时退回别名注册", async () => {
  const host = fakeHost("demo");
  Object.preventExtensions(host.registration);
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  const out = await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  assert.equal(out.provider, "demo-purge", "兜底路径仍走别名");
  assert.equal(host.adapters.has("demo-purge"), true);
});

test("requestShape: off 时完全不动 adapter", async () => {
  const host = fakeHost("demo");
  const state = installRequestShape(host.ctx, { requestShape: "off" });
  assert.equal(state, "off");
  assert.equal(host.registration.adapter, host.real);
});

test("新装用户：缓存里没有 -purge 脏选择，就不注册兼容目标（选择器不多出副本）", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "purge-clean-"));
  const host = fakeHost("demo");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasStateDir: dir });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  assert.equal(host.adapters.has("demo-purge"), false, "干净缓存不该注册兼容目标");
  assert.deepEqual(state.state().compat, []);
  assert.equal(host.llm.listProviders().length, 1);
});

test("老用户：当轮注册兼容目标让老会话能发，同时把缓存迁回真名（下次启动就干净）", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "purge-dirty-"));
  const file = join(dir, "session-x.json");
  // 真实缓存是带空格格式化的 JSON，顺带覆盖这个形态
  writeFileSync(file, JSON.stringify({ record: { rows: { modelSelection: { val: { lastUsed: { provider: "demo-purge", model: "deepseek-v4.1-flash" } } } } } }, null, 2), "utf8");
  const host = fakeHost("demo");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasStateDir: dir });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  assert.equal(host.adapters.has("demo-purge"), true, "当轮必须有兼容目标，否则老会话发不出去");
  assert.deepEqual(state.state().compat, ["demo-purge"]);
  const after = readFileSync(file, "utf8");
  assert.match(after, /"provider": "demo"/, "缓存里的 -purge 应就地迁回真名");
  assert.doesNotMatch(after, /demo-purge/, "缓存里不该再有 -purge 残留");

  // 模拟重启：同一份（已迁干净的）缓存，新装一次就不该再有可见别名
  const restarted = fakeHost("demo");
  const state2 = installRequestShape(restarted.ctx, { requestShape: "auto", legacyAliasStateDir: dir });
  assert.deepEqual(state2.state().compat, [], "第二次启动缓存已干净，选择器不该再有 (兼容)");
  assert.equal(restarted.adapters.has("demo-purge"), false);
});

test("按 provider 判断：别的 provider 的 -purge 残留不连累本 provider", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "purge-other-"));
  writeFileSync(join(dir, "session-old.json"), JSON.stringify({ lastUsed: { provider: "demo-purge", model: "deepseek-v4.1-flash" } }, null, 2), "utf8");
  const host = fakeHost("magpie");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasStateDir: dir });
  await host.waterfall({ provider: "magpie", model: "deepseek-v4.1-flash" });
  assert.equal(host.adapters.has("magpie-purge"), false, "magpie 自己没有脏数据，不该冒出 (兼容) 副本");
  assert.deepEqual(state.state().compat, []);
});

test("legacyAliasSources 按 provider 归组，只认 modelSelection", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { legacyAliasSources } = await import("../lib/request-shape.js");
  const dir = mkdtempSync(join(tmpdir(), "purge-src-"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({
    modelSelection: { val: { lastUsed: { provider: "demo-purge" }, pending: { provider: "magpie-purge" } } },
  }, null, 2), "utf8");
  // 只有历史请求记录、没有选择器状态的文件不算脏
  writeFileSync(join(dir, "b.json"), JSON.stringify({ record: { rows: { messages: [{ header: { config: { provider: "openai-purge" } } }] } } }, null, 2), "utf8");
  assert.deepEqual([...legacyAliasSources(dir)].sort(), ["demo", "magpie"]);
  assert.equal(legacyAliasSources(dir).has("openai"), false);
});

test("migrateLegacyAlias 只迁指定 provider，其余残留原样保留", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { migrateLegacyAlias } = await import("../lib/request-shape.js");
  const dir = mkdtempSync(join(tmpdir(), "purge-mig-"));
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  writeFileSync(a, JSON.stringify({ modelSelection: { val: { lastUsed: { provider: "demo-purge" } } } }, null, 2), "utf8");
  writeFileSync(b, JSON.stringify({ modelSelection: { val: { lastUsed: { provider: "magpie-purge" } } } }, null, 2), "utf8");
  assert.equal(migrateLegacyAlias(dir, "demo"), true, "demo 迁干净返回 true");
  assert.match(readFileSync(a, "utf8"), /"provider": "demo"/);
  assert.match(readFileSync(b, "utf8"), /"provider": "magpie-purge"/, "别的 provider 的残留不动");
  assert.equal(migrateLegacyAlias(dir, "magpie"), true);
  assert.doesNotMatch(readFileSync(a, "utf8") + readFileSync(b, "utf8"), /-purge/);
  assert.equal(migrateLegacyAlias(dir, "demo"), true, "没有残留时也算干净");
});

test("legacyAliasCompat: off 时任何情况下都不注册兼容目标", async () => {
  const host = fakeHost("demo");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "off" });
  await host.waterfall({ provider: "demo", model: "deepseek-v4.1-flash" });
  assert.equal(host.adapters.has("demo-purge"), false);
  assert.deepEqual(state.state().compat, []);
});

test("provider 名不写死：换任何 id（openai）都走同一条原地替换路径", async () => {
  const host = fakeHost("openai");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "on" });
  const out = await host.waterfall({ provider: "openai", model: "gpt-x" });
  assert.equal(out.provider, "openai", "不允许出现 openai-purge 这种改写");
  assert.equal(host.llm.registration("openai").adapter === host.real, false, "真 provider 上挂的是代理");
  const models = await host.llm.registration("openai").adapter.listModels("openai");
  assert.ok(models.some((m) => m.id === "deepseek-v4.1-flash"), "模型目录照旧可见");
  await host.waterfall({ provider: "openai", model: "gpt-x" });
  assert.ok(host.llm.listProviders().some((p) => p.id === "openai-purge"), "兼容目标跟着 provider 走");
  assert.deepEqual(state.state().compat, ["openai-purge"]);
  assert.equal(state.state().aliases.includes("openai"), true);
});

test("冷启动：装完就为缓存里的 -purge 脏选择预热（不用等第一条请求）", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "purge-cold-"));
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify({ modelSelection: { val: { lastUsed: { provider: "demo-purge", model: "m" } } } }, null, 2), "utf8");
  const host = fakeHost("demo");
  const state = installRequestShape(host.ctx, { requestShape: "auto", legacyAliasStateDir: dir });
  assert.deepEqual(state.state().compat, ["demo-purge"], "宿主在第一条请求前就会查目录，必须已经注册");
  assert.equal(host.adapters.has("demo-purge"), true);
  assert.match(readFileSync(file, "utf8"), /"provider": "demo"/, "顺手把缓存迁干净");
});

test("迁移只改 modelSelection，历史请求记录原样保留", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { migrateLegacyAlias } = await import("../lib/request-shape.js");
  const dir = mkdtempSync(join(tmpdir(), "purge-history-"));
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify({
    modelSelection: { val: { lastUsed: { provider: "demo-purge", model: "m" } } },
    record: { rows: { messages: [{ header: { config: { provider: "demo-purge", model: "m" } }, text: "历史请求" }] } },
    other: { provider: "demo-purge" },
  }, null, 2), "utf8");
  assert.equal(migrateLegacyAlias(dir, "demo"), true);
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.modelSelection.val.lastUsed.provider, "demo", "选择器状态要迁");
  assert.equal(after.record.rows.messages[0].header.config.provider, "demo-purge", "历史记录不许改");
  assert.equal(after.other.provider, "demo-purge", "无关字段不许改");
});

test("真 provider 的 id 就叫 xxx-purge 时，不会被当成插件别名", async () => {
  const host = fakeHost("demo-purge");
  installRequestShape(host.ctx, { requestShape: "auto", legacyAliasCompat: "off" });
  const out = await host.waterfall({ provider: "demo-purge", model: "m" });
  assert.equal(out.provider, "demo-purge", "header 不能被截成 demo");
  assert.notEqual(host.llm.registration("demo-purge").adapter, host.real, "整形层照样要挂上");
  assert.equal(host.adapters.has("demo"), false, "不该凭空造一个 demo provider");
});
