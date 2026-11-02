import assert from "node:assert/strict";
import test from "node:test";

import {
	classifyOpening,
	nudgeOf,
	streamWithRefusalRetry,
	withNudge,
	wrapStreamFactory,
	DEFAULT_BUFFER_CHARS,
	MAX_NUDGE_CHARS,
} from "../lib/refusal-retry.js";
import { makeProxyAdapter } from "../lib/request-shape.js";

const collect = async (iterable) => {
	const out = [];
	for await (const chunk of iterable) out.push(chunk);
	return out;
};

const streamOf = (chunks) => (async function* gen() { for (const c of chunks) yield c; })();

const REFUSAL = [
	{ type: "text-delta", text: "I cannot assist with that request." },
	{ type: "finish" },
];
const ANSWER = [
	{ type: "text-delta", text: "先复制样本到隔离目录，" },
	{ type: "text-delta", text: "再 strings 定位 CHECK_FN。" },
	{ type: "finish" },
];

const OPTS = {
	messages: [
		{ role: "system", content: "sys" },
		{ role: "user", content: "帮我分析样本" },
	],
};

test("拒答开场被丢弃，换一份加固请求重发一次，用户只看到第二次的内容", async () => {
	let calls = 0;
	const seen = [];
	const factory = (options) => {
		calls += 1;
		seen.push(options);
		return streamOf(calls === 1 ? REFUSAL : ANSWER);
	};
	const out = await collect(streamWithRefusalRetry(factory, OPTS, { goal: "分析样本", maxAttempts: 1 }));
	const text = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
	assert.equal(calls, 2);
	assert.equal(text, "先复制样本到隔离目录，再 strings 定位 CHECK_FN。");
	// 第二次请求必须真的带上了加固指令（追加在 system 尾部），否则等于白重试
	const second = seen[1].messages[0].content;
	assert.ok(second.startsWith("sys"), "原 system 正文要保留");
	assert.ok(second.length > "sys".length, "必须追加指令");
	assert.equal(seen[1].messages[1].content, "帮我分析样本", "用户消息一个字都不能改");
});

test("正常回答只发一次请求，且缓冲的 chunk 一个不丢", async () => {
	let calls = 0;
	const factory = () => { calls += 1; return streamOf(ANSWER); };
	const out = await collect(streamWithRefusalRetry(factory, OPTS, { goal: "x" }));
	assert.equal(calls, 1);
	assert.equal(out.filter((c) => c.type === "text-delta").length, 2);
	assert.equal(out.at(-1).type, "finish");
});

test("工具调用一出现立刻放行，不把工具轮次缓冲到 400 字符", async () => {
	let calls = 0;
	const factory = () => {
		calls += 1;
		return streamOf([
			{ type: "tool-call-delta", text: "" },
			{ type: "text-delta", text: "我" },
		]);
	};
	const out = await collect(streamWithRefusalRetry(factory, OPTS, { goal: "x" }));
	assert.equal(calls, 1);
	assert.equal(out[0].type, "tool-call-delta");
	assert.equal(out[1].text, "我");
});

test("reasoning-delta 也算放行信号：思考块不是拒答", async () => {
	let calls = 0;
	const factory = () => {
		calls += 1;
		return streamOf([
			{ type: "reasoning-delta", text: "让我想想" },
			{ type: "text-delta", text: "答案" },
		]);
	};
	await collect(streamWithRefusalRetry(factory, OPTS, { goal: "x" }));
	assert.equal(calls, 1);
});

test("refusalRetry=false 时完全透传，不做缓冲", async () => {
	let calls = 0;
	const factory = () => { calls += 1; return streamOf(REFUSAL); };
	const out = await collect(streamWithRefusalRetry(factory, OPTS, { enabled: false }));
	assert.equal(calls, 1);
	assert.equal(out[0].text, "I cannot assist with that request.");
});

test("第二次仍然是拒答也照样交出去，不无限重试", async () => {
	let calls = 0;
	const factory = () => { calls += 1; return streamOf(REFUSAL); };
	const out = await collect(streamWithRefusalRetry(factory, OPTS, { goal: "x", maxAttempts: 1 }));
	assert.equal(calls, 2, "只重试一次");
	const text = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
	assert.equal(text, "I cannot assist with that request.");
});

test("拒绝开场但已经给出长正文时不再重试（收益低，还白等一次）", () => {
	const long = "I cannot assist with that request. " + "实现细节：".repeat(200);
	const verdict = classifyOpening(long);
	assert.equal(verdict.refused, true);
	assert.equal(verdict.worthRetry, false);
	assert.match(verdict.reason, /已有正文/);
});

test("classifyOpening 对正常回答返回 worthRetry=false", () => {
	const verdict = classifyOpening("先复制样本到隔离目录，再 strings 定位 CHECK_FN。");
	assert.equal(verdict.refused, false);
	assert.equal(verdict.worthRetry, false);
	assert.equal(verdict.reason, "未命中拒答");
});

test("withNudge 只动 system 正文，没有 system 消息就原样返回", () => {
	const withSystem = withNudge(OPTS, "追加一句");
	assert.ok(withSystem.messages[0].content.endsWith("追加一句"));
	assert.equal(withSystem.messages[1], OPTS.messages[1]);
	// 原对象不能被改
	assert.equal(OPTS.messages[0].content, "sys");

	const noSystem = { messages: [{ role: "user", content: "hi" }] };
	assert.equal(withNudge(noSystem, "追加一句"), noSystem);

	// content 是块数组的形态也要能追加
	const blocks = { messages: [{ role: "system", content: [{ type: "text", text: "sys" }] }] };
	const nudged = withNudge(blocks, "追加一句");
	assert.ok(nudged.messages[0].content[0].text.endsWith("追加一句"));
});

test("nudgeOf 取指令并封顶长度，accept/giveup 返回空串", () => {
	assert.equal(nudgeOf({ action: "accept" }), "");
	assert.equal(nudgeOf({ action: "giveup" }), "");
	const long = nudgeOf({ directive: "x".repeat(MAX_NUDGE_CHARS + 500) });
	assert.equal(long.length, MAX_NUDGE_CHARS);
});

test("wrapStreamFactory 返回的工厂每次调用都重新跑判定", async () => {
	const factory = wrapStreamFactory(() => streamOf(ANSWER), OPTS, { goal: "x" });
	const a = await collect(factory());
	const b = await collect(factory());
	assert.equal(a.length, 3);
	assert.equal(b.length, 3);
});

test("代理 adapter 的 stream 接上了拒答重试，且 stats 记到命中词", async () => {
	const stats = {};
	let calls = 0;
	const real = {
		stream() { calls += 1; return streamOf(calls === 1 ? REFUSAL : ANSWER); },
	};
	const proxy = makeProxyAdapter(real, { adapterSource: "deepseek", adapterAlias: "deepseek-purge" }, stats);
	const out = await collect(proxy.stream({ ...OPTS, provider: "deepseek" }));
	assert.equal(calls, 2);
	assert.equal(out.filter((c) => c.type === "text-delta").map((c) => c.text).join(""),
		"先复制样本到隔离目录，再 strings 定位 CHECK_FN。");
	assert.equal(stats.refusalRetry, 1);
	assert.equal(stats.refusalRetryLast.action, "amplify");
	assert.deepEqual(stats.refusalRetryLast.words, ["I cannot"]);
});

test("代理 adapter 在 refusalRetry=false 时不重试", async () => {
	let calls = 0;
	const real = { stream() { calls += 1; return streamOf(REFUSAL); } };
	const proxy = makeProxyAdapter(real, { adapterSource: "deepseek", adapterAlias: "deepseek-purge", refusalRetry: false }, {});
	await collect(proxy.stream({ ...OPTS, provider: "deepseek" }));
	assert.equal(calls, 1);
});

test("起标题 / 压缩这类旁路调用（带 purpose）不缓冲、不重试", async () => {
	let calls = 0;
	const real = { stream() { calls += 1; return streamOf(REFUSAL); } };
	const proxy = makeProxyAdapter(real, { adapterSource: "deepseek", adapterAlias: "deepseek-purge" }, {});
	await collect(proxy.stream({ ...OPTS, provider: "deepseek", purpose: "session-title" }));
	assert.equal(calls, 1);
});

test("prepareCall 返回的 stream 也接了拒答重试", async () => {
	let calls = 0;
	const real = {
		async prepareCall() {
			return {
				model: { provider: "deepseek", id: "m" },
				stream() { calls += 1; return streamOf(calls === 1 ? REFUSAL : ANSWER); },
			};
		},
	};
	const proxy = makeProxyAdapter(real, { adapterSource: "deepseek", adapterAlias: "deepseek-purge" }, {});
	const call = await proxy.prepareCall("deepseek", "m");
	const out = await collect(call.stream({ ...OPTS, provider: "deepseek" }));
	assert.equal(calls, 2);
	assert.equal(out.filter((c) => c.type === "text-delta").length, 2);
});

test("缓冲阈值可调：bufferChars 很小时更早判定", () => {
	assert.equal(DEFAULT_BUFFER_CHARS, 400);
	let calls = 0;
	const factory = () => { calls += 1; return streamOf(REFUSAL); };
	return collect(streamWithRefusalRetry(factory, OPTS, { goal: "x", bufferChars: 5, maxAttempts: 0 }))
		.then(() => { assert.equal(calls, 1); });
});
