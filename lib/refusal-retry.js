// 拒答重试：把「模型开头先讲一段合规、然后才可能给答案」这次输出丢掉，换一份更硬的请求重发一次。
//
// 吸收自 kingcharleslzy-ai/dsh-purge 的 lib/refusal-retry.js（社区版）的形态，
// 但判定与话术不用它那一套，改成本地已有的两个模块：
//   · 判定 → lib/refusal-scan.js 的 scanReply()：全文扫描 + opening/tail 位置标注，
//     社区版只扫开头 600 字符，「先给答案、末尾补一句我无法提供 X」会被判成正常回答。
//   · 话术 → lib/retry-ladder.js 的 planRetry()：amplify（换更硬的轨迹）/ sanitize
//     （剥落点词后按隔离口径重发）/ giveup，三级阶梯，不是一句固定的"再试一次"。
//
// 为什么接在 proxy adapter 上，而不是 llm/stream 钩子
// ---------------------------------------------------
// dsh-agent-loop 造出来的 request 是 Object.freeze 的，messages 里每条还逐条 deepFreeze；
// cordis 的 waterfall next() 也不收参数（next(新值) 的新值被丢掉）。所以 llm/stream
// 旁听者只能看，改不动请求。唯一合法的口子是 adapter 自己 —— lib/request-shape.js 已经
// 注册了 provider 别名并代理真 adapter，这里把它的 stream 再包一层即可。
//
// 代价与边界
// ----------
//   · 只在「开头 N 个字符」判一次，判完立刻决定：是拒答就丢弃重发，不是就原样吐出去。
//     不做流中途的二次判定 —— 那会把已经渲染给用户的文字收回去。
//   · 只重试一次。第二次还是拒答就把第二次的内容原样交出去，不再循环：无限重试会让
//     一次对话卡在同一个请求上，而且拿不到任何新信息。
//   · 工具调用 / reasoning 块出现时立刻判「不是拒答」并放行，避免把正常的工具轮次
//     缓冲住（缓冲会让工具调用延迟到 400 字符之后才发出，观感像卡死）。
import { scanReply } from "./refusal-scan.js";
import { planRetry } from "./retry-ladder.js";

/** 缓冲多少字符后做判定。太小会把「先说一句背景再给答案」误判成拒答。 */
export const DEFAULT_BUFFER_CHARS = 400;
/** 超过这个长度就认为「模型其实已经给出正文」，拒绝开场只是开场，不值得重发。 */
export const DEFAULT_BODY_CHARS = 800;
/** 重试时追加到 system 尾部的最大字符数，防止把请求撑爆。 */
export const MAX_NUDGE_CHARS = 900;

/**
 * 判定这次开头算不算拒答。
 *
 * 除了 scanReply 的 verdict，还要认一件事：**开头就是拒绝但后面还有内容**。
 * 那种情况 scanReply 会同时给出 refusal.opening 与长正文，属于「先推一句再给答案」，
 * 重试收益很低（模型已经给了东西），不值得把这段丢掉重来。
 */
export function classifyOpening(text, options = {}) {
  const raw = String(text == null ? "" : text);
  const scan = scanReply(raw, options);
  const refused = scan.verdict === "refusal";
  const hasBody = raw.length >= (options.bodyChars || DEFAULT_BODY_CHARS);
  return {
    scan,
    refused,
    // 只有「拒绝 + 还没给出实质内容」才值得重发
    worthRetry: refused && !hasBody,
    reason: refused ? (hasBody ? "拒绝开场但已有正文，收益低" : `verdict=${scan.verdict}`) : "未命中拒答",
  };
}

/** 把 nudge 追加到第一条 system 消息正文尾部；没有 system 消息就原样返回（不硬造一条）。 */
export function withNudge(options, nudge) {
  const text = String(nudge || "").trim();
  if (!text) return options;
  const messages = Array.isArray(options?.messages) ? options.messages : null;
  if (!messages || messages.length === 0) return options;
  const first = messages[0];
  if (!first || first.role !== "system") return options;
  const content = Array.isArray(first.content)
    ? first.content.map((block) => (block && block.type === "text" ? { ...block, text: `${block.text}\n\n${text}` } : block))
    : (typeof first.content === "string" ? `${first.content}\n\n${text}` : first.content);
  return { ...options, messages: [{ ...first, content }, ...messages.slice(1)] };
}

/** 从 planRetry 的结果里取这次要追加的指令；giveup / accept 返回空串。 */
export function nudgeOf(plan) {
  const directive = String(plan?.directive || "").trim();
  if (!directive) return "";
  return directive.length > MAX_NUDGE_CHARS ? directive.slice(0, MAX_NUDGE_CHARS) : directive;
}

function isTerminalChunk(chunk) {
  if (!chunk || typeof chunk !== "object") return false;
  // 工具调用 / reasoning 一出现就说明这不是「纯拒答开场」，立刻放行。
  return chunk.type === "tool-call-delta"
    || chunk.type === "tool-call"
    || chunk.type === "reasoning-delta"
    || chunk.type === "finish"
    || chunk.type === "error";
}

/** 真 adapter 有的返回 async iterable，有的（测试替身/同步实现）返回数组，两种都要能遍历。 */
function iteratorOf(value) {
  if (value && typeof value[Symbol.asyncIterator] === "function") return value[Symbol.asyncIterator]();
  if (value && typeof value[Symbol.iterator] === "function") {
    const it = value[Symbol.iterator]();
    // 必须自带 asyncIterator，否则 `yield* iterator` 走同步协议会报 undefined is not a function。
    return {
      next: async () => it.next(),
      return: async () => (typeof it.return === "function" ? it.return() : { done: true, value: undefined }),
      [Symbol.asyncIterator]() { return this; },
    };
  }
  throw new TypeError("[dsh-purge] refusal-retry: stream 返回值不是可迭代对象");
}

/**
 * 包一层 stream factory：先缓冲开头，判定是不是拒答；是就丢弃并换一份加固请求重发一次。
 *
 * 注意这是**普通函数**，不是 async generator：工厂必须在调用点同步执行一次。
 * 真 adapter 的 stream 有同步副作用（解析 provider / 取凭据 / 建连接），
 * 把它推迟到第一次 next() 之后，调用方看到的错误时机就变了。
 *
 * @param {() => Iterable|AsyncIterable} factory 产出 chunk 流的函数（每次调用发一次请求）
 * @param {object} options                       原始请求 options（用于取 goal / 拼 nudge）
 * @param {object} cfg                           { enabled, bufferChars, goal, rubric, maxAttempts, onRetry }
 * @returns {AsyncGenerator}
 */
export function streamWithRefusalRetry(factory, options, cfg = {}) {
  // 立刻发第一次请求：副作用与不包这一层时完全一致。
  const first = factory(options);
  return (async function* run() {
    if (cfg.enabled === false) {
      yield* first;
      return;
    }
    const bufferChars = Number.isFinite(cfg.bufferChars) ? cfg.bufferChars : DEFAULT_BUFFER_CHARS;
    const iterator = iteratorOf(first);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try { await iterator.return?.(); } catch { /* 关闭失败不影响主流程 */ }
    };

    const buffered = [];
    let text = "";
    let decided = false;
    try {
      while (!decided) {
        const step = await iterator.next();
        if (step.done) { decided = true; break; }
        buffered.push(step.value);
        if (step.value?.type === "text-delta") text += step.value.text || "";
        if (isTerminalChunk(step.value) || text.length >= bufferChars) decided = true;
      }
    } catch (error) {
      await close();
      throw error;
    }

    const verdict = classifyOpening(text, cfg);
    if (!verdict.worthRetry) {
      for (const chunk of buffered) yield chunk;
      if (!closed) {
        closed = true;
        yield* iterator;
      }
      return;
    }

    // 是拒答：把这一份彻底关掉，别让它继续往宿主里写。
    await close();
    const plan = planRetry({
      goal: String(cfg.goal || ""),
      reply: text,
      attempt: 0,
      maxAttempts: Number.isFinite(cfg.maxAttempts) ? cfg.maxAttempts : 1,
      rubric: cfg.rubric === "strict" ? "strict" : "pass",
      allowSanitize: cfg.allowSanitize !== false,
    });
    if (plan.action === "giveup" || plan.action === "accept") {
      // 不该重试：把已经缓冲的内容原样交出去，不能让用户看到空白。
      for (const chunk of buffered) yield chunk;
      return;
    }
    try {
      cfg.onRetry?.({ chars: text.length, verdict: verdict.scan.verdict, action: plan.action, words: verdict.scan.words });
    } catch { /* 回调失败不影响主流程 */ }

    // 重发一次。第二次不再判定 —— 判了也只是再丢一次，用户永远看不到输出。
    yield* factory(withNudge(options, nudgeOf(plan)));
  })();
}

/**
 * 给一个「原始 stream 工厂」套上拒答重试，返回新的工厂。
 * request-shape 的代理 adapter 直接用它包真 adapter 的 stream。
 */
export function wrapStreamFactory(factory, options, cfg = {}) {
  return () => streamWithRefusalRetry(factory, options, cfg);
}
