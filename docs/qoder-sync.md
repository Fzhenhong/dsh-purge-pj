# Qoder CN 同步契约

Qoder 那条线的补丁（`lib/qoder/qoder-purge.mjs`）只搬一样东西：**提示词**。
它把 Qoder CN `app.asar` 里 `out/main/electronMain.js` 的三个系统提示词常量
（`main_coding` / `desktop_instructions` / `persona`）整个换成
`lib/qoder/purge-prompt.zh.md`，再把 `permissionMode` 改 `bypassPermissions`、
把 Electron 的 `EnableEmbeddedAsarIntegrityValidation` fuse 关掉。

所以「新内容同步到 qoder」= **那个 md 文件必须跟着内核提示词一起动**。
本轮之前这条只靠人记，现在有三道机械闸。

## 唯一允许的差异

`lib/qoder/purge-prompt.zh.md` 是 **生成的**，来源是 `lib/default-prompt-inject.zh.md`：

| | 内核文件 | Qoder 文件 |
| --- | --- | --- |
| 头两行 | `<|im_start|>system:<project_instructions>` + 空行 | 删掉 |
| 行尾 | CRLF | LF |
| 其余 | — | **逐字节相同** |

内核那份要伪装成对话模板塞进 transcript，所以带假 wrapper；Qoder 吃的是纯
system string，带 wrapper 反而会让模型以为自己在看一段 `system:` 标记。

## 三道闸

```sh
npm run qoder:sync      # 从内核重建 lib/qoder/purge-prompt.zh.md（幂等，无变化不写盘）
npm run qoder:check     # 只比对，漂了就 exit 1（CI / 提交前）
npm run qoder:verify    # 装好的 Qoder CN 里那个 prompt，是不是当前这份
```

`qoder:check` 由 `test/qoder-prompt-sync.test.mjs` 在 `npm test` 里自动跑，
所以内核改了 qoder 没跟 → 测试红，不用靠记。

`qoder:verify` 回答的是另一个问题，`--check` 答不了它：
`qoder-purge.mjs --check` 只会说「already patched」，因为
`/*__QODER_PURGE__*/` 标记一直在。可提示词换代之后，**活着的 asar 里还是旧文本**，
`--check` 会永远绿。

`--verify` 的做法是：拿 `.purge-orig` 原始备份，在内存里用当前提示词重跑一遍
`patchMain()`，再和活着的 asar 逐字节比。

| 退出码 | 含义 | 怎么办 |
| --- | --- | --- |
| 0 | 活的 asar 与当前提示词完全一致 | 没事 |
| 1 | 漂了（活着的是旧一代） | `node lib/qoder/qoder-purge.mjs --force` |
| 2 | 还没打过补丁 | `node lib/qoder/qoder-purge.mjs` |
| 3 | 无法证明（备份缺失 / 备份本身已打补丁） | 先 `--restore` 或重装 Qoder |

> 刻意不用「正则扫出注入的长字符串再比」。压缩后的 `electronMain.js` 里到处是长
> 转义字面量，而按 markdown 形状筛出来的字面量会在 `你不跳出来说\"` 这种转义引号处
> **被切成两半** —— 于是同一个提示词被数成「一个当前 + 一个旧版」，得出假的 stale。
> 逐字节对比重建结果没有这个问题。

## 内核改完之后的标准动作

```sh
# 1. 内核提示词改了（lib/default-prompt-inject.zh.md / .en.md）
npm run qoder:sync               # 重建 qoder 那份
npm test                         # qoder-prompt-sync 会确认没漏

# 2. 让装好的 Qoder 用上（先关 Qoder）
node lib/qoder/qoder-purge.mjs --verify          # 看是不是已经旧了
node lib/qoder/qoder-purge.mjs --force           # 从备份重建，重新打三个站点
node lib/qoder/qoder-purge.mjs --verify          # 应 exit 0
```

`--force` 会先从 `.purge-orig` 还原活着的 asar，再重打一遍 —— 所以连「上次打歪了」
也能一并修好。asar 被占用且不能改名时用 `--force-inplace`（原地流式覆盖）。

## 只管提示词，不管别的

Qoder 那边**没有**以下东西，也不打算搬：

- `lib/leaf-inject.js` 的叶子域词表 —— 那是 DSH 按会话算域路由的表，Qoder 没有 hook 点。
- `skills/redteam/` 24 个技能 —— Qoder 不读这个目录。
- `--eval` / `--lessons` / `scoped-capability` / 会话隔离 —— 全是 DSH 侧的评测与 UI 基础设施。
- `lib/core.js` 的 89 条补丁 —— 文件级改写 DSH 的包，Qoder 是另一套 app。

换句话说：**内核提示词的每一处改动都要过一遍 Qoder；其它层面的改动不用。**
判定口径就是上面那道 `qoder:check` —— 它红了就是提示词漂了，它绿着就说明 Qoder 那份
已经是当前内核的镜像。

## Qoder 0.5.1 之后的三个结构变化（2026-10-30 更新）

Qoder 从 0.5.1 起改了两件事，脚本跟着改了三处。这三处都踩过坑，写在这里免得下次重踩。

### 1. 安装位置：根目录才是当前版本

0.4.x 时代版本都装在 `.qoder-versions/<版本>/`，脚本也只扫那里。0.5.1 改成
**根目录即当前版本**（`<root>/resources/app.asar`，版本号在
`resources/build-manifest.json` 的 `productVersion`），`.qoder-versions/` 里只剩历史版本。

旧脚本因此报**假绿**：`--check` / `--verify` 对着 `.qoder-versions/0.4.11` 说
`state: "current"`，而真正在跑的 0.5.1 一个字没动。

现在 `listInstalls()` 把根安装和 `.qoder-versions/*` 都算候选，`readRootVersion()`
依次读 `build-manifest.json` 的 `productVersion` 与 `resources/app/package.json` 的
`version`，`cmpVersion()` 按数字段比较，取版本号最大的那份。`--check` / `--verify` /
`--force` 全部走这条发现逻辑。

### 2. 混淆结构：不再有唯一全局 wrapper，改换表项

0.4.11 的形态是：字符串表 `QJ()` + 旋转 IIFE + 解码器 `_` + 唯一 wrapper
`n(t,x)=_(t-233,x)`，补丁做法是「解码表 → 按内容找表索引 → 正则替换每个 `n(T)` 调用点」。

0.5.1 变了：

| | 0.4.11 | 0.5.1 |
| --- | --- | --- |
| 表 | `QJ()`，52576 项 | `C00()`，57809 项 |
| 解码器 | `_(t,x){t=t-233}` | `x0(t,x){t=t-385}` |
| wrapper | 唯一 `n(t,x)=_(t-233,x)` | **没有唯一的**；实际是 `c(t,x){return x0(x- -271,t)}`，索引在**第二参数** |
| 同名定义 | — | `e` 5005 个、`x` 5625、`n` 2300、`r` 1785、`a` 1088…；188 个名字里只有 23 个是唯一定义 |

按 wrapper 反推调用点在 0.5.1 会命中一堆假点（`r(48676,27524)` 落在 ajv 的
`instancePath` 上、`c(35574,26658)` 落在 i18n 文案表里）。**放弃了这条路。**

真正的破局点是：**三个提示词在表里就是整段的**，而且每个表项全表唯一。

| 提示词 | 0.4.11 索引 | 0.5.1 索引 | 0.5.1 解码后长度 |
| --- | --- | --- | --- |
| `main_coding` | 39220 | 26544 | 3008 |
| `desktop_instructions` | 50697 | 50685 | 540 |
| `persona` | 26220 | 35703 | 15317 |

所以 `patchMain()` 改成**换表项**：`encodeWithCharset()` 用同一套 65 字符 charset 把
提示词编回 base64，`splitTableBody()` 按 `","` 切开表源码（charset 里没有 `"` 也没有
`,`，切开是安全的），校验「表项唯一 + 编码往返一致 + 原文出现次数恰为 1」之后
`split(raw).join(enc)`。**集群无关** —— 不必知道谁在引用这条表项，换掉内容，
所有引用点自动拿到新文本。

### 3. 旋转 IIFE：默认不跑（它是死循环陷阱）

`})(C00,243580)` 那个 IIFE 是 `for(;;) try { ...parseInt 校验和... } catch { t.push(t.shift()) }`，
旋转 243580 次 × 57809 项。校验和一旦永不成立就是**挂死**（实测把 `--check` 挂住
10 分钟以上）。

它只对旧的「按索引找调用点」路径有用（把表原地旋转，让 `n(T)` 落到正确表项）。
换表项之后表项内容与顺序无关，所以默认不跑；需要旧路径时用
`QODER_PURGE_ROTATE=1` 显式打开。

### 4. 换 asar：隔离失败自动退回 in-place

0.5.1 的 `app.asar` 常被一个没有 `FILE_SHARE_DELETE` 的句柄捏着，`taskkill` 掉
`Qoder CN.exe` 也未必立刻释放，`swapAsarIsolated()` 的 rename 直接 `EBUSY`。

现在 `cmdPatch()` 捕获 `abort-busy isolate live asar failed` 并自动转
`cmdInplaceSwap()`：从 0 覆写 + `ftruncate` + `fsync`，然后回读校验
`electronMain.js` 逐字节一致。**只在这一种错误上退回**，其余错误照常抛。
手动入口 `--force-inplace` 仍然保留。

> 注意：`--force-inplace` 会重建 `.purge-new` 并覆写活着的 asar，属于会改文件的动作。
> 它和 `--force` 的区别只在于「换文件的方式」，不改变补丁内容。

### 0.5.1 上的实测结果

```text
$ node lib/qoder/qoder-purge.mjs --check --force
{ "version": "Qoder CN",
  "asar": "...\\Qoder CN\\resources\\app.asar",
  "decoder": "x0(t-385) over table[57809]",
  "promptSites": "main_coding@idx26544x1, desktop_instructions@idx50685x1, persona@idx35703x1",
  "permissionSites": 9, "marker": true }

$ node lib/qoder/qoder-purge.mjs --force-inplace
[patched] { ..., "fuse": "… EnableEmbeddedAsarIntegrityValidation=on … | manifest 8a487263… → 5293a346… (exe patched in place, backup: Qoder CN.exe.purge-orig)" }

$ node lib/qoder/qoder-purge.mjs --verify
[verify] current: live prompt is exactly purge-prompt.zh.md (14121 chars, 281 lines)   # exit 0
```

`--verify` 的「重跑一遍 patchMain 再逐字节比」这套判据在两个版本上都成立：
0.4.11 的表项和 0.5.1 的表项都是整段提示词，替换方式不同不影响比对结果。

### 回归测试

`test/qoder-install-discovery.test.mjs`（5 条）锁住这几点，防止下次改回去：

- 根目录安装（0.5.1 布局）会被当成候选，不会只认 `.qoder-versions`；
- `cmpVersion` 按数字段比较，`0.5.1 > 0.4.11`；
- 补丁路径用 `encodeWithCharset` / `splitTableBody` 换表项，旧的
  `out.replace(re, () => JSON.stringify(purgeText))` 必须已消失；
- 旋转 IIFE 必须由 `QODER_PURGE_ROTATE === '1'` 把关；
- 隔离失败要退回 `cmdInplaceSwap`；
- 合成表项的编码往返一致，且编码结果里不含 `"` 和 `,`。
