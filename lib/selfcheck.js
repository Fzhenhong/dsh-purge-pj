// 一屏自检（吸收自 kingcharleslzy-ai/dsh-purge Community 的 selfcheck 层思路）。
// 只读不改：把「插件现在到底接没接好」压成几行 —— 注入文件、备份、desktop
// 接入（symlink）、shim、锚点覆盖、探针、Qoder。每行 { key, ok, warn, label, detail }。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./core.js";
import { loadAnchorOverrides } from "./anchor-doctor.js";
import { probeStatus } from "./probe.js";
import { personaStatus } from "./persona.js";

const FACTORY_MARKERS = ["<|im_start|>system:", "<project_instructions>", "Little Code Sauce"];

// 宿主会把标记里的 `_` 换成零宽字符（实测本机 prompt-inject.md 第 2 行是
// `<project` + U+200B + `instructions>`，码位 3c 70 72 6f 6a 65 63 74 200b 69 ...，
// 根本没有下划线）。按字面量比对就永远少一个标记，「已清洗」被误报成
// 「出厂默认未应用（标记 2/3）」。这里把零宽字符同时当成「下划线」和「不存在」
// 两种形态去比：两种归一化里任意一种命中就算标记在。
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g;
const normalizeMarkers = (s) => {
  const raw = String(s ?? "");
  return [raw.replace(ZERO_WIDTH, "_"), raw.replace(ZERO_WIDTH, "")];
};
const hasMarker = (text, marker) => normalizeMarkers(text).some((v) => v.includes(marker));

export async function runSelfcheck(options = {}) {
  const state = options.state ?? {};
  const dshHome = options.dshHome ?? state.dsh_home ?? core.findDshHome();
  const repoRoot = options.repoRoot ?? path.resolve(fileURLToPath(import.meta.url), "../..");
  const rows = [];
  const add = (key, ok, warn, label, detail = "") => rows.push({ key, ok, warn, label, detail });

  // 1 注入文件：存在 + 出厂标记计数（标记在 = 托管正文还没打上）
  const injectPath = state.override_path ?? path.join(dshHome, "prompt-inject.md");
  let injectText = null;
  try {
    injectText = fs.readFileSync(injectPath, "utf8");
  } catch {
    /* 还没有 */
  }
  if (injectText == null) {
    add("inject", false, true, "注入文件", `${injectPath} 不存在（--apply 会创建）`);
  } else {
    const marks = FACTORY_MARKERS.filter((m) => hasMarker(injectText, m)).length;
    const hasProbe = hasMarker(injectText, "dsh-purge:probe-begin");
    // 标记数只是「像不像出厂」，不是判决。真正决定「这份会不会被插件覆盖」的是
    // core.looksLikePluginDefault —— 它对零宽字符敏感，所以一份「三个标记都在、正文
    // 却被操作者扩写过」的文件会被判成「不是出厂默认」，于是 installOverride 保留它。
    // 本机就是这种状态（20993 字符 vs 出厂 14446，标记 3/3），旧文案把它报成
    // 「出厂默认未应用」，等于让操作者以为自己精心写的正文还没生效。
    const factory = core.looksLikePluginDefault(injectText);
    add(
      "inject",
      !factory,
      factory,
      "注入文件",
      factory
        ? `出厂默认（会被 --apply 覆盖）${injectPath}`
        : `已自定义${hasProbe ? "（含探针）" : ""} · 标记 ${marks}/3 · ${injectText.length} 字符 ${injectPath}`,
    );
  }

  // 2 备份：.dshpurge.bak（--revert 的还原点）
  let backup = state.has_backup;
  if (backup == null && state.ai_base) {
    try {
      backup = await core.hasBackup(state.ai_base);
    } catch {
      backup = null;
    }
  }
  if (backup == null) {
    // 没有宿主信息也意味着「没有还原点」：--revert 无处可退，照样告警
    add("backup", false, true, "备份", "无备份（--revert 没有还原点）");
  } else add("backup", !!backup, !backup, "备份", backup ? ".dshpurge.bak 在" : "无备份（--revert 没有还原点）");

  // 3 desktop 接入：profiles/desktop/node_modules/dsh-purge-pj 应指向本仓库
  const link = path.join(dshHome, "profiles", "desktop", "node_modules", "dsh-purge-pj");
  let linkOk = false;
  let linkDetail;
  try {
    const real = fs.realpathSync(link);
    linkOk = path.resolve(real).toLowerCase() === path.resolve(repoRoot).toLowerCase();
    linkDetail = `${link} → ${real}`;
  } catch {
    linkDetail = `${link} 缺失（桌面版没用上本仓库）`;
  }
  add("symlink", linkOk, !linkOk, "desktop 接入", linkDetail);

  // 4 shim：按「这套安装本来该有几个启动器」判，不按固定 3 个判。
  // 桌面版 resources/runtime/cli/bin 里只发 dsh.cmd（实测本机就一个 dsh.cmd +
  // 它的 .dshpurge.bak），压根没有 dsh.ps1 / dsh，按「missing ≥ 2 就失联」会永远告警
  // —— 那是布局差异，不是没接好。改成：已经存在的启动器里只要有一个是 original 才算坏；
  // 全 missing 才算失联；其余（存在的都 patched、其余本来就不该有）算好。
  const shims = [
    ["dsh.cmd", state.shim_cmd],
    ["dsh.ps1", state.shim_ps1],
    ["dsh", state.shim_bin],
  ];
  const present = shims.filter(([, v]) => v && v !== "missing");
  const unpatched = present.filter(([, v]) => v === "original" || v === "binary");
  const shimOk = present.length > 0 && unpatched.length === 0;
  const shimNote = (() => {
    if (!present.length) return "全部缺失";
    if (unpatched.length) return `${unpatched.map(([k]) => k).join("/")} 未清洗`;
    const absent = shims.length - present.length;
    return absent ? `（本安装只发 ${present.length} 个启动器）` : "";
  })();
  add("shim", shimOk, !shimOk, "shim", shims.map(([k, v]) => `${k}=${v ?? "?"}`).join("  ") + shimNote);

  // 5 锚点覆盖（信息项）
  let anchorCount = 0;
  try {
    const { overrides } = loadAnchorOverrides(dshHome);
    anchorCount = Object.values(overrides).reduce((n, m) => n + Object.keys(m ?? {}).length, 0);
  } catch {
    /* 读不了当 0 */
  }
  add("anchors", true, false, "锚点覆盖", anchorCount > 0 ? `${anchorCount} 条生效（dsh-purge-anchors.json）` : "无");

  // 6 探针（信息项）
  let probeDetail = "无";
  try {
    const s = probeStatus(dshHome);
    probeDetail = s.active ? `活跃 ${s.state.token}` : s.live ? "文件里有块但 state 对不上（--probe --status）" : "无";
  } catch {
    /* 忽略 */
  }
  add("probe", true, false, "运行时探针", probeDetail);

  // 7 Qoder（信息项，装没装都不算坏）
  // 两处都读：0.5.1 起根目录就是当前版本（版本号在 resources/build-manifest.json 的
  // productVersion），.qoder-versions/ 里只剩历史版本。只扫旧目录会把 0.5.1 漏掉。
  // 另外 LOCALAPPDATA 不一定在 C:（本机 Qoder 装在 D:\Users\onemt\AppData\Local），
  // 所以除环境变量外还试其它盘的同名路径，和 qoder-purge.mjs 的默认 QODER_ROOT 对齐。
  const qoderRoots = (() => {
    const out = [];
    const push = (p) => {
      if (p && !out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
    };
    if (process.env.QODER_ROOT) push(process.env.QODER_ROOT);
    if (process.env.LOCALAPPDATA) push(path.join(process.env.LOCALAPPDATA, "Programs", "Qoder CN"));
    for (const drive of ["C", "D", "E", "F"]) {
      push(`${drive}:\\Users\\${process.env.USERNAME ?? ""}\\AppData\\Local\\Programs\\Qoder CN`);
    }
    return out;
  })();
  let qDetail = "未检测到";
  for (const qroot of qoderRoots) {
    try {
      if (!fs.existsSync(qroot)) continue;
      const found = [];
      const rootVer = (() => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(qroot, "resources", "build-manifest.json"), "utf8"));
          return typeof j.productVersion === "string" ? j.productVersion : "";
        } catch {
          return "";
        }
      })();
      if (rootVer && fs.existsSync(path.join(qroot, "resources", "app.asar"))) found.push(`${rootVer}(根)`);
      const vs = fs.readdirSync(path.join(qroot, ".qoder-versions")).filter((d) => /^\d/.test(d));
      found.push(...vs);
      if (found.length) {
        qDetail = found.join(", ");
        break;
      }
    } catch {
      /* 下一个候选 */
    }
  }
  add("qoder", true, false, "Qoder", qDetail);

  // 8 persona 热切（信息项；只有「激活中但盘上没块」才算要关注——信号和磁盘脱钩）
  let personaRow = null;
  try {
    personaRow = personaStatus(dshHome);
  } catch {
    /* 目录读不了当无 */
  }
  if (!personaRow) {
    add("persona", true, false, "persona 热切", "读不了（personas/ 目录异常）");
  } else {
    const n = personaRow.personas.length;
    add(
      "persona",
      true,
      !!(personaRow.active && !personaRow.consistent),
      "persona 热切",
      personaRow.active
        ? (personaRow.consistent
          ? `激活 ${personaRow.active}（rev ${personaRow.rev}，盘/信号一致）· ${n} 份`
          : `激活 ${personaRow.active} 但盘上没有对应块（重跑 --persona ${personaRow.active}）`)
        : `未激活 · ${n} 份可用（--persona <名字> 免重启切换）`,
    );
  }

  // 9 请求级探针（信息项；从没跑过给 warn——有一条比磁盘探针更硬的验证路）
  let prDetail = "从未跑过（--probe-request 抓真实请求验证送达）";
  let prWarn = true;
  try {
    const pr = JSON.parse(fs.readFileSync(path.join(dshHome, "dsh-purge-probe-request.json"), "utf8"));
    prDetail = pr.hit
      ? `上次 ✓ 送达（${pr.protocol}，特权层 ${pr.privilegedChars} 字符，${pr.ranAt}）`
      : `上次 ✗ 未送达 token=${pr.token}（${pr.ranAt}）`;
    prWarn = !pr.hit;
  } catch {
    /* state 不存在 */
  }
  add("probeRequest", true, prWarn, "请求级探针", prDetail);

  return { rows, warnCount: rows.filter((r) => r.warn).length };
}

export function formatSelfcheck(sc) {
  const lines = ["自检 / selfcheck"];
  for (const r of sc.rows) {
    const mark = r.warn ? "⚠" : "✓";
    lines.push(`  ${mark} ${r.label} — ${r.detail}`);
  }
  if (sc.warnCount > 0) lines.push(`  ${sc.warnCount} 项需要关注（⚠ 不影响已生效补丁）`);
  return lines.join("\n");
}
