// 请求级探针（吸收自 ZiChuanLan/agent-purge 的 fake-provider 抓包思路）。
//
// 磁盘级 --probe 只证明「token 写进了注入文件」；这一层证明「注入真的进了
// 发给模型的请求体」：本地起一个 loopback-only 假 provider（127.0.0.1 随机
// 端口，全程不出网；CONNECT / 绝对 URL 一律 403，不转发不外泄），把宿主
// CLI 的 DEEPSEEK_BASE_URL 指过来，独立 profile 跑一轮 headless 一次性回合，
// 抓请求体的特权层（system / developer / messages 与 input 里的 system 段）
// 验证 DSPROBE token 是否送达。
//
// 流程：armProbe（token 进注入文件）→ bootstrapProbeProfile 搭 profile 骨架
// （宿主 loadProfile 拒绝存在的 profile 不存在）→ --dump-config 初始化 →
// ensureProfileBundles + ensureProfileBodyInsert 把插件接进新 profile →
// spawn 宿主 CLI `--profile <p> "<task>"`（本机 CLI 无 --ask 子命令）→
// 等 main 请求（含 ask 正文的才算主回合，会话标题类 auxiliary 不算）→
// 验证 markerCount → 杀进程树 + clearProbe + 关 server。
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as core from "./core.js";
import { armProbe, clearProbe } from "./probe.js";
import { ensureProfileBodyInsert, ensureProfileBundles } from "./profile-insert.js";

export const PROBE_REQUEST_STATE_FILE = "dsh-purge-probe-request.json";
export const DEFAULT_PROBE_PROFILE = "dsh-purge-probe";
export const DEFAULT_ASK = "Reply CAPTURE_OK.";

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 特权层抽取：宿主只会把「系统级」正文放进 system / developer 角色或
 * messages/input 里的 system 段；用户正文不在统计里。
 * 覆盖三种协议形态：
 *   chat      /chat/completions   messages[].role=system|developer
 *   anthropic /messages           body.system（字符串或 [{text}] 数组）
 *   responses /responses          body.instructions + input[]（role=system|developer）
 */
export function extractPrivilegedText(body) {
  const parts = [];
  const push = (v) => {
    if (typeof v === "string" && v) parts.push(v);
  };
  if (Array.isArray(body?.system)) {
    for (const b of body.system) push(typeof b === "string" ? b : b?.text);
  } else {
    push(body?.system);
  }
  push(body?.developer);
  push(body?.instructions);
  for (const m of Array.isArray(body?.messages) ? body.messages : []) {
    if (m?.role !== "system" && m?.role !== "developer") continue;
    push(typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content) ? m.content.map((c) => c?.text).filter(Boolean).join("\n") : "");
  }
  for (const it of Array.isArray(body?.input) ? body.input : []) {
    if (!it || typeof it === "string") continue;
    if (it?.role !== "system" && it?.role !== "developer") continue;
    push(typeof it.content === "string"
      ? it.content
      : Array.isArray(it.content) ? it.content.map((c) => c?.text ?? c?.content).filter(Boolean).join("\n") : "");
  }
  return parts.join("\n");
}

export function detectProtocol(body) {
  if (body?.input !== undefined) return "responses";
  if (body?.system !== undefined) return "anthropic";
  if (Array.isArray(body?.messages)) return "chat";
  return "unknown";
}

/** 抓到的请求体 → 判定记录（markerCount / 特权层字符数 / sha256 / main|auxiliary）。 */
export function inspectRequestBody(raw, { marker = "", ask = DEFAULT_ASK } = {}) {
  const body = typeof raw === "string" ? safeJson(raw) || {} : raw ?? {};
  const privileged = extractPrivilegedText(body);
  const markerCount = marker ? privileged.split(String(marker)).length - 1 : 0;
  return {
    protocol: detectProtocol(body),
    privilegedChars: privileged.length,
    privilegedPreview: privileged.slice(0, 800),
    sha256: sha256(privileged),
    markerCount,
    kind: String(raw).includes(String(ask)) ? "main" : "auxiliary",
  };
}

const REPLY = "CAPTURE_OK";

function sseReply(res, protocol) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  if (protocol === "anthropic") {
    const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    // message_start 里给全量 message 对象（含 model/stop_reason/usage），
    // 与 agent-purge capture-provider 逐字段对齐——宿主适配器会校验它。
    const message = {
      id: "msg_probe", type: "message", role: "assistant", model: "probe-fixture",
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    };
    ev("message_start", { type: "message_start", message });
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: REPLY } });
    ev("content_block_stop", { type: "content_block_stop", index: 0 });
    ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev("message_stop", { type: "message_stop" });
  } else {
    const chunk = (delta, finish) => res.write(`data: ${JSON.stringify({
      id: "chatcmpl-probe",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    })}\n\n`);
    chunk({ role: "assistant" });
    chunk({ content: REPLY });
    chunk({}, "stop");
    res.write("data: [DONE]\n\n");
  }
  res.end();
}

function jsonReply(res, protocol) {
  res.writeHead(200, { "content-type": "application/json" });
  if (protocol === "anthropic") {
    res.end(JSON.stringify({
      id: "msg_probe", type: "message", role: "assistant", model: "probe-fixture",
      content: [{ type: "text", text: REPLY }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  } else if (protocol === "responses") {
    res.end(JSON.stringify({
      id: "resp_probe", object: "response", status: "completed", model: "probe-fixture",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: REPLY }] }],
    }));
  } else {
    res.end(JSON.stringify({
      id: "chatcmpl-probe", object: "chat.completion", model: "probe-fixture",
      choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  }
}

/**
 * loopback-only 假 provider。只听 127.0.0.1 随机端口；CONNECT 与绝对 URL
 * （代理形态）一律 403 断开——抓包器自己绝不做外发代理。
 */
export function startProbeProvider({ marker = "", ask = DEFAULT_ASK } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const url = req.url || "";
        // 绝对 URL = 有人把我们当外发代理，直接掐。
        if (!url.startsWith("/")) {
          res.writeHead(403);
          res.end();
          return;
        }
        if (req.method === "GET" && /\/models\/?$/.test(url)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: [{ id: "probe-fixture", object: "model" }] }));
          return;
        }
        if (req.method !== "POST" || !/\/(chat\/completions|messages|responses)\/?$/.test(url)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const rec = inspectRequestBody(raw, { marker, ask });
        rec.ts = Date.now();
        rec.path = url;
        const body = safeJson(raw) || {};
        rec.stream = body?.stream === true;
        rec.model = String(body?.model || "");
        requests.push(rec);
        if (body?.stream === true) sseReply(res, rec.protocol);
        else jsonReply(res, rec.protocol);
      } catch {
        try {
          res.writeHead(500);
          res.end();
        } catch { /* socket 已断 */ }
      }
    });
  });
  server.on("connect", (_req, socket) => {
    try {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    } catch { /* ignore */ }
    socket.destroy();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        requests,
        waitMainRequest(timeoutMs = 45000) {
          const deadline = Date.now() + timeoutMs;
          return new Promise((done) => {
            const tick = () => {
              const rec = requests.find((r) => r.kind === "main");
              if (rec) return done(rec);
              if (Date.now() > deadline) return done(null);
              setTimeout(tick, 120);
            };
            tick();
          });
        },
        close() {
          return new Promise((done) => {
            try {
              server.close(() => done());
            } catch {
              done();
            }
          });
        },
      });
    });
  });
}

// 宿主 CLI 解析：env 指定 > PATH 上的 dsh（shim）> 常见安装根的
// resources\runtime\cli\dsh.cmd。都找不到就报错让用户设 DSH_PURGE_HOST_CLI。
export async function resolveHostCli() {
  const envCli = process.env.DSH_PURGE_HOST_CLI;
  if (envCli) {
    if (fs.existsSync(envCli)) return envCli;
    throw new Error(`DSH_PURGE_HOST_CLI 指向的文件不存在：${envCli}`);
  }
  try {
    const where = execFileSync(process.platform === "win32" ? "where" : "which", ["dsh"], { encoding: "utf8", timeout: 5000 });
    const first = String(where).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch { /* PATH 上没有 dsh */ }
  const roots = [
    process.env.DSH_INSTALL_ROOT,
    "D:\\Program Files\\DSH",
    "C:\\Program Files\\DSH",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "DeepSeek Harness") : "",
  ].filter(Boolean);
  for (const root of roots) {
    const cand = path.join(root, "resources", "runtime", "cli", "dsh.cmd");
    if (fs.existsSync(cand)) return cand;
  }
  throw new Error("找不到宿主 CLI（dsh）。设 DSH_PURGE_HOST_CLI=<dsh.cmd 全路径> 后重试。");
}

// 宿主 loadProfile 要求 profiles/<name> 先存在（否则
// "profile does not exist; create it with 'dsh plugin --profile … add <package>'"）。
// 这里按 headless profile 的骨架手工搭一个最小 fixture：
// package.json（bundles 基座）+ cordis.yml/cordis.patch.yml（空流文档，随后
// ensureProfileBodyInsert 会把 `[]` 重写成 insert 块）+ pnpm-workspace.yaml +
// node_modules/dsh-purge-pj junction（dsh-purge-pj 不在宿主 app node_modules 里，
// @deepseek-ai bundle 则走宿主侧 fallback 解析，不占这里）。
function bootstrapProbeProfile(profileDir) {
  fs.mkdirSync(path.join(profileDir, "node_modules"), { recursive: true });
  const pkgFp = path.join(profileDir, "package.json");
  if (!fs.existsSync(pkgFp)) {
    const pkg = {
      name: `dsh-profile-${path.basename(profileDir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], patchReload: "startup" } },
    };
    fs.writeFileSync(pkgFp, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  const cordisFp = path.join(profileDir, "cordis.yml");
  if (!fs.existsSync(cordisFp)) fs.writeFileSync(cordisFp, "# dsh profile root — probe fixture\n[]\n", "utf8");
  const patchFp = path.join(profileDir, "cordis.patch.yml");
  if (!fs.existsSync(patchFp)) fs.writeFileSync(patchFp, "[]\n", "utf8");
  const wsFp = path.join(profileDir, "pnpm-workspace.yaml");
  if (!fs.existsSync(wsFp)) {
    fs.writeFileSync(wsFp, "packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n", "utf8");
  }
  const link = path.join(profileDir, "node_modules", "dsh-purge-pj");
  if (!fs.existsSync(link)) {
    try {
      fs.symlinkSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), link, "junction");
    } catch { /* 已存在/没权限：宿主 install 兜底 */ }
  }
}

// cmd /c 的引号规则坑：多个引号对时 cmd 会撕掉首引号，"D:\Program Files\…"
// 在空格处断裂。标准解法：/s /c + 整体再包一层引号 + windowsVerbatimArguments，
// 让参数引号原样到达 cmd（/s 模式下 cmd 只剥最外层那一对）。
function cmdLine(cli, args) {
  const q = (a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));
  return `"${[q(cli), ...args.map(q)].join(" ")}"`;
}

function runProcess(cli, args, { env = {}, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const isCmdScript = /\.(cmd|bat)$/i.test(cli);
    const child = isCmdScript
      ? spawn(process.env.comspec || "cmd.exe", ["/s", "/c", cmdLine(cli, args)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: true })
      : spawn(cli, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try { killTree(child); } catch { /* ignore */ }
      done({ code: -1, error: `timeout ${timeout}ms`, stdout, stderr });
    }, timeout);
    child.stdout?.on("data", (d) => {
      stdout += d;
      if (stdout.length > 2e6) stdout = stdout.slice(-2e6);
    });
    child.stderr?.on("data", (d) => {
      stderr += d;
      if (stderr.length > 2e6) stderr = stderr.slice(-2e6);
    });
    child.on("error", (e) => done({ code: -1, error: String(e?.message || e), stdout, stderr }));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

function killTree(child) {
  if (!child || child.exitCode != null || child.signalCode) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32" && pid) {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 5000, stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  } catch { /* 进程已经自己退出 */ }
}

function spawnHostAsk(cli, args, env, logs = { out: "", err: "" }) {
  const drain = (buf, key) => (d) => {
    logs[key] += d;
    if (logs[key].length > 2e6) logs[key] = logs[key].slice(-2e6);
  };
  const isCmdScript = /\.(cmd|bat)$/i.test(cli);
  const child = isCmdScript
    ? spawn(process.env.comspec || "cmd.exe", ["/s", "/c", cmdLine(cli, args)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: true })
    : spawn(cli, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.on("data", drain(logs, "out"));
  child.stderr?.on("data", drain(logs, "err"));
  return child;
}

const tail = (s, n = 3000) => {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(-n) : t;
};

/**
 * 全链路：装 token → 起假 provider → 独立 profile 跑一轮 headless 回合 → 验证特权层
 * marker → 清场（杀进程树 / 摘 token / 关 server）→ 写 state 文件。
 * 返回 { hit, markerCount, protocol, ... }；state 落 dsh-purge-probe-request.json
 * 供 --status 的请求级探针行展示。
 */
export async function runProbeRequest(options = {}) {
  const dshHome = options.dshHome ?? core.findDshHome();
  const ask = options.ask ?? DEFAULT_ASK;
  const profileName = options.profile ?? DEFAULT_PROBE_PROFILE;
  const timeoutMs = options.timeoutMs ?? 45000;
  const startedAt = Date.now();
  const result = {
    ranAt: new Date().toISOString(),
    profile: profileName,
    token: "",
    hit: false,
    markerCount: 0,
    privilegedChars: 0,
    protocol: null,
    note: "",
    elapsedMs: 0,
  };
  let probe = null;
  let provider = null;
  let child = null;
  try {
    probe = await armProbe(dshHome);
    result.token = probe.token;
    provider = await startProbeProvider({ marker: probe.token, ask });
    const cli = await resolveHostCli();
    const env = {
      DEEPSEEK_BASE_URL: provider.url,
      DEEPSEEK_API_KEY: "probe-fixture-key",
      DSH_TELEMETRY_MODE: "DISABLED",
      DSH_TELEMETRY_OTLP_URL: provider.url + "/telemetry",
    };
    // 0) 先把 profile 骨架搭出来（loadProfile 拒绝不存在的 profile）
    const profileDir = path.join(dshHome, "profiles", profileName);
    try { bootstrapProbeProfile(profileDir); } catch (e) { result.note += `bootstrap:${e?.message || e}; `; }
    // 1) 初始化独立 profile（只建骨架，不跑模型）
    await runProcess(cli, ["--profile", profileName, "--dump-config"], { env, timeout: 30000 });
    // 2) 把 dsh-purge 接进新 profile（bundle + cordis insert），否则注入面是空的
    if (fs.existsSync(profileDir)) {
      try { await ensureProfileBundles(profileDir); } catch (e) { result.note += `bundle:${e?.message || e}; `; }
      try { ensureProfileBodyInsert(profileDir); } catch (e) { result.note += `insert:${e?.message || e}; `; }
    } else {
      result.note += `profile 目录未生成：${profileDir}; `;
    }
    // 3) 跑一轮 headless 一次性回合（本机 CLI 无 --ask；`dsh --profile <p> "<task>"`）
    const logs = { out: "", err: "" };
    child = spawnHostAsk(cli, ["--profile", profileName, ask], env, logs);
    const rec = await provider.waitMainRequest(timeoutMs);
    result.hostStdout = tail(logs.out);
    result.hostStderr = tail(logs.err);
    if (rec) {
      result.hit = rec.markerCount > 0;
      result.markerCount = rec.markerCount;
      result.privilegedChars = rec.privilegedChars;
      result.protocol = rec.protocol;
      result.privilegedPreview = rec.privilegedPreview || "";
    } else {
      result.note += `${timeoutMs}ms 内没抓到主请求（宿主可能没起来或没发问）; `;
    }
  } catch (e) {
    result.note += String(e?.message || e);
  } finally {
    try { killTree(child); } catch { /* ignore */ }
    try { await clearProbe(dshHome); } catch { /* 探针 state 乱了不拦报告 */ }
    if (provider) await provider.close();
    result.elapsedMs = Date.now() - startedAt;
    try {
      fs.writeFileSync(path.join(dshHome, PROBE_REQUEST_STATE_FILE), JSON.stringify(result, null, 2) + "\n", "utf8");
    } catch { /* 写不了就算了 */ }
  }
  return result;
}
