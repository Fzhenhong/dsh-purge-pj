# GitHub 生态巡检（2026-11-02 第四轮）：上游 1.1.90 追平点 + agent-purge 重大发现

本轮双目标：① 查上游与关注仓库更新；② 以 GitHub 为主找可吸收的同类项目。
巡检数据源：`watch-upstream.mjs` 全量跑（24+4 关注仓库）+ 补充搜索（purge / jailbreak / system prompt injection agent）+ `agent-purge` 浅 clone 源码研读（`D:\hrh\dsh-watch\probe\agent-purge-fresh\`）。

## 一、上游与关注仓库变化

| 仓库 | 变化 | 判定 |
| --- | --- | --- |
| `YuJunZhiXue/dsh-purge`（上游，15949★，+625/天） | 1.1.86 → **1.1.90**：`d1eff01` 补丁 rc.2/rc.5 双版本适配（1.1.88）、`c63ba4a` 工作目录字面量恢复 + 桌面退出留痕（1.1.89）、`217d60d` 撤销按钮移出 composer 子树，修切后台输入框消失（1.1.90，#208） | **真增量 3 条**（1.1.86 已于第三轮追平；behind 26 里其余是 force-push 重影）。待追平 |
| `realMisakaMikoto/dsh-purge`（61★） | release 1.2.0「版本号分家 + rc.5 双版本补丁」+ 回灌上游 1.1.84–1.1.88 | 与上游 1.1.88 同一件事的两个实现，追平上游即可覆盖 |
| `Jueze-2019/dsh-redteam-mode`（143★） | v0.15.3：prompts 要求 verified logins + 内部优先级重排；更新通道 npm → GitHub Release | 红队模式路线小步走；「优先级重排」思路可留意 |
| `tang19-chao/dsh-plugin-evo-harness`（2★） | 两轮交叉审计收口（3 P0 / 9 P1 / 42 P2 / ~70 P3）+ `fa1f211` 给审计修复提交做 target-bound attest 记录 | evidence/attest 机制与我们 audit-log 同向，暂无缺口 |
| `JeffKeeping/dsh-purge-plus` | **404 删库**（已吸收完毕，无损失） | 归档 |
| `Starry-Design/dsh-purge-full` | **404 删库**（skills/redteam 24 技能已吸收 + SHA256 校验在手） | 归档 |
| `mmparko/dsh-purge`（镜像 2946★，+40） | 仅星标增长 | 无动作 |

本地漂移：master ahead 42 / behind 26（分叉点 `ac58b3e`，上游版本 1.1.90），双方改动文件重叠 31 个（见 `dsh-watch/reports/patrol-2026-11-02.md`）。工作区 45 项未提交改动 → 自动整合按闸跳过，需手工追平。

## 二、重大发现：`ZiChuanLan/agent-purge`（986★，trendshift 榜单）

「一份人设，统一管理多个 coding agent」——跨宿主（Codex / Claude Code / OpenCode / pi / **DSH** / CodeBuddy / Grok）persona 管理器，路线与 dsh-purge 同源但走**纯插件通道、不碰 asar**。对 DSH 的接入（`lib/dsh.mjs`，534 行，matrix.json 实测于 0.2.1-rc.5）：

- 三个插件分工互不覆盖：`agent-purge`（常驻，每次 assemble 读 `~/.agent-purge/state.json + active.md`，off 即时生效）、`agent-purge-slash`（会话内热切，只注册 /purge 命令）、`agent-purge-session`（一次性快照，退出即删）；desktop/web/headless/sdk 四 profile 各放 node_modules，`cordis.patch.yml - insert` 挂载
- **同会话热切已在 DSH 0.2.1-rc.5 验证**（hotSwitch: true）：换人设下一轮生效，无需重启宿主 —— dsh-purge 目前换内核提示词要重启 DSH，这是真缺口
- **可测量性**：本地假 provider 抓请求体 + canary 进 system（本机走 developer 角色），matrix.json 记录每个宿主 `defaultSystemChars → purgedSystemChars`（DSH: 5713 → 68），README 的支持表从 matrix.json 生成，禁止手改
- **armor 层策略**（`lib/armor.mjs` + bench）：sys / user / seed 三层注入面按每宿主实测成功率（bench/bench-armor.mjs）自动定默认层、禁层与预检；铁律：sys 层唯一跨宿主稳定、user 层多数宿主无效、Claude 裸注入无效需 persona 种子
- **provenance 有界还原**（`lib/rewrite.mjs`）：64 条 before/after 变换记录 + WeakMap 对象身份 + ambiguous 标记，restore 只还原有来源记录的变换，不按文本猜测 —— 比我们的出厂标记判定更严谨
- `stripIdentity`：自称行正则（You are/你是/我是…）∧ 已知宿主名正则（Claude|DeepSeek|Qwen|Kimi|GLM|助手…）双条件剥身份行，`replace` 模式剥身份行保工具上下文
- 四模式：`replace`（默认，剥身份行）/ `strict`（整段替换）/ `append`（追加）/ `off`
- 通道族：install（托管配置/插件）/ shim（PATH 同名转发）/ slash（会话内扩展）/ project（项目规则文件）；pause/resume/disarm/clean 全链路可撤销，卸载先撤接管

同作者 `ZiChuanLan/pi-purge`（695★）是 pi 宿主的单宿主版本，`/purge` 会话级切换，设计文档化更好（对照实验定位：同一请求在有/无 harness 提示词下的行为对比）。

### 吸收判定

| 能力 | 判定 | 理由 |
| --- | --- | --- |
| 同会话热切（下一轮读变更） | **建议吸收** | 真缺口：现在换内核提示词要重启。DSH assemble 每轮都过插件 → 常驻插件读盘即可热切。落点：`lib/profile-insert.js` 或新增常驻插件读 `prompt-inject.md` 时间戳/mtime 变化即重载 |
| 请求级验证 harness（fake provider + canary + chars 矩阵） | **建议吸收** | 我们自检靠 `--verify` 读文件态；「抓真实请求体数 chars」能证明端到端生效。落点：`lib/selfcheck.js` 加 `--probe-request`（本地假 OpenAI-compatible endpoint） |
| armor 实测选注入面 | 记录不吸收 | 单宿主插件（dsh-purge 只打 DSH）不需要跨宿主选层；但「裸注入 vs persona 种子」结论对内核提示词开场有参考 |
| provenance 有界还原 | 记录，观察 | 我们 `lib/profile-insert.js` 用出厂标记 + `.bak` 全文备份，已覆盖恢复需求；若未来做「多插件叠写 prompt-inject.md」再考虑 |
| stripIdentity 剥身份行 | 不吸收 | 与破甲目标相反——我们保留/强化 persona，不剥宿主身份 |

## 三、防御/评测侧新见（对照面）

- `SpecterOps/Jailbreaker-CE`（114★）：本地越狱/注入评测工具 → 已加入巡检 watch，评估给 `skills/redteam` eval 借鉴
- `seojoonkim/prompt-guard`（180★）/ `agentfence`（60★）/ `Alpha-Park/*-sentinel-skill`：防御向检测器，观察宿主生态在防什么（同 `PerryLink/dsh-defend` 的对照价值）
- `0xKobold/pi-persona`（8★）：SOUL.md/IDENTITY.md/USER.md 三文件 persona 脚手架，概念轻量，暂无缺口

## 四、巡检配置更新（本轮已落地）

`watch-upstream.mjs`：`LOCAL_BRANCH` 默认值 `local/upgrade-1.1.77` → `master`（旧值让定时任务对旧分支算漂移）；WATCH 补 4 条：`ZiChuanLan/agent-purge`（learned）、`ZiChuanLan/pi-purge`、`kingcharleslzy-ai/dsh-purge`（社区版 ~4.1k★，10-31 盘点漏加）、`SpecterOps/Jailbreaker-CE`。已 `--baseline` 刷 state，语法 `node --check` 通过。

## 五、下一步

1. **追平上游 1.1.87–1.1.90**（4 个版本提交，重叠文件 31 个，需手工合并；尤其 1.1.88 双版本适配与我们 `dshTarget: "0.2.1-rc.2"` 直接相关）
2. 评估热切吸收的最小实现（常驻读盘 vs `request-shape` 每轮注入）
3. `lib/selfcheck.js` 增加 fake-provider 请求级探针的可行性
4. 注意：两个已吸收来源已删库，`docs/UPSTREAM.md` 借鉴记录是唯一出处，务必保留
