# GitHub 生态巡检（2026-10-31 第二轮）

本轮目标：以 GitHub 为主，找出 dsh-purge 的衍生/类似项目，判断哪些能力值得吸收。

## 巡检方法

- `api.github.com/search/repositories?q=dsh-purge&sort=updated`（匿名 10 次/分钟，无 token）
  → total 229，头部 20 个逐个看 `lib/` 文件清单。
- 有 `lib/` 且文件清单和本仓库**不重合**的，`git clone --depth 1` 到
  `D:\hrh\dsh-watch\probe\`，只读模块头部注释判断设计意图，不整仓拷贝。
- 判定标准只有一条：**这个能力本仓库是不是真的缺，而且缺了会出真问题**。
  单纯"实现方式不同"不吸收（会造成两套等价代码，维护成本翻倍）。

## 已吸收（本轮落地）

| 来源 | 模块 | 吸收内容 | 本仓库落点 |
| --- | --- | --- | --- |
| `dongliuwuzhong-arch/DSH-purge` | `lib/atomic-io.js` | rename 撞宿主占用时的退避重试（20/60/150 ms，只对 EPERM/EBUSY/EACCES/ENOTEMPTY） | `lib/core.js` 的 `atomicWriteSync` / `atomicWriteFile` / `atomicCopyFile` / `atomicCopyFileSync` 统一走 `renameSyncWithRetry` / `renameWithRetry` |
| `Crow-purge` | `lib/restart-diagnostics.js` | detached helper 日志的尾部只读诊断 | 新增 `lib/helper-logs.js`（`readLogTail` / `helperLogDiagnostics` / `nonEmptyHelperLogs`），接进 `/dsh-purge/status` 与 `--status` |
| `54zhien/dsh-purge-plus` | `lib/tool-gate.js` | 只取「审计永远要有」这一半判据，**不引入审批门** | 新增 `lib/audit-log.js`（`appendAudit` / `withAudit` / `readAuditTail`），apply/revert/uninstall 三个路由各落一行 JSONL |
| `555bbbAAA/dsh-purge` | `lib/repair-baks.js` | 从官方 `app.asar` 重建被烧掉的 `.dshpurge.bak` 基线 | 新增 `lib/bak-repair.js` + CLI `--repair-baks [--write]` |

## 明确不吸收（附理由）

| 来源 | 模块 | 为什么不吸收 |
| --- | --- | --- |
| `realMisakaMikoto/dsh-purge` | `update-transaction.js` / `update-worker.js` / `update-supervisor.js` / `operation-boot.js` | 这是一整套"带事务的自我更新 + 启动后回验"框架（journal、nonce、phase 机、`bootMatches`）。它解决的问题是本仓库 `lib/update.js` 已经用"下载 → 校验 → 原子替换 → 重启"覆盖的那一段；引入第二套事务会让两条更新路径同时存在，反而更难推理。`runtime-check.js` 的 `node:sqlite` 探针同理 —— 本仓库不用 sqlite。 |
| `realMisakaMikoto/dsh-purge` | `doctor.js` | 本仓库已有更强的 `lib/anchor-doctor.js`（逐补丁 applied/pending/drifted/missing + `--reanchor` 本地重锚 + `--probe` 运行时探针）。 |
| `54zhien/dsh-purge-plus` | `tool-gate.js` 的 `mode: "enforce"` | 强制审批会把人自己点「应用」的路径也拦一道；本机策略若把 approval 一律自动拒绝，等于把插件锁死。主入口是人，人就是审批者。 |
| `54zhien/dsh-purge-plus` | `revision.js`（状态 rev + 409 CAS） | 本仓库已有 `committedOverrideRevision()`，且 `/dsh-purge/apply` 的并发由 `lib/maintenance-lock.js` 挡住（`MAINTENANCE_BUSY` → 提示等另一个窗口跑完）。CAS 是另一种解法，不是缺的能力。 |
| `54zhien/dsh-purge-plus` | `host-lease.js` | 真实路径 + 大小 + mtime + 头部摘要的宿主身份租约。本仓库用 `asarFileIdentity` + `sameAsarIdentity` 判 asar，用 `reapply.patchesLostAfterHostReset()` 判补丁是否被重置，覆盖面已够；再加一层租约是重复。 |
| `dongliuwuzhong-arch/DSH-purge` | `sealed-heal.js` | 判据（asar 被放回 / bak 残留 / 换包中途失败）本仓库的 `lib/sealed-guard.js` 与 `restartSealedDesktopIfNeeded()` 已覆盖。 |
| `dongliuwuzhong-arch/DSH-purge` | `host-state.js`（卸载时挪走 redteam 预设） | 本仓库 `lib/uninstall.js` 已有对应清理；改名策略不同不构成缺能力。 |
| `555bbbAAA/dsh-purge` | `preflight.js`（启动早期 runtime 自愈） | 本仓库的 office 技能自愈（`healOfficeSkillsAt` / `healOfficeSkillsRuntimeOnDisk`）解决同一个 ENOENT 崩溃，且走的是 `applyHostHooks` + `setImmediate`，不额外注册一个零依赖 cordis 插件。 |
| `kingcharleslzy-ai/dsh-purge` | `steering.js` | 恢复 steer/followup 原生队列守卫。本仓库的 #86 已经处理 `steer() stays next-step`，且原生队列守卫在 0.2.1-rc.3 里已由宿主自己实现。 |
| `kingcharleslzy-ai/dsh-purge` | `community.js`（904 行） | 是那个仓库自己的社区运营/公告/更新通道，与本仓库无关。 |
| 全部衍生仓库 | `asset-table.js` / `capability-protocol.js` / `table-key.js` / `table-read.js` / `zip-extract.js` / `extract-asar.js` | 本仓库已有等价实现（`lib/extract-asar.js` 比它们更完整：`asarArchiveIsFile` / `asarFileIdentity` / `shouldExtractAsar` / `overlayAsarUnpacked` / `extractAsarToSide` / `commitExtractedDir`）。 |

## 顺带修掉的两个真问题

1. **#94 / #95 假漂移**：官方 `0.2.1-rc.3` 自己就把工具调度器改成 `Symbol.for(...)`、
   把 `toolRuntimeScheduler()` 搬进 agent-loop，只是没带我们的注释。只认注释 → 永远停在
   drifted。两条补丁改为 `markersAny: true` 并补「结果态」标记。
2. **#53 命中数契约过严**：该补丁声明在 `harness-dev-context` 与 `web-app-lib` 两个文件上，
   而 rc.3 之后 `HARNESS_SOURCE_PROMPT` 里那句 "Use this checkout only to inspect or extend
   DSH itself." 已经不存在（只剩 `LEGACY_SOURCE` 里的旧会话锚点，不能动）。`expect: 1`
   在第二个文件上必然 0 命中 → 整条补丁被拒写、报 `hit_count_mismatch`。
   给 `expect` 增加**数组形态**（命中数落在列表里即可），这条改成 `expect: [0, 1]`：
   0 次和 1 次都是正确结果，只有 ≥2 次才是"官方又复制了一份"，那时才该报漂移。
   `expectAllows(expect, hits)` 同时覆盖正则分支与字符串分支。

## 生态全貌（供下次巡检）

| 仓库 | 星 | 特征 |
| --- | --- | --- |
| `YuJunZhiXue/dsh-purge` | ~14.2k | 上游主干（本仓库 origin） |
| `kingcharleslzy-ai/dsh-purge` | ~3.8k | 社区维护版，模块最多（60+），有自己的更新通道 `update-net.js` |
| `realMisakaMikoto/dsh-purge` | ~51 | 事务化自我更新 |
| `555bbbAAA/dsh-purge` | ~11 | 归档重建 bak + 启动前 runtime 自愈 |
| `54zhien/dsh-purge-plus` | 0 | 1.4.x 线，状态 CAS + 工具审批门 |
| `Crow-purge`（`YAOXIAOYUAN0802`） | 2 | 适配 rc.2~rc.5，含拒绝自动纠正层 |
| `dongliuwuzhong-arch/DSH-purge` | 3 | 原子 IO + 密封自愈 |
| `luckyf1oat/dsh-purge-F1x` / `stl88083365/dsh-purge-patched` / `samir2015dzh/dsh-purge-mirror` | 0-2 | 打包/镜像，无独有能力 |
| `jcforever1/dsh-purge-market` | - | 插件市场索引（format 1），不是插件本体 |
| `chen1pengvincent/dsh-archived-manager` | 0 | 归档会话管理，与破甲无关 |

---

# 第三轮（2026-11-01 20:38）：上游 1.1.86 的回收流程修复

本轮不是「找新项目」，而是**上游追平**：`origin/master` 在 1.1.85 之后又走了
`8d237ba` → `7fddfe3` → `52d3b2a` → `1bdf239`（合并 #197/#198，版本 1.1.86）。
这两条 PR 修的正是本机踩过的同一个坑，因此全部吸收。

## 上游新增提交（本轮 merge-base 检查结果）

| commit | 标题 | 本仓库状态 |
| --- | --- | --- |
| `1bdf239` | fix: 回收流程防 PID 复用误杀并等待端口释放，版本 1.1.86（#197/#198） | **本轮吸收** |
| `52d3b2a` | Merge pull request #198 from iigzx/fix/desktop-asar-swap | 合并提交，无独立内容 |
| `97d2494` | Merge pull request #197 from iigzx/fix/web-restart-orphan | 合并提交，无独立内容 |
| `7fddfe3` | fix(desktop): 换包先杀 Electron main，挪不动时把原版拉起来 (#197) | **本轮吸收** |
| `8d237ba` | fix(web): boot 前回收 detached 残留 server，修 EADDRINUSE 起不来 (#197) | **本轮吸收** |
| `9716ca3` | fix: 深色模式主按钮白底白字，版本 1.1.85（#196） | 已吸收（#196 → 补丁层 + `test/client-dark-theme.test.js`） |
| `af47342` | release: 1.1.84，尾部锚点与子代理审批接管，红队模式中文化，#194/#188 | 已吸收（`lib/anchor.js` / `lib/subagent-control.js` / #194 熔断） |
| `6f9c500` | fix: 补丁失配判定加 drifted，宿主版本门禁与 expect 命中数契约（#188） | 已吸收（drifted 状态 + `expect` 数组形态） |
| `6533b08` | fix: cordis.patch.yml 为 [] 时替换而非追加（#191） | 已吸收（`classifyPatchBody`） |
| `97e4e60` | fix: allowBuilds 只写裸包名（#185） | 已吸收（`purgePnpmBuildSpecs`） |
| `0c933dc` | fix: allowBuilds URL 键截断与污染自愈（#180） | 已吸收 |
| `1fb4229` / `5cc321f` / `d508a83` | docs: 安装说明分步式 / Japanese README | 文档，不涉及代码 |
| `7ade72b` / `ca7cd47` | 1.1.81 + DSH NEXT 识别与单测（#174 #175） | 本地已有等价实现（`tryRegisterCommand` / `lib/surface.js` 认 `dsh-next`） |
| `d4d1c16` / `bb93c6a` / `18fe3b5` / `95102b0` / `6d471eb` / `90fa8fe` | 1.1.78–1.1.80 系列 | 本地已有等价实现 |

## 本轮吸收的具体内容

| 来源 | 文件 | 吸收内容 | 本仓库落点 |
| --- | --- | --- | --- |
| `8d237ba` | `lib/web-reclaim.js` | pid 记录 + 按端口反查 + `looksLikeDshWeb()` 命令行判定 + `waitGone()` | 原样落地（215 行） |
| `8d237ba` | `lib/web-preflight-entry.js` | Cordis 激活前的回收侧车（156 行） | 原样落地 |
| `8d237ba` | `lib/bin-preflight.js` | 侧车复制到宿主 `lib/` + `bin.js` 顶部插 import | 原样落地（85 行） |
| `8d237ba` | `lib/core.js` | `ensureHiddenConsole()` 返回 `preflight`；`silenceCmdFlash()` 的 `ok` 纳入 `preflightOk`；`revertCmdFlash()` 调 `revertBinPreflight` | 已接线 |
| `8d237ba` | `lib/web.js` | 重启时打印「后台运行、关窗不会停」 | 已接线（中文文案） |
| `8d237ba` | `lib/restart-web.js` | spawn 后写 pid 记录、解析 URL 后补写、`killOldServer()` 加端口兜底 | 已接线 |
| `7fddfe3` | `lib/desktop.js` | `ASAR_SWAP_PS1` 导出 + 先杀 Electron main（排除 `--type=`）+ 挪包失败分支重启原版 + 失败原因写 `%TEMP%\dsh-purge-desktop.log` | 已接线 |
| `8d237ba` / `7fddfe3` | `test/web-reclaim.test.js` / `test/desktop-asar-swap.test.js` | 12 + 3 条回归 | 原样落地 |

## 为什么这次「上游做了什么」值得抄

本机在 1.1.87 之前遇到过的现象，逐条对应：

1. `--apply` 后自动重启 → 终端回到提示符 → 用户以为进程没了，再敲一次 `dsh web`
   → `EADDRINUSE`。0.2.x 把 required 插件激活失败当 fatal，于是**宿主起不来**，
   而且报错信息里只有 `listen EADDRINUSE`，完全看不出是上一轮的 detached server 占着。
2. 桌面端点「应用」→ host 被杀、Electron main 还活着 → 弹「host stopped」对话框，
   而 asar 因为被占用没挪动 → 应用处于半死状态（UI 在、host 不在）。
3. 旧版本留下的孤儿 server 没有 pid 记录，只按 `info.pid` 杀永远杀不到它。

三条都靠「按端口反查 + 只杀自己人 + 等端口真释放」解决，这是本轮唯一真正缺的能力。

## 本轮巡检（`watch-upstream.mjs --no-auto-merge`，2026-11-01 12:47）

有变化的仓库 8/24，其中值得看的：

| 仓库 | 变化 | 判断 |
| --- | --- | --- |
| `YuJunZhiXue/dsh-purge` | 星标 14554 → 15047，HEAD `1bdf239` | 正主，本轮全部追平 |
| `mmparko/dsh-purge` | 星标 2825 → 2883 | 全量镜像，无需跟进 |
| `ADWMC/helm-d` | `be8dc9b` feat(team): 本地 worker 会话、Team 工作台与 eval 门禁 | 不同实现路线，本仓库的会话隔离 + `--eval` 已覆盖同目标，不吸收 |
| `PerryLink/dsh-defend` | `581f8a5` docs: legacy documentation baseline | 防御向反向同类，只作观察 |
| `dongliuwuzhong-arch/dsh-purge-021rc2` | `bf00b6b` feat(1.2.3): 补丁编号隔离 + 从上游取回 #88/#91 | 补丁编号隔离与本地 #96/#97 的编号策略冲突，且 #88/#91 本地已有，不吸收 |
| `z91772524-ai/pojia-next` | `ab1dd6e` docs + Trae 国内版/DSH 靶点/asar 长路径三修 | 一代目破甲，asar 长路径已在 `lib/extract-asar.js` 处理，不吸收 |
| `JeffKeeping/dsh-purge-plus` / `Starry-Design/dsh-purge-full` | 404 | 已消失/转私有，从 watch 名单里保留观察 |
| `555bbbAAA/dsh-purge` | 新发现 26★ | 上一轮已吸收 `repair-baks.js` 思路，无新增能力 |

**结论**：第三轮没有新的可吸收模块，唯一动作是把上游 1.1.86 的回收流程追平。
下次巡检重点看 `kingcharleslzy-ai/dsh-purge`（模块最多，`update-net.js` 的
`STABLE_REF` 策略值得对照）与 `ADWMC/helm-d` 的 Team 工作台。

