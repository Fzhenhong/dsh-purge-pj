// 补丁契约表的守卫。
//
// test/patch-contract.json 是从 lib/core.js 的 ALL_PATCHES 派生的快照。它的作用不是
// 「记住 87 条补丁长什么样」，而是把几件容易悄悄坏掉的结构性约定钉住：
//   1. 每条补丁要么有 replacements、要么有 patterns+replace，不能两者都空（打了也没效果）。
//   2. marker 与 markers 不能同时出现（判定语义会打架：#markers 优先，#marker 被忽略）。
//   3. optional 的补丁必须带 marker，否则「已应用」无法判定，只能永远 pending。
//   4. 契约表不能与源码漂移（改了 core.js 忘了重新生成，这里就会红）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const contract = JSON.parse(readFileSync(path.join(HERE, "patch-contract.json"), "utf8"));

const core = await import(new URL("../lib/core.js", import.meta.url).href);
const patches = core.ALL_PATCHES;

function layerKey(entry) {
  return `${entry.layer}|${entry.layerEn}`;
}

test("契约表覆盖每一条补丁，且 id 不重复", () => {
  assert.equal(contract.length, patches.length, "契约条目数与 ALL_PATCHES 不一致");
  const ids = contract.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "契约表里有重复 id");
  const sourceIds = patches.map((patch) => patch.id).sort((a, b) => a - b);
  assert.deepEqual(ids.slice().sort((a, b) => a - b), sourceIds, "契约与源码的 id 集合不一致");
});

test("契约表与源码逐字节一致（改了 core.js 就要重新生成）", async () => {
  const { renderContract } = await import(new URL("../scripts/gen-patch-contract.mjs", import.meta.url).href);
  const fresh = renderContract();
  const recorded = readFileSync(path.join(HERE, "patch-contract.json"), "utf8");
  assert.equal(recorded, fresh, "契约表与源码漂移，请运行 node scripts/gen-patch-contract.mjs");
});

test("每条补丁都有可执行内容：replacements 或 patterns+replace", () => {
  const empty = [];
  for (const patch of patches) {
    const hasReplacements = Array.isArray(patch.replacements) && patch.replacements.length > 0;
    const hasPatterns = Array.isArray(patch.patterns) && patch.patterns.length > 0 && typeof patch.replace === "string";
    if (!hasReplacements && !hasPatterns) empty.push(`#${patch.id} ${patch.name}`);
  }
  assert.deepEqual(empty, [], "这些补丁没有任何替换内容");
});

test("replacements 与 patterns 不同时出现（两种形态二选一）", () => {
  const both = patches
    .filter((patch) => Array.isArray(patch.replacements) && Array.isArray(patch.patterns))
    .map((patch) => `#${patch.id} ${patch.name}`);
  assert.deepEqual(both, [], "补丁同时声明了 replacements 和 patterns");
});

test("marker 与 markers 不同时出现", () => {
  const both = patches
    .filter((patch) => typeof patch.marker === "string" && patch.marker.length > 0 && Array.isArray(patch.markers) && patch.markers.length > 0)
    .map((patch) => `#${patch.id} ${patch.name}`);
  assert.deepEqual(both, [], "补丁同时声明了 marker 和 markers，判定会以 markers 为准而忽略 marker");
});

test("optional 补丁必须带可判定的 marker（markers 或 marker）", () => {
  const missing = patches
    .filter((patch) => patch.optional === true)
    .filter((patch) => {
      const hasMarkers = Array.isArray(patch.markers) && patch.markers.length > 0;
      const hasMarker = typeof patch.marker === "string" && patch.marker.length > 0;
      return !hasMarkers && !hasMarker;
    })
    .map((patch) => `#${patch.id} ${patch.name}`);
  assert.deepEqual(missing, [], "optional 补丁没有 marker，无法判定是否已应用");
});

test("契约表里每条可选补丁都记录了 optional 与 markers", () => {
  for (const entry of contract) {
    if (!entry.optional) continue;
    assert.ok(
      (Array.isArray(entry.markers) && entry.markers.length > 0),
      `#${entry.id} ${entry.name} 是 optional 但契约里没有 markers`,
    );
  }
});

test("替换内容非空：字符串 pattern 不为空串", () => {
  for (const entry of contract) {
    for (const replacement of entry.replacements) {
      if (replacement.kind !== "string") continue;
      assert.ok(replacement.chars > 0, `#${entry.id} 有空字符串 pattern`);
    }
  }
});

test("RegExp pattern 只使用 global 语义之外的稳定 flags", () => {
  for (const patch of patches) {
    for (const replacement of Array.isArray(patch.replacements) ? patch.replacements : []) {
      if (!(replacement.pattern instanceof RegExp)) continue;
      const flags = replacement.pattern.flags;
      assert.ok(!flags.includes("y"), `#${patch.id} 的 pattern 用了 sticky flag，split/join 语义会错`);
    }
  }
});

test("契约表统计与源码一致", () => {
  const withMarkers = contract.filter((entry) => entry.markers.length > 0).length;
  // 90 → 93：吸收上游 #188/#194 通用部分新增 #98（沙箱策略去品牌，带 marker）、
  // #99（技能徽章描述，带 marker）、#100（host 信号退出日志，带 marker）。
  // 93 → 95：合并上游 1.1.90 后带入 #92/#93（DESKTOP_HOST/MAIN_EXIT_TRACE，均带 marker）。
  // 95 → 96：#103 DESKTOP_WELCOME_COOKIE_SWEEP（#209）带 marker。
  // 96 → 98：#104/#105（lastUsed 落库前剥掉 -purge 别名，单文件版 + 内联版）都带 marker。
  assert.equal(withMarkers, 98, "带 marker 的补丁数变了");
  // 50 → 53：上面三条全部 optional。53 → 55：#92/#93 同为 optional。
  // 55 → 56：#103 同为 optional。
  assert.equal(contract.filter((entry) => entry.optional).length, 56, "optional 补丁数变了");
  const regex = contract.reduce((sum, entry) => sum + entry.replacements.filter((item) => item.kind === "regexp").length, 0);
  // 6 → 7：吸收上游 #188 后 #77（REWIND_DROP_SENT_ON_APPEND）从「写死 5 行 + rc.2 补丁行」
  // 两条字面量改成一条锚首尾 + 非贪婪窗口的正则，官方在中间插行也照样命中。
  // 7 → 9：上游 1.1.90 的 #1/#32 在 rc.5 双版本适配里各多了一条正则形态。
  assert.equal(regex, 9, "RegExp 形式的 replacement 数变了");
  const anyMarkers = contract.filter((entry) => entry.markersAny).length;
  // #94/#95 的补丁内容官方 0.2.1-rc.3 已经自己实现了（只是没带我们的注释），
  // 所以两条都加了「结果态」标记并改成 markersAny —— 否则它们会被误判成 drifted。
  // 23 → 24：上游 1.1.90 的 DESKTOP_MAIN_EXIT_TRACE 也是 markersAny。
  // 24 → 25：#28 LIANGSHEN_PHASE1_KEEP_INJECT 升级到 0.4.x minimal-prompt 布局时
  // 改成 markersAny（新 file 首个 marker 命中即算已补，老 Set 形态保留为兼容候选）。
  assert.equal(anyMarkers, 25, "markersAny 的补丁数变了");
});

test("layer 分布稳定（新增补丁要显式更新这张表）", () => {
  const counts = new Map();
  for (const entry of contract) counts.set(layerKey(entry), (counts.get(layerKey(entry)) ?? 0) + 1);
  // 25 → 27：#98/#99 都是提示词层；#100 落在代码层（55 → 56）。
  // 56 → 58：合并上游 1.1.90 带入 #92/#93（DESKTOP_HOST/MAIN_EXIT_TRACE，均为代码层）。
  // 58 → 59：#103 DESKTOP_WELCOME_COOKIE_SWEEP 落在代码层。
  assert.equal(counts.get("提示词|Prompt"), 27);
  // 59 → 61：#104/#105（MODEL_SELECTION_LASTUSED_ALIAS 及其内联版）都是代码层。
  assert.equal(counts.get("代码|Code"), 61);
  assert.equal(counts.get("工具|Tools"), 8);
  assert.equal(counts.get("0.1.5 兼容|0.1.5"), 1);
  assert.equal(counts.get("0.2.0 兼容|0.2.0"), 2);
});

test("desktop-only 补丁恰好只有 9 条且都声明了 surfaces", () => {
  const desktop = contract.filter((entry) => entry.surfaces.includes("desktop"));
  // 5 → 6：吸收上游 #194 后新增 #100（host 信号退出日志），同样只对桌面面生效。
  // 6 → 8：上游 1.1.90 新增 #92/#93（DESKTOP_HOST/MAIN_EXIT_TRACE），同样只对桌面面生效。
  // 8 → 9：#103（#209 welcome cookie 清扫）同样只对桌面面生效。
  assert.equal(desktop.length, 9);
  for (const entry of desktop) assert.deepEqual(entry.surfaces, ["desktop"]);
});
