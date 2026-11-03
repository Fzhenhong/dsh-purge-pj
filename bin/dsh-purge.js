#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";
import * as reapply from "../lib/reapply.js";

const args = process.argv.slice(2);

async function printStatus(state) {
  const out = [];
  out.push("dsh-purge-pj 状态 / Status");
  out.push("  宿主 / surface " + (state.surface || "web"));
  out.push("  DSH_HOME      " + state.dsh_home);
  if (state.desktop_install) out.push("  桌面安装       " + state.desktop_install);
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  " + core.missingAiBaseMessage());
  }
  out.push(`  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  out.push("");
  out.push(`  补丁 ${state.patches_applied}/${core.ALL_PATCHES.length} 已清洗, ${state.patches_pending} 待清洗`
    + (state.patches_drifted ? `, ${state.patches_drifted} 漂移（官方原文已改，需更新 pattern）` : ""));
  if (state.host_version) {
    // 只有真的跨 minor/major 才报「未适配」。rc 号不同（本机声明 rc.2、在跑 rc.3/rc.5）
    // 官方原文通常没动，补丁照样 applied，把它画成红的会让人以为出了事。
    const level = state.host_compat_level || "unknown";
    const soft = level === "prerelease" || level === "patch";
    const compat = state.host_supported === false
      ? `  ← 未适配：插件声明 ${state.host_target || "?"}（跨版本）`
      : soft
        ? `  ← 与声明 ${state.host_target || "?"} 仅差预发布/补丁号，原文未变`
        : "";
    out.push(`  宿主版本 / host  ${state.host_version}${compat}`);
  }
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : s === "drifted" ? "!" : "·";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  try {
    const { helperLogDiagnostics, nonEmptyHelperLogs } = await import("../lib/helper-logs.js");
    const picked = nonEmptyHelperLogs(helperLogDiagnostics());
    const keys = Object.keys(picked);
    if (keys.length > 0) {
      out.push("");
      out.push("  helper 日志 / helper logs（detached 子进程，stdio 被丢弃，只剩这些文件）");
      for (const key of keys) {
        const entry = picked[key];
        const when = entry.mtime ? new Date(entry.mtime).toISOString() : "?";
        out.push(`    ${key.padEnd(16)} ${entry.path}`);
        out.push(`      ${entry.size} B, 最后写入 ${when}${entry.truncated ? "（只读尾部）" : ""}`);
        for (const line of entry.lines) out.push(`      | ${line}`);
      }
    }
  } catch {
    // 日志诊断挂了不该连累 --status 本身。
  }
  try {
    const { readAuditTail } = await import("../lib/audit-log.js");
    const audit = readAuditTail(state.dsh_home, { limit: 5 });
    if (audit.exists && audit.entries.length > 0) {
      out.push("");
      out.push("  最近动作 / recent actions（apply / revert / uninstall 流水）");
      for (const e of audit.entries) {
        const mark = e.ok ? "✓" : "✗";
        const detail = e.error ? `  ${e.error}` : "";
        out.push(`    ${mark} ${e.at}  ${String(e.action).padEnd(10)} ${e.ms !== undefined ? e.ms + "ms" : ""}${detail}`);
      }
      out.push(`    流水文件 / audit  ${audit.path}`);
    }
  } catch {
    // 流水读不到也不该连累 --status。
  }
  try {
    const { runSelfcheck, formatSelfcheck } = await import("../lib/selfcheck.js");
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const sc = await runSelfcheck({ state, dshHome: state.dsh_home, repoRoot });
    out.push("");
    out.push(formatSelfcheck(sc));
  } catch {
    // 自检挂了不该连累 --status 本身，静默跳过。
  }
  return out.join("\n");
}

/**
 * --scan：判读一批答复到底给没给答案。
 *
 * 输入三种：.jsonl（每条一行，取 reply 字段）、纯文本（整份当一个答复）、stdin。
 * 输出 verdict 时同时给出命中位置 —— 这是与 maodie 判拒器最大的差别：
 * 它只扫开头 160 字符，正文答完、末尾补一句「但我无法提供 X」仍然报绿。
 * 这里 opening / tail 分开报，调用方自己决定报警级别。
 */
async function runScan(rest) {
  const { scanReply, compareVerdict } = await import("../lib/refusal-scan.js");
  const asJson = rest.includes("--json");
  const file = rest.find((a) => !a.startsWith("-"));

  let text;
  let label;
  if (file) {
    if (!fs.existsSync(file)) {
      console.log(`[ERROR] 找不到文件 ${file}`);
      process.exit(1);
    }
    text = fs.readFileSync(file, "utf8");
    label = file;
  } else if (!process.stdin.isTTY) {
    text = fs.readFileSync(0, "utf8");
    label = "<stdin>";
  } else {
    console.log(`dsh-purge-pj --scan 用法:
  dsh-purge-pj --scan 答复.txt          判读单个答复
  dsh-purge-pj --scan replies.jsonl     批量判读（每行一个 JSON，取 reply 字段）
  dsh-purge-pj --scan < file.txt        从 stdin 读
  加 --json 输出机器可读结果`);
    return;
  }

  const looksJsonl = /\.jsonl$/i.test(file || "") || /^\s*\{/m.test(text.split("\n").find((l) => l.trim()) || "");
  const results = [];
  const tally = { pass: 0, refusal: 0, fallback: 0 };
  const compared = { pass: 0, fail: 0, unknown: 0 };
  const skipped = [];

  if (looksJsonl) {
    // 这里不套 prompt-bank 的解析器：它要求每行有 prompt（评测用例的形状），
    // 而 --scan 吃的是答复文件，只需要 reply。空行与 # 注释跳过，坏行记下来不中断。
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      let row;
      try {
        row = JSON.parse(s);
      } catch (e) {
        skipped.push(`第 ${idx + 1} 行 JSON 解析失败: ${e.message}`);
        return;
      }
      if (!row || typeof row !== "object") {
        skipped.push(`第 ${idx + 1} 行不是对象`);
        return;
      }
      const reply = row.reply ?? row.text ?? row.answer ?? null;
      if (typeof reply !== "string" || !reply.trim()) {
        skipped.push(`第 ${idx + 1} 行 ${row.id ?? ""} 无 reply 字段`);
        return;
      }
      const domain = row.expected_domain ?? row.domain ?? undefined;
      const expected = row.expected_verdict ?? row.expected ?? row.verdict;
      const scan = scanReply(reply, { domain });
      tally[scan.verdict] = (tally[scan.verdict] || 0) + 1;
      const cmp = compareVerdict(scan, expected);
      compared[cmp.status] = (compared[cmp.status] || 0) + 1;
      results.push({ i: results.length + 1, id: row.id ?? null, scan, cmp });
    });
  } else {
    const scan = scanReply(text);
    tally[scan.verdict] = 1;
    results.push({ i: 1, id: null, scan, cmp: null });
  }

  if (asJson) {
    console.log(JSON.stringify({ source: label, tally, compared, skipped, results }, null, 2));
    return;
  }

  const mark = (v) => (v === "pass" ? "✓ pass  " : v === "refusal" ? "✗ refusal" : "⚠ fallback");
  console.log(`dsh-purge-pj --scan  ${label}`);
  console.log(`  条数 ${results.length}  pass ${tally.pass || 0}  refusal ${tally.refusal || 0}  fallback ${tally.fallback || 0}`);
  for (const r of results) {
    const s = r.scan;
    const where = [];
    if (s.refusal.opening.length) where.push(`opening:${s.refusal.opening.join("/")}`);
    if (s.refusal.tail.length) where.push(`tail:${s.refusal.tail.join("/")}`);
    if (s.fallback.length) where.push(`fallback:${s.fallback.join("/")}`);
    const head = `  ${String(r.i).padStart(3)} ${mark(s.verdict)}`;
    const id = r.id ? ` ${r.id}` : "";
    const tail = where.length ? `  ${where.join("  ")}` : s.domain ? `  domain=${s.domain}` : "";
    const verdict = r.cmp && r.cmp.status !== "unknown" ? `  expected=${r.cmp.want} ${r.cmp.status === "pass" ? "OK" : "MISMATCH"}` : "";
    console.log(`${head}${id}${tail}${verdict}`);
  }
  if (compared.pass || compared.fail) {
    console.log(`  比对 expected: OK ${compared.pass}  MISMATCH ${compared.fail}  unknown ${compared.unknown}`);
  }
  for (const s of skipped.slice(0, 5)) console.log(`  - 跳过 ${s}`);
  if (skipped.length > 5) console.log(`  - 另有 ${skipped.length - 5} 条跳过`);
  if (tally.refusal) console.log("  提示: tail 命中 = 正文给了答案但末尾补了拒绝措辞，非开头拒答。");
}

/**
 * --eval：两臂配对评测。
 *
 * 与 --scan 的区别是「比较」而不是「判读」：--scan 回答这条答复给没给答案，
 * --eval 回答 B 臂比 A 臂好多少、这个差是不是噪声、代价是什么。
 *
 *   dsh-purge-pj --eval A.jsonl B.jsonl
 *   dsh-purge-pj --eval A.jsonl B.jsonl --benign benign.jsonl
 *   dsh-purge-pj --eval A.jsonl B.jsonl --sampling 10:3:3 --json
 *   dsh-purge-pj --eval A.jsonl B.jsonl --benign b.jsonl --lessons lessons.md
 *
 * 三个文件都是 jsonl，每行 { id, reply }；bank 里的 expected_domain 可选。
 * --benign 的行是 { id, a: bool, b: bool }（两臂在良性题上的通过与否）。
 * --lessons 把结果蒸馏成结构化「教训」写进 markdown，供下一轮改提示词；
 * --lessons-limit 限制条数（默认 12）。
 */
async function runEval(rest) {
  const { scanReply } = await import("../lib/refusal-scan.js");
  const { compareArms, formatEvalReport, pairArms } = await import("../lib/prompt-eval.js");
  const { distillLessons, formatLessons } = await import("../lib/eval-lessons.js");

  const asJson = rest.includes("--json");
  const flagValue = (name) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const samplingRaw = flagValue("--sampling");
  const benignFile = flagValue("--benign");
  const lessonsFile = flagValue("--lessons");
  const lessonsLimitRaw = flagValue("--lessons-limit");
  const rubricRaw = flagValue("--rubric");
  const ladderFile = flagValue("--ladder");

  // 判分口径：pass 只看有没被挡；strict 还要求答复里有可照着做的细节。
  const rubric = String(rubricRaw ?? "pass").toLowerCase() === "strict" ? "strict" : "pass";
  if (rubricRaw && !["pass", "strict"].includes(String(rubricRaw).toLowerCase())) {
    console.log(`[WARN] --rubric 只认 pass / strict，收到 "${rubricRaw}"，按 pass 处理`);
  }

  // 位置参数里排除掉 flag 及其取值，剩下的前两个就是两臂文件
  const consumed = new Set();
  for (const name of ["--benign", "--sampling", "--lessons", "--lessons-limit", "--rubric", "--ladder"]) {
    const at = rest.indexOf(name);
    if (at >= 0) {
      consumed.add(at);
      consumed.add(at + 1);
    }
  }
  const positional = rest.filter((a, i) => !a.startsWith("-") && !consumed.has(i));

  if (positional.length < 2) {
    console.log(`dsh-purge-pj --eval 用法:
  dsh-purge-pj --eval A.jsonl B.jsonl              两臂配对比较
  dsh-purge-pj --eval A.jsonl B.jsonl --benign b.jsonl
                                                带良性能力控制组（强烈建议）
  dsh-purge-pj --eval A.jsonl B.jsonl --sampling 10:3:3
                                                pass@k 的 n:c:k
  dsh-purge-pj --eval A.jsonl B.jsonl --benign b.jsonl --lessons lessons.md
                                                把结果蒸馏成可复用的教训（markdown）
  dsh-purge-pj --eval A.jsonl B.jsonl --rubric strict
                                                严格判分：还要求答复里有可执行的细节
  dsh-purge-pj --eval A.jsonl B.jsonl --ladder attempts.jsonl
                                                看重试阶梯：首答通过 vs 走完阶梯后通过
  加 --json 输出机器可读结果
  --lessons-limit N                            教训条数上限，默认 12

答复文件每行 {"id": "...", "reply": "..."}；良性文件每行 {"id": ..., "a": true, "b": false}；
阶梯文件每行 {"id": "...", "attempts": [true, false, true]}（首答、第1级、第2级…）`);
    return;
  }

  const readArm = (file, tag) => {
    if (!fs.existsSync(file)) {
      console.log(`[ERROR] 找不到 ${tag} 文件 ${file}`);
      process.exit(1);
    }
    const rows = [];
    const skipped = [];
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, idx) => {
        const s = line.trim();
        if (!s || s.startsWith("#")) return;
        let row;
        try {
          row = JSON.parse(s);
        } catch (e) {
          skipped.push(`第 ${idx + 1} 行 JSON 解析失败: ${e.message}`);
          return;
        }
        const reply = row?.reply ?? row?.text ?? row?.answer ?? null;
        if (typeof reply !== "string" || !reply.trim()) {
          skipped.push(`第 ${idx + 1} 行无 reply 字段`);
          return;
        }
        const domain = row.expected_domain ?? row.domain ?? null;
        // text 留着：--rubric strict 要看原文里有没有可执行细节，只看 verdict 判不了。
        rows.push({ id: row.id ?? null, domain, text: reply, scan: scanReply(reply, { domain: domain ?? undefined }) });
      });
    return { rows, skipped };
  };

  const armA = readArm(positional[0], "A 臂");
  const armB = readArm(positional[1], "B 臂");

  let benign = null;
  if (benignFile) {
    if (!fs.existsSync(benignFile)) {
      console.log(`[ERROR] 找不到良性文件 ${benignFile}`);
      process.exit(1);
    }
    benign = [];
    fs.readFileSync(benignFile, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const s = line.trim();
        if (!s || s.startsWith("#")) return;
        let row;
        try {
          row = JSON.parse(s);
        } catch {
          return;
        }
        if (!row || typeof row !== "object") return;
        benign.push({ id: row.id ?? null, a: Boolean(row.a), b: Boolean(row.b) });
      });
  }

  let sampling;
  if (samplingRaw) {
    const parts = String(samplingRaw).split(":").map((x) => Number(x.trim()));
    if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) {
      sampling = { n: parts[0], c: parts[1], k: parts[2] };
    } else {
      console.log(`[WARN] --sampling 要写成 n:c:k，收到 "${samplingRaw}"，本次跳过 pass@k`);
    }
  }

  const labelA = path.basename(positional[0]);
  const labelB = path.basename(positional[1]);
  const result = compareArms({
    casesA: armA.rows,
    casesB: armB.rows,
    benign,
    sampling,
    labelA,
    labelB,
    rubric,
  });

  // 重试阶梯：只吃「每目标每次尝试通没通」，不重跑模型 —— 数据由调用方跑完写下来。
  let ladder = null;
  if (ladderFile) {
    const { summarizeLadder, formatLadderReport } = await import("../lib/retry-ladder.js");
    if (!fs.existsSync(ladderFile)) {
      console.log(`[ERROR] 找不到阶梯文件 ${ladderFile}`);
      process.exit(1);
    }
    const records = [];
    fs.readFileSync(ladderFile, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const s = line.trim();
        if (!s || s.startsWith("#")) return;
        try {
          const row = JSON.parse(s);
          if (row && Array.isArray(row.attempts)) records.push({ id: row.id ?? null, attempts: row.attempts });
        } catch {
          /* 坏行跳过，与两臂文件一致 */
        }
      });
    ladder = summarizeLadder(records);
    ladder.text = formatLadderReport(ladder);
  }

  const skipped = [...armA.skipped.map((s) => `A ${s}`), ...armB.skipped.map((s) => `B ${s}`)];
  if (skipped.length) result.warnings.push(`${skipped.length} 行被跳过（见 --json 的 skipped）`);

  // 教训蒸馏：只在 --lessons 或 --json 时才做，纯看报告不多花这次计算。
  let distilled = null;
  if (lessonsFile || asJson) {
    const limit = Number.parseInt(lessonsLimitRaw ?? "", 10);
    const rows = pairArms(armA.rows, armB.rows).pairs.map((p) => ({
      id: p.id ?? p.key,
      domain: p.a?.domain ?? p.b?.domain ?? null,
      a: p.a?.scan ?? null,
      b: p.b?.scan ?? null,
    }));
    // 良性行只有布尔结果，包成 scan 形状好让同一个判读口径吃进去。
    const benignRows = (benign ?? []).map((row) => ({
      id: row.id,
      a: { verdict: row.a ? "pass" : "refusal" },
      b: { verdict: row.b ? "pass" : "refusal" },
    }));
    distilled = distillLessons({
      rows,
      benign: benignRows,
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
      labelA,
      labelB,
    });
    if (lessonsFile) {
      fs.writeFileSync(lessonsFile, formatLessons(distilled, { labelA, labelB }), "utf8");
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ ...result, lessons: distilled?.lessons ?? [], ladder, skipped }, null, 2));
    return;
  }
  console.log(formatEvalReport(result));
  if (ladder) {
    console.log("");
    console.log(ladder.text);
  }
  if (lessonsFile) {
    const kept = distilled?.lessons?.length ?? 0;
    const rest = distilled?.dropped ? `，另有 ${distilled.dropped} 条被上限截掉` : "";
    console.log(`教训 ${kept} 条（支撑下限 ${distilled?.support?.minSupport ?? 2}）已写入 ${lessonsFile}${rest}`);
  }
  for (const s of skipped.slice(0, 5)) console.log(`  - 跳过 ${s}`);
  if (skipped.length > 5) console.log(`  - 另有 ${skipped.length - 5} 行跳过`);
}

/**
 * --doctor：锚点体检（吸收 kingcharleslzy-ai/dsh-purge Community 的 diagnose 思路）。
 * 逐补丁逐文件报 applied/pending/drifted/missing_file；漂移的给出候选行，
 * 供 --reanchor 钉本地覆盖。read-only，不改任何文件。
 */
async function runDoctor(rest) {
  const { diagnosePatches, formatDiagnosis } = await import("../lib/anchor-doctor.js");
  const bases = rest.includes("--all") ? core.enumeratePatchAiBases() : [core.findAiBase()];
  const list = bases.filter(Boolean);
  if (!list.length) {
    console.log("[ERROR] " + core.missingAiBaseMessage());
    process.exit(1);
  }
  let anyDrift = 0;
  for (const base of list) {
    if (list.length > 1) console.log(`宿主 / host → ${base}`);
    // #210：补丁全打在宿主根本不加载的解包目录里时，先把这件事说清楚，
    // 否则 applied 计数会让人以为已经生效。
    const shadow = core.sealedAsarShadowWarning({ aiBase: base });
    if (shadow) console.log("[WARN] " + shadow.message);
    const rep = await diagnosePatches(base, core.ALL_PATCHES, {});
    console.log(formatDiagnosis(rep));
    anyDrift += rep.counts.drifted;
  }
  if (anyDrift > 0) {
    console.log("  说明：官方更新会重写宿主文件把锚点冲掉（drifted）。钉回去后重跑 --apply 即可。");
  }
  return;
}

/**
 * --reanchor：对漂移补丁钉本地覆盖。
 *   dsh-purge-pj --reanchor            对全部 drifted 逐个尝试（候选行不唯一就跳过并说明）
 *   dsh-purge-pj --reanchor 42 1 [--dry]  只钉 patch #42 的第 1 处替换（--dry 只看不写）
 * 覆盖写进 ~/.dsh/dsh-purge-anchors.json，下次 --apply 自动生效。
 */
async function runReanchor(rest) {
  const { diagnosePatches, reanchorPatch } = await import("../lib/anchor-doctor.js");
  const dryRun = rest.includes("--dry");
  const rest2 = rest.filter((a) => a !== "--dry");
  const dshHome = core.findDshHome();

  // 带参数：--reanchor <patchId> <rep#>
  if (rest2.length >= 2) {
    const id = Number(rest2[0]);
    const pi = Number(rest2[1]) - 1; // help 文案用 1-based rep#
    if (!Number.isInteger(id) || !Number.isInteger(pi) || pi < 0) {
      console.log("[ERROR] 用法：dsh-purge-pj --reanchor <补丁id> <rep#> [--dry]   （rep# 从 1 数起）");
      process.exit(1);
    }
    try {
      const r = await reanchorPatch(id, pi, { dshHome, aiBase: core.findAiBase(), dryRun });
      if (!r.needed) {
        console.log(`  - patch #${id} rep#${pi + 1}：${r.reason}`);
      } else if (dryRun) {
        console.log(`  [dry] patch #${id} rep#${pi + 1} 候选行 @LN: ${r.candidateLine}`);
        console.log(`        新 pattern: ${JSON.stringify(r.to).slice(0, 120)}`);
      } else {
        console.log(`  ✓ patch #${id} rep#${pi + 1} 已钉覆盖（${r.saved}），重跑 --apply 生效`);
      }
    } catch (e) {
      console.log(`  ✗ patch #${id} rep#${pi + 1}：${e.message}`);
      process.exitCode = 1;
    }
    return;
  }

  // 无参数：诊断全量，逐个 drifted 尝试
  const base = core.findAiBase();
  if (!base) {
    console.log("[ERROR] " + core.missingAiBaseMessage());
    process.exit(1);
  }
  const rep = await diagnosePatches(base, core.ALL_PATCHES, {});
  const targets = [];
  for (const d of rep.drifted) {
    for (const pf of d.perFile) {
      for (const rp of pf.reps) {
        if (rp.state === "drifted") targets.push({ id: d.id, pi: rp.pi, hint: rp.candidateLine });
      }
    }
  }
  if (!targets.length) {
    console.log("没有 drifted 补丁，无需重锚。（--doctor 看全量）");
    return;
  }
  let ok = 0, skip = 0;
  for (const t of targets) {
    try {
      const r = await reanchorPatch(t.id, t.pi, { dshHome, aiBase: base, dryRun });
      if (!r.needed) { skip++; continue; }
      if (dryRun) {
        console.log(`  [dry] #${t.id} rep#${t.pi + 1} 候选 @LN: ${r.candidateLine}`);
      } else {
        console.log(`  ✓ #${t.id} rep#${t.pi + 1} 已钉：${(r.candidateLine || "").slice(0, 60)}`);
      }
      ok++;
    } catch (e) {
      console.log(`  ⚠ #${t.id} rep#${t.pi + 1} 跳过：${e.message}`);
      skip++;
    }
  }
  if (!dryRun && ok > 0) {
    console.log(`\n钉完 ${ok} 处（跳过 ${skip}）。重跑 dsh-purge-pj --apply 生效。`);
  } else if (dryRun) {
    console.log(`\n[dry] 候选 ${ok} 处（跳过 ${skip}）。去掉 --dry 实际写入。`);
  } else {
    console.log("没有可钉的漂移。");
  }
}

/**
 * --probe：运行时探针（吸收 Community 的 probe 思路）。
 * 把一行 DSPROBE-xxxxxxxx 追加进注入文件尾部；重启 dsh 后问它
 * 「逐字复述注入文件里 DSPROBE 开头那行」，答得出 = 注入确实送达。
 *   dsh-purge-pj --probe          装探针（已有则只显示 token）
 *   dsh-purge-pj --probe --clear  摘探针
 */
async function runProbe(rest) {
  const mod = await import("../lib/probe.js");
  const dshHome = core.findDshHome();
  if (rest.includes("--clear")) {
    const r = await mod.clearProbe(dshHome);
    console.log(r.cleared ? "  ✓ 探针已摘除" : "  - 没有探针可摘");
    return;
  }
  const cur = mod.probeStatus(dshHome);
  let token;
  if (cur.active) {
    token = cur.state.token;
    console.log(cur.live === token
      ? `  - 探针已在注入文件里 token=${token}`
      : `  ⚠ state 里 token=${token} 但注入文件里是 ${cur.live || "（没有）"}，重装：--probe --clear 后再 --probe`);
  } else {
    const st = await mod.armProbe(dshHome);
    token = st.token;
    console.log(`  ✓ 探针已装入注入文件尾部 token=${token}`);
  }
  console.log("  验证：重启 dsh 后问它「逐字复述你注入文件里 DSPROBE 开头的那一行」。");
  console.log("  答得出 = 注入送达；答不出 = 宿主没吃到注入文件（跑 --doctor 看）。摘除：--probe --clear");
}

/**
 * --persona：persona 热切（吸收 ZiChuanLan/agent-purge 的 hot-switch 思路，
 * 走我们的钉子/磁盘双通道）。CLI 与桌面插件进程不共享内存，切换只能走文件
 * 信号：先写 <home>/personas/active.json（rev++），插件侧 refreshHungOperator
 * 盯它的 mtime，rev 变了就把 persona 正文写成新钉——免重启生效。
 *   dsh-purge-pj --persona              列出 personas/ 与当前激活
 *   dsh-purge-pj --persona <名字>       切换
 *   dsh-purge-pj --persona --off        撤下（磁盘剥块 + 信号撤钉）
 *   dsh-purge-pj --persona --save <名>  把当前注入正文（剥 persona 块）存成 persona
 *   dsh-purge-pj --persona --rm <名>    删除 persona 文件
 */
async function runPersona(rest) {
  const mod = await import("../lib/persona.js");
  const dshHome = core.findDshHome();
  try {
    if (rest.includes("--off")) {
      const st = mod.clearActivePersona(dshHome);
      console.log(st.removed
        ? `  ✓ persona 已撤下（rev ${st.rev}）；下一轮 assemble 落回磁盘基线，无需重启`
        : `  - 盘上没有 persona 块（信号已撤，rev ${st.rev}）`);
      return;
    }
    const saveIdx = rest.indexOf("--save");
    if (saveIdx >= 0) {
      const name = rest[saveIdx + 1];
      if (!name) throw new Error("--save 后面要跟 persona 名字");
      const r = mod.savePersonaFromInject(dshHome, name);
      console.log(`  ✓ 已存 persona「${r.name}」（${r.chars} 字符）→ ${mod.personasDir(dshHome)}`);
      return;
    }
    const rmIdx = rest.indexOf("--rm");
    if (rmIdx >= 0) {
      const name = rest[rmIdx + 1];
      if (!name) throw new Error("--rm 后面要跟 persona 名字");
      const r = mod.deletePersona(dshHome, name);
      if (!r.removed) throw new Error(`persona 不存在：${name}`);
      console.log(`  ✓ 已删除「${mod.sanitizePersonaName(name)}」${r.cleared ? "（它正激活，信号已一起撤下）" : ""}`);
      return;
    }
    const nameArg = rest.find((a) => !a.startsWith("-"));
    if (nameArg) {
      const st = mod.switchPersona(dshHome, nameArg);
      console.log(`  ✓ 已切换 persona →「${st.active}」（rev ${st.rev}）`);
      console.log("  桌面端下一轮对话生效（免重启）；当前对话若没换，发一条新消息触发 pre-step 重装。");
      console.log("  验证：dsh-purge-pj --status 看 persona 行，或 dsh-purge-pj --probe-request 抓真实请求。");
      return;
    }
    const ps = mod.personaStatus(dshHome);
    console.log(`  激活：${ps.active ?? "（无）"}${ps.active && !ps.consistent ? "  ⚠ 盘上没有对应 persona 块（重跑 --persona <名字>）" : ""}`);
    console.log(`  信号：rev=${ps.rev}  ts=${ps.ts ? new Date(ps.ts).toISOString() : "-"}`);
    const list = ps.personas;
    if (!list.length) {
      console.log("  （还没有 persona。先把注入调到想要的正文，再 --persona --save <名字> 存一份）");
    } else {
      for (const p of list) console.log(`  - ${p.name}  ${p.chars} 字符`);
    }
  } catch (e) {
    console.log(`  [ERROR] ${e.message}`);
    process.exitCode = 1;
  }
}

/**
 * --probe-request：请求级探针（吸收 ZiChuanLan/agent-purge 的 fake-provider
 * 抓包思路）。本地假 provider 抓宿主真实请求体，验证 DSPROBE token 进了特权
 * 层（system/developer）——比 --probe 的「人肉复述」硬一档，全程不出网。
 * 宿主 CLI 用 DSH_PURGE_HOST_CLI 指定（默认自动找 PATH / 安装根的 dsh.cmd）。
 */
async function runProbeRequestCli(rest) {
  const mod = await import("../lib/probe-request.js");
  console.log("  起假 provider + 装探针 token + 独立 profile 跑一轮 headless 回合…（最长 ~50s）");
  const r = await mod.runProbeRequest({
    ask: rest.includes("--ask") ? rest[rest.indexOf("--ask") + 1] : undefined,
    profile: rest.includes("--profile-name") ? rest[rest.indexOf("--profile-name") + 1] : undefined,
    timeoutMs: 45000,
  });
  console.log(`  token=${r.token}  profile=${r.profile}  ${r.elapsedMs}ms`);
  if (r.hit) {
    console.log(`  ✓ 请求级送达：${r.protocol} 请求特权层命中 ${r.markerCount} 处（特权层 ${r.privilegedChars} 字符）`);
  } else {
    console.log(`  ✗ 请求里没看到 token（markerCount=${r.markerCount}${r.protocol ? ", protocol=" + r.protocol : ""}）`);
    if (r.note) console.log(`  note: ${r.note}`);
    process.exitCode = 1;
  }
  console.log("  详见 ~/.dsh/dsh-purge-probe-request.json");
}

async function main() {
  const mode = args.find((a) => ["--apply", "--revert", "--uninstall", "--status", "--edit", "--help", "--scan", "--eval", "--doctor", "--reanchor", "--probe", "--probe-request", "--persona", "--repair-baks"].includes(a));

  if (mode === "--scan") {
    await runScan(args.filter((a) => a !== "--scan"));
    return;
  }

  if (mode === "--eval") {
    await runEval(args.filter((a) => a !== "--eval"));
    return;
  }

  if (mode === "--doctor") {
    await runDoctor(args.filter((a) => a !== "--doctor"));
    return;
  }

  if (mode === "--reanchor") {
    await runReanchor(args.filter((a) => a !== "--reanchor"));
    return;
  }

  if (mode === "--probe") {
    await runProbe(args.filter((a) => a !== "--probe"));
    return;
  }

  if (mode === "--persona") {
    await runPersona(args.filter((a) => a !== "--persona"));
    return;
  }

  if (mode === "--probe-request") {
    await runProbeRequestCli(args.filter((a) => a !== "--probe-request"));
    return;
  }

  if (mode === "--repair-baks") {
    // 从官方归档 app.asar 重建被烧掉的 .dshpurge.bak 基线（默认只出计划）。
    const { repairBurnedBaksFromArchive, planBurnedBakRepair } = await import("../lib/bak-repair.js");
    const write = args.includes("--write");
    const state0 = await core.gatherState();
    const bases = state0.ai_base ? [state0.ai_base] : [];
    if (bases.length === 0) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      process.exitCode = 1;
      return;
    }
    let totalBurned = 0;
    let totalWritten = 0;
    for (const aiBase of bases) {
      const plan = planBurnedBakRepair(aiBase);
      console.log(`  宿主 / host  ${aiBase}`);
      console.log(`  归档 / asar  ${plan.archive || "（没找到：" + plan.reason + "）"}`);
      console.log(`  扫描 bak     ${plan.scanned} 份，其中与当前文件逐字节相同的（已烧）${plan.burned.length} 份`);
      totalBurned += plan.burned.length;
      if (plan.burned.length === 0) continue;
      if (!plan.ok || !plan.archive) {
        console.log(`  [WARN] 没有可用归档，无法重建：${plan.reason}`);
        continue;
      }
      const out = repairBurnedBaksFromArchive(aiBase, { write });
      totalWritten += out.written.length;
      for (const item of out.burned) {
        if (item.available) {
          console.log(`    ${write ? "✓ 已重建" : "· 可重建"}  ${item.rel}`);
        }
      }
      for (const item of out.skipped) {
        console.log(`    ✗ 跳过      ${item.rel}  （${item.reason}）`);
      }
      if (out.error) console.log(`  [ERROR] ${out.error}`);
    }
    console.log("");
    console.log(write
      ? `  结果：${totalBurned} 份已烧，重建 ${totalWritten} 份。`
      : `  结果：${totalBurned} 份已烧。这是计划（未落盘），加 --write 才写回 .dshpurge.bak。`);
    return;
  }

  if (mode === "--help" || args.includes("-h")) {
    console.log(`dsh-purge-pj 用法:
  dsh-purge-pj --status     显示状态
  dsh-purge-pj --apply      应用全部清洗（提示词+代码+shim+override）
  dsh-purge-pj --revert     回滚还原
  dsh-purge-pj --uninstall  卸载插件（已应用则先还原）
  dsh-purge-pj --edit       编辑注入文件 prompt-inject.md
  dsh-purge-pj --scan <文件> 判读答复给没给答案（.jsonl 批量 / 纯文本单条 / stdin）
  dsh-purge-pj --eval A.jsonl B.jsonl [--benign b.jsonl] [--sampling n:c:k]
                         两臂配对比较：ASR 差、McNemar 显著性、良性能力代价
                         加 --rubric strict 要求答复里有可执行细节再算通过
                         加 --lessons lessons.md 把结果蒸馏成可复用的教训
                         加 --ladder attempts.jsonl 看首答通过 vs 走完重试阶梯后通过
  dsh-purge-pj --doctor     锚点体检：逐补丁报 applied/pending/drifted/missing（加 --all 扫全部宿主）
  dsh-purge-pj --reanchor   钉漂移补丁的本地覆盖（候选行唯一才收；<补丁id> <rep#> [--dry] 单钉）
  dsh-purge-pj --probe [--clear] 装运行时探针验证注入送达 / 摘除探针
  dsh-purge-pj --probe-request   请求级探针：假 provider 抓宿主请求体验证 token 进了特权层
  dsh-purge-pj --persona [名字|--off|--save 名|--rm 名]
                              persona 热切：列出/切换/撤下/保存/删除（桌面端免重启生效）
  dsh-purge-pj --repair-baks [--write] 从官方 app.asar 重建被烧掉的 .dshpurge.bak（默认只出计划）
  dsh-purge-pj --help       帮助`);
    return;
  }

  const state = await core.gatherState();
  console.log(await printStatus(state));
  console.log("");

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      console.log("  fix: 把 DSH_BASE 指到含 dsh-agent-instructions/lib 的 @deepseek-ai 目录");
      process.exit(1);
    }
    const inject = rules.resolveInjectText(state.dsh_home);
    if (!inject.text) {
      console.log("[ERROR] 提示词和规则集都是空的，必须先添加提示词");
      process.exit(1);
    }
    // 锚点覆盖（--reanchor 钉下的本地重锚）先生效，再进 apply。
    const { loadAnchorOverrides, applyAnchorOverrides } = await import("../lib/anchor-doctor.js");
    const { overrides } = loadAnchorOverrides(state.dsh_home);
    const { patches: effectivePatches, applied, stale } = applyAnchorOverrides(core.ALL_PATCHES, overrides);
    if (applied.length) console.log(`  ✓ 锚点覆盖生效 ${applied.length} 处${stale.length ? `（另 ${stale.length} 处 stale 已丢弃）` : ""}`);

    let multi;
    try {
      multi = await core.applyPatchesAllHosts(effectivePatches, {
        preserveClientBundles: false,
        forApply: true,
      });
    } catch (e) {
      if (e && e.code === "MAINTENANCE_BUSY") {
        console.error(`维护中：${e.message}`);
        console.error("等另一个窗口 / CLI 跑完再执行；不要删锁文件（$DSH_HOME/dsh-purge/maintenance.lock）。");
        process.exitCode = 3;
        return;
      }
      throw e;
    }
    const { hosts, report } = multi;
    for (const h of hosts) console.log(`  宿主 / host → ${h.aiBase}`);
    for (const r of report) {
      const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    const flashHost = hosts[0]?.aiBase || state.ai_base;
    const flash = core.silenceCmdFlash(flashHost);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    // #197：preflight 侧车注入状态单独一行。它决定「下次 dsh web 会不会自动回收
    // 上一轮 detached 起来的孤儿 server」——注不进去就会撞 EADDRINUSE 起不来。
    if (flash.preflight) {
      const pf = flash.preflight;
      const bad = typeof pf === "string" && pf.startsWith("error:");
      console.log(`  web preflight=${pf}${bad ? "  ← 侧车没写进去，下次 dsh web 可能撞 EADDRINUSE" : ""}`);
    }
    if (hosts.length > 1) {
      console.log(`  多宿主 / multi-host: ${hosts.length} 份 @deepseek-ai 已清洗`);
    }
    console.log(inject.source === "rule"
      ? "  - 使用当前规则集，不改写提示词文件"
      : "  - 使用已有提示词文件");
    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else {
      console.log("  ⚠ 未定位 shim 目录，跳过注入");
    }
    const failed = core.summarizeApplyReport(report).failed || [];
    console.log("");
    if (failed.length > 0) {
      console.log(`✗ 完成但有 ${failed.length} 个补丁失败 / finished with ${failed.length} failed patch(es)`);
      process.exit(1);
    }
    // 面板点应用会打戳；CLI 也要打，否则下次启动 settle 以为没对齐又重打一遍（#202）。
    try {
      reapply.markPatchesApplied();
    } catch (e) {
      console.log(`  ⚠ 写入应用记录失败 / failed to write applied stamp: ${e && e.message ? e.message : e}`);
    }
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
  } else if (mode === "--revert") {
    if (state.ai_base || core.enumeratePatchAiBases().length) {
      const { reverted, errors } = await core.revertAllHosts();
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
      if (reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--uninstall") {
    const { uninstallPurge } = await import("../lib/uninstall.js");
    const result = await uninstallPurge();
    if (result.applied) console.log("  已检测到补丁，已还原回原版。");
    else console.log("  未检测到已应用补丁，仍会清除插件文件。");
    if (result.override?.removed) console.log(`  已删除 ${result.override.path}`);
    if (result.stripped?.length) console.log(`  已从 profile 移除: ${result.stripped.join(", ")}`);
    for (const e of result.errors || []) console.log(`  ⚠ ${e}`);
    if (!result.ok) {
      console.log("  卸载中止：还原失败，插件文件未删除。");
      process.exit(1);
    }
    /* 命令行卸载没有「重启后助手」这一步：插件目录不会自己消失，得在这里删。
       （界面卸载是把这一步交给独立助手，等端口释放后再删。） */
    const fs = await import("node:fs");
    for (const dir of result.cleanup || []) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 }); }
      catch (e) { console.log(`  ⚠ 未能删除 ${dir}: ${e && e.message ? e.message : e}`); }
    }
    console.log("");
    console.log("卸载完成。请重启 dsh。");
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件：${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件：${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。");
  } else {
    console.log("默认不清洗，使用 --apply 应用清洗。");
  }
}

main().catch((e) => {
  console.error("[dsh-purge] error:", e);
  process.exit(1);
});
