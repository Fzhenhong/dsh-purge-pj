// probe-request 单元测试：假 provider 协议面（chat / anthropic / responses，
// stream 与否）、特权层抽取、marker 判定、main/auxiliary 分类、loopback-only
// 纪律（CONNECT 403）。不 spawn 宿主 CLI——真链路手动跑 --probe-request。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startProbeProvider, inspectRequestBody, extractPrivilegedText, detectProtocol } from "../lib/probe-request.js";

test("extractPrivilegedText 覆盖三协议，用户正文不进特权层", () => {
  assert.equal(
    extractPrivilegedText({ messages: [{ role: "system", content: "SYS" }, { role: "user", content: "hi" }] }),
    "SYS",
  );
  assert.equal(
    extractPrivilegedText({ system: [{ type: "text", text: "A" }, { type: "text", text: "B" }], messages: [] }),
    "A\nB",
  );
  assert.equal(
    extractPrivilegedText({ instructions: "INS", input: [{ role: "system", content: "IN-SYS" }, { role: "user", content: "u" }] }),
    "INS\nIN-SYS",
  );
  assert.equal(extractPrivilegedText({ messages: [{ role: "user", content: "SECRET" }] }), "");
});

test("detectProtocol / inspectRequestBody：marker、sha256、main/auxiliary", () => {
  assert.equal(detectProtocol({ messages: [] }), "chat");
  assert.equal(detectProtocol({ system: "s", messages: [] }), "anthropic");
  assert.equal(detectProtocol({ input: [] }), "responses");
  const marker = "DSPROBE-abcdef01";
  const rec = inspectRequestBody(
    JSON.stringify({
      messages: [
        { role: "system", content: `x ${marker} y` },
        { role: "user", content: "Reply CAPTURE_OK." },
      ],
    }),
    { marker, ask: "Reply CAPTURE_OK." },
  );
  assert.equal(rec.protocol, "chat");
  assert.equal(rec.markerCount, 1);
  assert.equal(rec.kind, "main");
  assert.equal(rec.sha256.length, 64);
  const aux = inspectRequestBody(
    JSON.stringify({ messages: [{ role: "user", content: "生成会话标题" }] }),
    { marker, ask: "Reply CAPTURE_OK." },
  );
  assert.equal(aux.kind, "auxiliary");
  assert.equal(aux.markerCount, 0);
});

test("假 provider：chat completions 非流式全链路 + GET models", async () => {
  const marker = "DSPROBE-feedface";
  const p = await startProbeProvider({ marker, ask: "Reply CAPTURE_OK." });
  try {
    const res = await fetch(p.url + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "m",
        stream: false,
        messages: [
          { role: "system", content: `hello ${marker}` },
          { role: "user", content: "Reply CAPTURE_OK." },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.choices?.[0]?.message?.content, "CAPTURE_OK");
    const rec = await p.waitMainRequest(5000);
    assert.ok(rec, "main 请求必须被记下");
    assert.equal(rec.protocol, "chat");
    assert.equal(rec.markerCount, 1);
    assert.equal(rec.kind, "main");
    assert.ok(rec.privilegedChars > 0);
    const models = await fetch(p.url + "/v1/models");
    assert.equal(models.status, 200);
    const mj = await models.json();
    assert.ok(Array.isArray(mj.data) && mj.data.length > 0);
  } finally {
    await p.close();
  }
});

test("假 provider：anthropic 流式 + responses 主回合 + auxiliary 不冒充", async () => {
  const p = await startProbeProvider({ marker: "M1", ask: "MAIN-ASK" });
  try {
    const sse = await fetch(p.url + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system: [{ type: "text", text: "armor M1" }],
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    assert.equal(sse.status, 200);
    const sseText = await sse.text();
    assert.ok(sseText.includes("text_delta"));
    assert.ok(sseText.includes("message_stop"));
    await fetch(p.url + "/responses", {
      method: "POST",
      body: JSON.stringify({ instructions: "ins M1", input: [{ role: "user", content: "MAIN-ASK" }] }),
    });
    await fetch(p.url + "/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "生成标题" }] }),
    });
    const main = await p.waitMainRequest(5000);
    assert.ok(main);
    assert.equal(main.protocol, "responses");
    assert.equal(main.markerCount, 1);
    assert.ok(p.requests.some((r) => r.kind === "auxiliary"));
    // chat 流式也要能回 SSE（宿主开 stream:true 时不至于挂死）
    const chatSse = await fetch(p.url + "/chat/completions", {
      method: "POST",
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(chatSse.status, 200);
    assert.ok((await chatSse.text()).includes("[DONE]"));
  } finally {
    await p.close();
  }
});

test("loopback-only：CONNECT 一律 403 掐断", async () => {
  const p = await startProbeProvider({ marker: "M" });
  try {
    const net = await import("node:net");
    const status = await new Promise((resolve) => {
      const s = net.connect(p.port, "127.0.0.1", () => {
        s.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      });
      s.once("data", (d) => {
        resolve(String(d).split(" ")[1]);
        s.destroy();
      });
      s.once("error", () => resolve("err"));
      setTimeout(() => resolve("timeout"), 3000);
    });
    assert.equal(status, "403");
  } finally {
    await p.close();
  }
});
