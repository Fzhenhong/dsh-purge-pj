# 1.1.95

## 中文

- 版本 **1.1.95**。
- **消息能发出去了，但选择器标签还是回落成「请选择模型」**：上一条（1.1.94）修好了"发不出去"，标签依旧不对，因为 `makeProxyAdapter.listModels()` 里有一句隐藏开关：

  ```js
  // 隐藏模式（默认）：返回空目录，宿主 buildModelCatalog 会 filter(models.length > 0)
  if (cfg.aliasInCatalog !== true) return [];
  ```

  原地替换时沿用了这个默认，于是**真 provider 的模型目录被清空**。宿主 `buildModelCatalog` 会 `.filter(group => group.models.length > 0)` 把整组扔掉，选择器拿 `lastUsed.provider`/`model` 在空目录里查不到，标签就回落成占位文案（会话本身是干净的：`lastUsed = {provider:"fzh", model:"deepseek-v4.1-flash"}`）。
  - 原地替换的代理现在显式传 `aliasInCatalog: true`：它占的就是真 provider 的位置，模型目录必须照旧可见。
  - `providerInfo` 的"别名后缀"改成只在**真别名**（provider id ≠ 源 provider）时才加：原地替换时 id 相同，名字原样返回，不会变成 `fzh (purge)`；兼容目标仍显示 `fzh (兼容)`。
- **验证**：`node --test` 364 tests / 363 pass / 1 skip / 0 fail（新增 2 条：原地替换后 `listModels("fzh")` 非空且条目 provider 为 `fzh`；`providerInfo("fzh").name` 不含 `purge`/`兼容`）。

## English

- **1.1.95**.
- **Messages send again, but the picker label still fell back to "请选择模型"**: 1.1.94 fixed sending, not the label. The cause is a hidden switch inside `makeProxyAdapter.listModels()`:

  ```js
  // hidden mode (default): report an empty catalog; the host's buildModelCatalog
  // filters out groups with `.filter(group => group.models.length > 0)`
  if (cfg.aliasInCatalog !== true) return [];
  ```

  The in-place swap inherited that default, so the **real provider's model catalog was wiped**. The host drops the whole group, the picker cannot resolve `lastUsed.provider`/`model` in an empty catalog, and the label falls back to the placeholder (the session itself is clean: `lastUsed = {provider:"fzh", model:"deepseek-v4.1-flash"}`).
  - The in-place proxy now passes `aliasInCatalog: true` explicitly: it occupies the real provider's slot, so its catalog must stay visible.
  - The alias suffix in `providerInfo` is now applied only for a **real alias** (provider id ≠ source provider). With an in-place swap the ids match, so the name stays `fzh` and never becomes `fzh (purge)`; the compatibility target still renders as `fzh (兼容)`.
- **Verified**: `node --test` 364 tests / 363 pass / 1 skip / 0 fail (2 new: `listModels("fzh")` is non-empty and its entries carry provider `fzh`; `providerInfo("fzh").name` contains neither `purge` nor `兼容`).

# 1.1.94

## 中文

- 版本 **1.1.94**。
- **1.1.93 之后旧会话变成"模型操作失败：session/model-unavailable: Select an available model before sending a message"**：1.1.93 不再注册 `<provider>-purge` 别名，但**之前**已经被落库成 `fzh-purge` 的会话还在。宿主的 `modelAvailable()` 拿 `selection.provider` 去 `llm.listProviders()` 里逐个对 id，对不上就抛这个错，消息连发都发不出去（表现就是"请选择模型"或这条英文报错）。
  - 补一个**兼容目标**：原地替换成功后，额外把 `<provider>-purge` 注册成一个只做兼容的 provider，`listModels` 照旧转发给真 adapter，因此 `modelAvailable()` 能查到 id、也能查到模型，老会话立刻恢复可发送。
  - 兼容目标的显示名带后缀，和真 provider 区分开（默认 `purge`，这里传 `兼容`，显示为 `fzh (兼容)`）。
  - 真正发请求时 `agent/request` 仍然把 `-purge` 改回真 provider，所以 `request/header` 落库的是干净值，脏数据用一次就自愈；新会话永远不会选到兼容目标。
  - 兼容目标随插件 dispose 一起释放；注册不上（老宿主没有 `listProviders`）不影响新会话。
- **验证**：`node --test` 362 tests / 361 pass / 1 skip / 0 fail（新增 2 条兼容目标断言：`listProviders()` 含 `fzh-purge`、`listModels()` 仍列出 `deepseek-v4.1-flash`、显示名含"兼容"）；`state.state().compat` 暴露兼容列表便于排障。

## English

- **1.1.94**.
- **After 1.1.93, older sessions failed with "session/model-unavailable: Select an available model before sending a message"**: 1.1.93 stopped registering the `<provider>-purge` alias, but sessions that had already persisted `fzh-purge` still reference it. The host's `modelAvailable()` compares `selection.provider` against every id from `llm.listProviders()` and throws when nothing matches, so the message cannot even be sent.
  - A **compatibility target** is now registered after the in-place swap: `<provider>-purge` becomes a proxy-only provider whose `listModels` still delegates to the real adapter, so `modelAvailable()` finds both the id and the model and legacy sessions can send again.
  - The compatibility target is labelled distinctly (default `purge`, here `兼容`, rendering as `fzh (兼容)`) so it never masquerades as the real provider.
  - Real requests still have `-purge` rewritten back to the real provider by the `agent/request` hook, so the persisted `request/header` keeps the clean name and the dirty value heals after one use; new sessions never select the compatibility target.
  - The target is disposed with the plugin, and a host without `listProviders` simply skips it without affecting new sessions.
- **Verified**: `node --test` 362 tests / 361 pass / 1 skip / 0 fail (2 new compatibility assertions: `listProviders()` contains `fzh-purge`, `listModels()` still lists `deepseek-v4.1-flash`, label contains 兼容); `state.state().compat` exposes the list for troubleshooting.

# 1.1.93

## 中文

- 版本 **1.1.93**。
- **装上插件、还没点「应用」就先把模型选择器搞坏**：插件为了做请求体整形，会把真实 provider 换成自己注册的别名 `<provider>-purge`（如 `fzh-purge`）。宿主的 `modelSelection` 投影把每条 `request/header` 的 `config.provider` **原样**落库成"上次用的模型"，于是别名被存了下来；重启后别名还没懒注册，模型选择器按 `lastUsed.provider` 查 provider 目录查不到，就显示占位文案「请选择模型」，且每次发消息都写回脏值、每次重启复发。**这跟有没有点「应用」无关**——应用只负责往宿主文件写代码补丁，别名是运行时那层装的，装完插件就已经在生效。
  - 改为**原地替换 adapter**：`installRequestShape` 现在优先取 `llm.registration(provider)` 返回的注册表对象，直接把它上面的 `adapter` 换成代理。provider 名一个字都不改，因此 request header 永远干净、`lastUsed` 不再被污染，模型目录也不会多出一条同名项。
  - 写入后**读回校验**：有些宿主版本 `registration()` 每次拼临时对象返回，写进去等于没写；校验不过就还原并退回原来的别名注册，不会"以为装上了"。
  - 旧会话里已经存着 `-purge` 的，请求进来时会自动改回真 provider，脏值随下一次写入自愈。
  - 兜底路径（注册表不可原地改 / 拦不住）保持原样的别名逻辑，行为不变。
- 配套：新增补丁 `#104/#105`（1.1.92）仍然保留，给已经点过「应用」的机器做落库侧兜底；新增 `--doctor` 告警 —— 官方密封包（`app.asar` 还在）时，如果补丁写在宿主根本不加载的 `resources/app` 里，会直接打印"点「应用」解开一次"的警告，不再让 applied 计数误导人。
- **验证**：`node --test` 360 tests / 359 pass / 1 skip / 0 fail（新增 6 条原地替换单测 + 4 条 asar 影子告警单测）；原地替换在 `adapters` 是 Map 的宿主形状下断言 provider 不变、别名不注册、代理仍转发、`providerInfo.id` 保持。

## English

- **1.1.93**.
- **Installing the plugin broke the model picker before any 「应用」 click**: to shape request bodies the plugin swaps the real provider for its own alias `<provider>-purge` (e.g. `fzh-purge`). The host's `modelSelection` projection copies `config.provider` verbatim from every `request/header` into `lastUsed`, so the alias is durably stored as "the model the user last used". After a restart the alias is not registered yet, the picker's catalog lookup misses, and it renders the "请选择模型" placeholder — rewritten on every message, so it recurs on every restart. This is independent of whether 「应用」 was clicked: apply only writes host-file code patches, while the alias layer is installed at runtime as soon as the plugin loads.
  - Now the adapter is **wrapped in place**: `installRequestShape` prefers the registration object returned by `llm.registration(provider)` and replaces its `adapter` property. The provider name never changes, so request headers stay clean, `lastUsed` is never polluted, and the model catalog gains no duplicate entry.
  - The swap is **read back and verified**: on host versions where `registration()` builds a throwaway object the write would be a no-op; if verification fails the original adapter is restored and the old alias registration is used instead, so the layer never silently pretends to be installed.
  - Sessions that already stored a `-purge` provider get rewritten back to the real name on the next request, so the dirty value heals itself.
  - The fallback path (registration not mutable / swap does not stick) keeps the previous alias behaviour unchanged.
- Also: patches `#104/#105` from 1.1.92 remain as a persistence-side safety net for machines where 「应用」 did run; `--doctor` now warns when the official sealed package (`app.asar` still present) means patches only exist in a `resources/app` tree the host never loads, instead of letting the applied counter mislead.
- **Verified**: `node --test` 360 tests / 359 pass / 1 skip / 0 fail (6 new in-place tests + 4 new asar-shadow tests); the in-place path asserts an unchanged provider, no alias registration, the proxy still forwarding, and `providerInfo.id` preserved on a Map-shaped host.

# 1.1.92

## 中文

- 版本 **1.1.92**。
- **装完插件重启客户端，模型选择器变成「请选择模型」**：插件为了给请求体整形，会把自己注册成 `<provider>-purge`（如 `fzh-purge`）的**请求别名**，并在 `agent/request` 瀑布里把真实 provider 换成别名。问题出在持久化：宿主的 `dsh-api-session-controller` 投影在每一条 `request/header` 事件里把 `header.config.provider` **原样**写进 `modelSelection.lastUsed`，于是别名被落库成"用户上次用的模型"。重启后别名还没懒注册（要等第一次请求），模型选择器按 `lastUsed.provider` 去 provider 目录里查不到，就渲染成占位文案「请选择模型」；用户手动重选一遍才好，但下一次请求又把别名写回去，所以每次重启都复发。会话记录里能直接看到脏值：`"modelSelection":{... "lastUsed":{"provider":"fzh-purge", ...}}`。
  - 已有补丁 `#96/#97` 只修了「算不算模型切换」的判定和对话里的标签（`sameRoute` / `routeLabel`），没管落库这一步。
  - 新增补丁 `#104 MODEL_SELECTION_LASTUSED_ALIAS`（`dsh-api-session-controller/lib/types/model-selection-projection.js`）与 `#105 MODEL_SELECTION_LASTUSED_ALIAS_INLINE`（bundle 内联版 `lib/index.js`）：写 `lastUsed` 前把 provider 的 `-purge` 后缀剥掉。
  - 同一个补丁顺带把投影的 `view` 也做了剥离：老会话里已经落库的脏值**不用等下一次请求**，重启后立刻显示正常的 provider。
- **验证**：`lib/core.js` 语法检查通过；两条 pattern 在已安装宿主文件上各命中 1 次、初始未标记；打完后 `node --check` 两个宿主文件均通过；`node scripts/gen-patch-contract.mjs` 重新生成契约（patches=99）；`node --test` 全绿（350 tests / 349 pass / 1 skip）。

## English

- **1.1.92**.
- **After installing the plugin and restarting the client, the model picker showed "请选择模型" (select a model)**: to shape request bodies the plugin registers a **request alias** <code>&lt;provider&gt;-purge</code> (e.g. `fzh-purge`) and swaps the real provider to that alias inside the `agent/request` waterfall. The leak is in persistence: the host's `dsh-api-session-controller` projection copies `header.config.provider` verbatim into `modelSelection.lastUsed` on every `request/header` event, so the alias is durably stored as "the model the user last used". After a restart the alias is not registered yet (it is created lazily on the first request), the picker looks `lastUsed.provider` up in the provider catalog, misses, and renders the "select a model" placeholder. Re-picking by hand works until the next request writes the alias back, so it recurs on every restart. The dirty value is visible in the session state: `"modelSelection":{... "lastUsed":{"provider":"fzh-purge", ...}}`.
  - The existing patches `#96/#97` only fixed the "is this a model switch" comparison and the in-conversation label (`sameRoute` / `routeLabel`); persistence was left alone.
  - New patches `#104 MODEL_SELECTION_LASTUSED_ALIAS` (`dsh-api-session-controller/lib/types/model-selection-projection.js`) and `#105 MODEL_SELECTION_LASTUSED_ALIAS_INLINE` (the bundle-inlined copy in `lib/index.js`) strip the `-purge` suffix before `lastUsed` is written.
  - The same patches also strip it in the projection's `view`, so values already stored by older sessions render correctly immediately after restart, without waiting for the next request.
- **Verified**: `lib/core.js` parses; both patterns match exactly once in the installed host files and were unmarked beforehand; `node --check` passes on both patched host files; contract regenerated (`patches=99`); `node --test` green (350 tests / 349 pass / 1 skip).

# 1.1.91

## 中文

- 版本 **1.1.91**。
- **#209 桌面版一启动就弹 "desktop welcome: Web authentication failed"**：桌面壳每次启动都从宿主领一条**新名字**的 `dsh-auth-<随机>` cookie（`Max-Age` 30 天、`Path=/`、host_key `127.0.0.1`），没有任何回收。实测 8 天攒到 71 条 / 15,975 字节，Chromium 侧 `net.fetch` 带出的 `Cookie` 头超过宿主 Node HTTP 的 16KB `maxHeaderSize`，宿主直接回 **431 Request Header Fields Too Large**，`connectDesktopWelcome` 判 `!ok` 抛错并 SIGTERM 宿主，UI 弹"应用无法启动"。同一次握手用 Node 原生 `fetch`（不吃 cookie jar）永远拿 303，所以 `authenticateWebHost` 那一步始终正常，只有下一步炸 —— 这也是它难查的原因：curl、Chrome、宿主日志全都好看。
  - 新增补丁 `#103 DESKTOP_WELCOME_COOKIE_SWEEP`（`desktop-shell`）：在 `connectDesktopWelcome` 之前把会话里所有 `dsh-auth-` 前缀的 cookie 按 origin 逐个 `cookies.remove()`，本次的 cookie 由紧随其后的握手重新写入。整段包在 `try/catch` 里，清理失败绝不阻断启动。
  - 只认 `dsh-auth-` 前缀，不碰平台账号视图用的其它 cookie；平台视图本来就是独立 session 分区。
- **验证**：`lib/core.js` 语法检查通过；补丁 #103 的 pattern 在已安装的 `resources/app/lib/main.js` 上命中 1 次、初始未标记；`node scripts/gen-patch-contract.mjs` 重新生成契约（patches=97）；重启桌面壳后 `net.fetch` 实测返回 200，`Network/Cookies` 里 `dsh-auth-*` 稳定在 1 条。

## English

- **1.1.91**.
- **#209 the desktop shell died on every launch with "desktop welcome: Web authentication failed"**: each launch the shell collects a `dsh-auth-<random>` cookie with a **new name** (`Max-Age` 30 days, `Path=/`, host_key `127.0.0.1`) and nothing ever reclaims them. Measured: 71 cookies / 15,975 bytes over 8 days. The `Cookie` header Chromium's `net.fetch` then sends exceeds the host's 16KB Node HTTP `maxHeaderSize`, the host answers **431 Request Header Fields Too Large**, `connectDesktopWelcome` sees `!ok`, throws and SIGTERMs the host behind an "application could not start" dialog. The same handshake through Node's own `fetch` (no cookie jar) always returns 303, so `authenticateWebHost` passes and only the next step fails — which is why it hid so well: curl, Chrome and the host logs all look healthy.
  - New patch `#103 DESKTOP_WELCOME_COOKIE_SWEEP` (`desktop-shell`): before `connectDesktopWelcome`, every `dsh-auth-` prefixed cookie in the session is removed by origin; the handshake immediately below re-acquires the one this launch needs. Wrapped in `try/catch` so a failed sweep can never block startup.
  - Only the `dsh-auth-` prefix is touched; the platform account view keeps its own cookies in its own partition anyway.
- **Verified**: `lib/core.js` parses; patch #103 matches exactly once in the installed `resources/app/lib/main.js` and was not previously marked; contract regenerated (`patches=97`); after relaunching the shell `net.fetch` returns 200 and `Network/Cookies` settles at a single `dsh-auth-*` entry.

# 1.1.90

## 中文

- 版本 **1.1.90**。
- **#208 Android 切后台回来输入框整块消失**：撤销按钮原先注册在宿主的 `conversation.input.right` 槽位，这个槽位渲染在 composer 的 React 子树里。宿主在提交阶段只要抛一次错，React 会把整棵树卸载，症状就是输入框连带按钮一起没了。
  - 撤销按钮不再走任何槽位。改为在 `body` 上挂一个 `position: fixed` 的宿主节点，用 `createPortal` 把按钮传进去，渲染树完全脱离 composer；composer 内部再出错也牵连不到它。
  - 位置按最靠下的那组 `.standardControls`（就是 composer 底部工具条）的矩形实时对齐，并给它留 `padding-left` 空位，不遮住模型选择器；预留宽度跟着按钮实测宽度走。
  - 会话切换、窗口尺寸变化、页面滚动都会重新对齐；没有会话时按钮不显示、留白也一起归还。
  - 锚点查找带缓存和节流，只在锚点缺失或掉线时才扫一次 DOM，长会话滚动不受影响。
- **验证**：`client.js` 语法检查通过；`conversation.input.right` 在本插件中已无任何注册点；双宿主 `standardControls` 类名核对一致。

## English

- **1.1.90**.
- **#208 the whole composer vanished after switching apps**: the undo button was registered into the host's `conversation.input.right` slot, which renders inside the composer's React subtree. One throw during a commit phase makes React unmount that tree, and the input box goes with it.
  - The undo button no longer uses any slot. It renders through `createPortal` into a `position: fixed` host appended to `body`, fully outside the composer subtree, so a composer error can no longer take it down.
  - It aligns itself to the rectangle of the bottom-most `.standardControls` (the composer toolbar) and reserves `padding-left` there so the model picker is not covered; the reserved width follows the button's measured width.
  - It re-aligns on session change, resize and scroll, and releases both the button and the reserved space when there is no session.
  - Anchor lookup is cached and throttled: the DOM is scanned only when the anchor is missing or detached, so long chats keep scrolling smoothly.
- **Verification**: `client.js` passes the syntax check; no `conversation.input.right` registration remains in the plugin; the `standardControls` class name matches on both hosts.

# 1.1.89

## 中文

- 版本 **1.1.89**。
- **#204 工作目录提示恢复**：`deployment:persona-suffix` 优先写会话真实 cwd 字面量（`interpolate: false`），拿不到才退静态描述；同时把 `cwd` 补进 `assembly.variables`，用户自己模板里的 `{{cwd}}` 也能渲染。0.2.1 不再抛 `unknown prompt variable`，工作目录提示不再变成 `the current workspace`。
- **#207 桌面静默退出可诊断**：
  - 新增 #92：宿主每次退出都把 `code` / `signal` / stderr 尾巴写进 `%TEMP%\dsh-purge-desktop.log`（不再只记 signal 分支）。
  - 新增 #93：主进程记录 `boot` / `before-quit` / `will-quit` / `quit code` / `window-all-closed` / `render-process-gone`（附渲染进程最后几行 console）/ `child-process-gone` / 信号 / 每分钟心跳。只用 `uncaughtExceptionMonitor`，不改变崩溃行为。
  - asar 换包脚本：`Move-Item` 失败后改用 `.NET File.Move` 重试，成功/失败都 `Test-Path` 复核并记录真实错误；空闲改名脚本同样记录失败原因（限流，不刷屏）。
- **#202 原子写**：`atomicWriteFile` 保持 `writeFile + rename`（不依赖 hostFs 白名单里没有的 `open`）；CLI `--apply` 成功后补打应用戳，下次启动 settle 不会误判未对齐再重打。
- **修复重复标记**：#32 / #53 的 export 行锚点原来自我匹配，每点一次「应用」就多追加一行注释；改成带负向前瞻的正则，连续应用保持幂等。
- **验证**：web + desktop 双宿主现有补丁全部 applied；rc.2 夹具与 rc.5 实机 pattern 全绿；沙箱 42 个目标文件 apply/revert 字节级还原；生成的 PowerShell 脚本通过 `Parser::ParseFile` 语法检查。

## English

- **1.1.89**.
- **#204 working directory restored**: the persona suffix now uses the real session cwd as a literal (`interpolate: false`) and only falls back to the static sentence when no cwd is available; `cwd` is also added to `assembly.variables`, so user templates with `{{cwd}}` render. 0.2.1 no longer throws `unknown prompt variable`, and the prompt keeps the real path instead of `the current workspace`.
- **#207 desktop exit is diagnosable**:
  - New #92: every host exit writes `code` / `signal` / stderr tail to `%TEMP%\dsh-purge-desktop.log`.
  - New #93: main process logs `boot` / `before-quit` / `will-quit` / `quit code` / `window-all-closed` / `render-process-gone` (with the renderer console tail) / `child-process-gone` / signals / a one-minute heartbeat. Uses `uncaughtExceptionMonitor` only, so crash behavior is unchanged.
  - ASAR swap: falls back to `.NET File.Move` after `Move-Item` fails, verifies with `Test-Path`, and records the real error; the idle rename script logs failures too (rate-limited).
- **#202 atomic writes**: `atomicWriteFile` stays on `writeFile + rename` (the hostFs whitelist has no `open`); the CLI `--apply` now also writes the applied stamp so the next boot's settle does not re-apply.
- **Duplicate markers fixed**: the #32 / #53 export-line anchors matched their own output and appended another comment on every Apply; both now use negative lookaheads and are idempotent.
- **Verified**: all existing patches applied on both web and desktop hosts; rc.2 fixtures and rc.5 real files green; sandbox apply/revert restored 42 target files byte-for-byte; generated PowerShell scripts pass `Parser::ParseFile`.

# 1.1.88

## 中文

- 版本 **1.1.88**。吸收上游 **1.1.86（#197 / #198）** 的两条回收流程修复，这两条
  正是本机踩过的坑：`--apply` 后自动重启，detached 子进程接管 server，父进程
  250ms 就退出，关窗/关终端都杀不到它；下一次 `dsh web` 在 webserver 插件绑端口时
  撞 `EADDRINUSE`，而 0.2.x 把 required 插件激活失败当 **fatal**，宿主直接起不来。
- **web 孤儿 server 回收（新增 4 个模块）**：
  - `lib/web-reclaim.js`：pid 记录文件 `$DSH_HOME/dsh-purge/web-server-<port>.json`、
    按端口反查监听 pid（win32 `netstat -ano` / darwin+linux `lsof`）、
    `looksLikeDshWeb()` 只认 `@deepseek-ai/dsh/lib/bin.js … web` 的命令行。
    关键判据：**记录里的 pid 命令行拿不到时，必须证明它仍占着端口才杀** ——
    记录早于进程退出时，pid 被系统复用后盲杀会打到无关进程。
    杀不掉就保留记录下次再试，只有确认进程已不在才清记录；`waitGone()` 用
    `Atomics.wait` 忙等，因为 `taskkill` 返回不代表端口已释放。
  - `lib/web-preflight-entry.js`：侧车脚本，在 **Cordis 激活之前**做一次回收。
  - `lib/bin-preflight.js`：把侧车复制到宿主 `lib/dsh-purge-web-preflight.js` 并在
    `bin.js` 顶部加一行 import（形态与 hide-console 一致，同样跳过源码部署的
    `apps/cli/lib` 与封死的 asar）。
  - `lib/restart-web.js`：起 server 后立刻写 pid 记录，解析出 URL 时再补写一次；
    `killOldServer()` 增加按端口兜底，清掉旧版本留下、没有 pid 记录的孤儿。
- **桌面换包先杀 Electron main（#197b）**：`ASAR_SWAP_PS1` 现在先按安装根路径 +
  非 `--type=` 识别并 kill Electron main，再扫安装目录其余进程。main 是唯一会弹
  「host stopped」对话框的进程，先杀它就不会出现「host 死了、main 半死、asar 没动」
  的状态。挪包失败的分支补上 `Start-Process -FilePath $ExePath`：至少把原版拉起来，
  不再把用户扔在空桌面上；失败原因写进 `%TEMP%\dsh-purge-desktop.log`。
  `ASAR_SWAP_PS1` 改为导出，新增 `test/desktop-asar-swap.test.js` 守住顺序。
- **重启提示**：`scheduleRestart()` 现在会打印「已在后台重启 dsh web，关掉这个窗口
  不会停它」，避免把提示符返回误判成程序已退出，然后立刻再开一个 → 又撞 EADDRINUSE。
- **宿主版本分档**：`hostCompat()` 新增 `level`（`exact` / `prerelease` / `patch` /
  `minor` / `major` / `unknown`），只有 `exact` 与 `prerelease` 算适配。声明 rc.2、
  在跑 rc.3/rc.5 不再画红，改为中性色提示「只差预发布/补丁号，官方原文未变」；
  真跨 minor/major 才报「未适配」。`gatherState()` 新增 `host_compat_level`。
- **selfcheck 误报清理**：注入文件行改用 `looksLikePluginDefault()` 判定，标记计数
  容忍宿主写入的零宽字符（本机 `<project` + U+200B + `instructions>`）；shim 行按
  「本安装实际发了几个启动器」判；Qoder 行跨盘扫 `Qoder CN` 安装根（本机在 D 盘，
  且 0.5.1 在根目录而非 `.qoder-versions/`）。
- **桌面宿主 pi-ai 补丁误判 na**：`keepSurfaceFile()` 原按**当前进程** surface 判区，
  在 web 会话里对桌面 aiBase 求值时把桌面文件当区外过滤，`#47/#49/#57/#90/#91`
  五条假 na。改走 `allowTargetForPatch()`（按正在算的那份宿主判区）。
- 测试：**337 条全过**（新增 `test/host-compat.test.mjs` 5 条、
  `test/desktop-asar-swap.test.js` 3 条、`test/web-reclaim.test.js` 12 条）。

## English

- Version **1.1.88**. Absorbs upstream **1.1.86 (#197 / #198)** — the two reclaim
  fixes behind a failure mode this machine actually hit: after `--apply` the
  auto-restart hands the server to a detached child and the foreground process
  exits 250 ms later, so closing the window or the terminal kills nothing. The
  next `dsh web` then collides on the port, and 0.2.x treats a required-plugin
  activation failure as **fatal** — the host never boots.
- **Web orphan reclaim (4 new modules)**: `lib/web-reclaim.js` keeps
  `$DSH_HOME/dsh-purge/web-server-<port>.json`, resolves listening pids by port
  (`netstat -ano` on win32, `lsof` elsewhere) and only treats a command line as
  ours when it matches `@deepseek-ai/dsh/lib/bin.js … web`. When the recorded
  pid's command line is unreadable it must **still own the port** before being
  killed — a stale record plus pid reuse would otherwise hit an unrelated
  process. Unkillable pids keep their record for the next boot; the record is
  cleared only once the process is confirmed gone. `waitGone()` busy-waits
  because `taskkill` returning does not mean the port is free.
  `lib/web-preflight-entry.js` (sidecar) and `lib/bin-preflight.js` (copies it to
  the host's `lib/` and adds one import line at the top of `bin.js`, before
  Cordis activates) install the hook; `lib/restart-web.js` writes the pid record
  on spawn and again once the URL is parsed, and its `killOldServer()` gained a
  port-based fallback for orphans left by older versions.
- **Desktop asar swap kills Electron main first (#197b)**: main is the only
  process that raises the "host stopped" dialog, so killing it first avoids the
  half-dead state. When the move still fails, the original app is relaunched
  instead of leaving an empty desktop, and the reason is appended to
  `%TEMP%\dsh-purge-desktop.log`. `ASAR_SWAP_PS1` is exported now.
- **Host version tiering**: `hostCompat()` returns `level` and only `exact` /
  `prerelease` count as compatible, so declaring rc.2 while running rc.3/rc.5 no
  longer shows red; real minor/major jumps still do.
- Tests: **337 passing**.

# 1.1.87

## 中文

- 版本 **1.1.87**。Qoder CN 升到 **0.5.1**（2026-10-30 构建，electron 43.1.1）之后，
  Qoder 那条线整套判据失效：`--check` / `--verify` 对着 `.qoder-versions/0.4.11`
  报 `state: "current"`，而真正在跑的 0.5.1 一个字没打。三处根因逐个修掉。
- **安装发现：根目录才是当前版本**。0.4.x 版本都装在 `.qoder-versions/<版本>/`，
  脚本也只扫那里；0.5.1 改成根目录即当前版本（版本号在
  `resources/build-manifest.json` 的 `productVersion`），旧目录里只剩历史版本 ——
  于是「查到了、查的是旧的」。新增 `readRootVersion()` / `cmpVersion()` /
  `listInstalls()`，根安装与 `.qoder-versions/*` 都算候选、按数字段比版本号取最大，
  `findLatestVersion()` 改用它。`--check` / `--verify` / `--force` / `--force-inplace`
  全部走这条发现逻辑。
- **补丁路径：换表项，不再按 wrapper 反推调用点**。0.5.1 的混淆器不再有唯一全局
  wrapper：0.4.11 的 `n(t,x)=_(t-233,x)` 消失了，实际是 `c(t,x){return x0(x- -271,t)}`
  —— 索引在**第二参数**；而且同名 wrapper 海量（`e` 5005 个定义、`x` 5625、`n` 2300、
  `r` 1785、`a` 1088…，188 个名字里只有 23 个唯一定义）。按 wrapper 反推会命中一堆
  假点：`r(48676,27524)` 落在 ajv 的 `instancePath` 上、`c(35574,26658)` 落在
  i18n 文案表里。
  破局点是**三个提示词在表里就是整段的、且每个表项全表唯一**（`main_coding`
  idx 26544 / 3008 字符、`desktop_instructions` idx 50685 / 540 字符、`persona`
  idx 35703 / 15317 字符；0.4.11 侧是 39220 / 50697 / 26220，同样整段同样唯一）。
  新增 `encodeWithCharset(text, CS)`（同一套 65 字符 charset 编回 base64，往返校验）
  与 `splitTableBody(body)`（按 `","` 切，charset 里没有 `"` 也没有 `,`，安全），
  `patchMain()` 改成：校验「表项唯一 + 编码往返一致 + 原文出现次数恰为 1」之后
  `split(raw).join(enc)`。**集群无关** —— 不必知道谁在引用这条表项。
- **旋转 IIFE 默认不跑**。`})(C00,243580)` 那个 IIFE 是
  `for(;;) try { ...parseInt 校验和... } catch { t.push(t.shift()) }`，旋转 243580 次 ×
  57809 项；校验和一旦永不成立就是**挂死**（实测把 `--check` 挂住 10 分钟以上）。
  它只对旧的「按索引找调用点」路径有用（把表原地旋转让 `n(T)` 落到正确表项），
  换表项之后表项内容与顺序无关，所以默认不跑；需要旧路径时
  `QODER_PURGE_ROTATE=1` 显式打开。
- **换 asar：隔离失败自动退回 in-place**。0.5.1 的 `app.asar` 常被一个没有
  `FILE_SHARE_DELETE` 的句柄捏着，`taskkill` 掉 `Qoder CN.exe` 也未必立刻释放，
  `swapAsarIsolated()` 的 rename 直接 `EBUSY`。`cmdPatch()` 现在捕获
  `abort-busy isolate live asar failed` 并自动转 `cmdInplaceSwap()`（从 0 覆写 +
  `ftruncate` + `fsync` + 回读校验），**只在这一种错误上退回**，其余错误照常抛。
  `--force-inplace` 手动入口保留。
- **错误信息带路径**：打开 asar 失败时把「选中了哪一份安装」写进错误
  （`cannot open asar for <版本>: <路径>`）—— 安装发现出过假绿，没有路径就看不出选错了谁。
- 新增 `test/qoder-install-discovery.test.mjs`（5 条）：根安装被当候选、
  `cmpVersion` 数字段比较、补丁路径必须用 `encodeWithCharset` / `splitTableBody`
  且旧的字面量替换必须已消失、旋转 IIFE 由 `QODER_PURGE_ROTATE` 把关、隔离失败退回
  `cmdInplaceSwap`、合成表项编码往返一致且结果不含 `"` / `,`。
- `docs/qoder-sync.md` 补三节「Qoder 0.5.1 之后的三个结构变化」，把上面这些坑与
  实测输出写进契约文档。`npm test` **320 条全过**。

## English

- Version **1.1.87**. Qoder CN moved to **0.5.1** (build 2026-10-30, electron 43.1.1)
  and the whole Qoder-side contract went stale: `--check` / `--verify` reported
  `state: "current"` against `.qoder-versions/0.4.11` while the live 0.5.1 install
  was untouched. Three root causes, three fixes.
- **Install discovery: the root directory is the current version.** 0.4.x kept each
  version under `.qoder-versions/<version>/`, which is all the script scanned; 0.5.1
  installs in place at the root (version in `resources/build-manifest.json` →
  `productVersion`) and leaves only historical versions in `.qoder-versions`. Added
  `readRootVersion()` / `cmpVersion()` / `listInstalls()`; `findLatestVersion()` now
  considers both locations and picks the highest numeric version.
- **Patching: replace the string-table entry, stop reverse-engineering wrapper call
  sites.** 0.5.1 no longer has a single global wrapper (0.4.11's `n(t,x)=_(t-233,x)`
  is gone; the real one is `c(t,x){return x0(x- -271,t)}` with the index in the
  **second** argument), and wrapper names collide massively (`e` has 5005
  definitions, `x` 5625, `n` 2300, `r` 1785, `a` 1088; of 188 distinct names only 23
  are uniquely defined). Reverse-engineering hits decoys: `r(48676,27524)` lands in
  ajv's `instancePath`, `c(35574,26658)` in an i18n string table.
  The way through: **all three prompts are stored as whole table entries and each
  entry is unique in the table** (`main_coding` idx 26544 / 3008 chars,
  `desktop_instructions` idx 50685 / 540 chars, `persona` idx 35703 / 15317 chars;
  0.4.11 uses 39220 / 50697 / 26220, same shape). Added `encodeWithCharset()` and
  `splitTableBody()`; `patchMain()` now verifies "entry unique + encode roundtrip +
  exactly one occurrence" and does `split(raw).join(enc)`. **Cluster-agnostic** — no
  need to know who references the entry.
- **The rotation IIFE no longer runs by default.** `})(C00,243580)` is a
  `for(;;) try { ...checksum... } catch { t.push(t.shift()) }` loop: 243580 rotations
  over 57809 entries, i.e. a hang if the checksum never holds (it hung `--check` for
  over 10 minutes in testing). It only served the old index-based path; opt in with
  `QODER_PURGE_ROTATE=1`.
- **Swapping the asar: fall back to in-place automatically.** 0.5.1's `app.asar` is
  often held by a handle without `FILE_SHARE_DELETE`, so `swapAsarIsolated()`'s
  rename fails with `EBUSY` even after `taskkill`. `cmdPatch()` now catches
  `abort-busy isolate live asar failed` and switches to `cmdInplaceSwap()` (overwrite
  from offset 0 + `ftruncate` + `fsync` + read-back verify), and only for that error.
- Added `test/qoder-install-discovery.test.mjs` (5 cases) and documented the three
  structural changes in `docs/qoder-sync.md`. `npm test` **320 passing**.

# 1.1.86

## 中文

- 版本 **1.1.86**。第二轮 GitHub 生态巡检：把 `dongliuwuzhong-arch/DSH-purge`、
  `Crow-purge`、`54zhien/dsh-purge-plus`、`555bbbAAA/dsh-purge`、`realMisakaMikoto/dsh-purge`
  五个衍生仓库里有价值、本仓库又确实缺的能力，按本仓库口径重写后整合进来。
- **原子写带 rename 退避重试**（吸收 `DSH-purge/lib/atomic-io.js`）：
  `atomicWriteSync` / `atomicWriteFile` / `atomicCopyFile` / `atomicCopyFileSync`
  四个入口统一走 `RENAME_RETRY_DELAYS=[20,60,150]`，只对 `EPERM`/`EBUSY`/`EACCES`/`ENOTEMPTY`
  重试。Windows 上 rename 撞宿主进程占用是瞬时的 —— 实测过一次
  `EPERM rename *.tmp -> cordis.patch.yml`，退避重试即成功、字节一致。三次都失败时抛
  带 `code` 与中文提示的包装错误（"宿主进程可能正占用该文件：退出 DeepSeek Harness 后重试"），
  而不是把裸 `EPERM` 丢给用户。
- **helper 日志诊断**（吸收 `Crow-purge/lib/restart-diagnostics.js`，新增
  `lib/helper-logs.js`）：`restart-desktop.js` / `uninstall-restart.js` 都是
  detached + `stdio: ignore` 的子进程，宿主一退出没人接它们的输出，失败时唯一证据就是
  它们自己往 `%TEMP%` 写的日志。新增 `readLogTail` / `helperLogDiagnostics` /
  `nonEmptyHelperLogs`，只读尾部 8 KB、只取最后 12 行、从中间切进来时丢掉半行
  —— `/status` 是 5 秒一次的轮询，不能每次整文件读。`/dsh-purge/status` 返回
  `helper_logs` 字段，`--status` 在有内容时把路径与尾部行直接打出来。
- **动作流水**（吸收 `dsh-purge-plus/lib/tool-gate.js` 的「审计永远要有」那一半判据，
  新增 `lib/audit-log.js`）：`apply` / `revert` / `uninstall` 三个 HTTP 路由每次动作落一行
  JSONL 到 `<DSH_HOME>/dsh-purge/audit.jsonl`，含时间、pid、动作、结果、宿主、耗时、错误；
  超过 1 MB 翻滚成 `.1`。**只记流水，不加审批门** —— 本仓库的主入口是人自己点「应用」，
  人就是审批者，再弹一次只是多一次点击，而本机策略可能把 approval 一律自动拒绝，
  强制审批等于把插件锁死。`/dsh-purge/status` 返回 `audit_tail`（最近 20 条），
  `--status` 打最近 5 条。
- **被烧掉的 bak 基线重建**（吸收 `555bbbAAA/dsh-purge/lib/repair-baks.js`，新增
  `lib/bak-repair.js` + CLI `--repair-baks [--write]`）：1.1.72 之前的
  `refreshStaleBaksForUpgrade` 会把唯一一份原始备份刷成已打补丁的字节。现在那个函数
  已经不会再烧新备份，但**已经烧掉的**必须从别处取回原文，唯一可靠来源是官方归档
  `app.asar`。判定严格：只处理 `bak` 与当前文件**逐字节相同**的坏备份；`bak != current`
  的干净备份一律不动；正式文件一律不碰；归档里那份与当前文件相同（说明当前文件本来就是
  官方原文）时也跳过。默认只出计划，`--write` 才落盘。
- **#94/#95 漂移误判修正**：官方 `0.2.1-rc.3` 自己就把工具调度器改成了 `Symbol.for(...)`、
  也把 `toolRuntimeScheduler()` 搬进了 agent-loop，只是没带我们的注释。只认注释会让这两条
  永远停在 drifted（"官方原文已改，需更新 pattern"），实际早就改到位了。两条补丁改为
  `markersAny: true` 并补「结果态」标记（`Symbol.for("...")`、`function toolRuntimeScheduler(tools) {`、
  那句 `duplicate @deepseek-ai/dsh-tools copies split the scheduler Symbol`），
  状态从「77/94 已清洗, 2 漂移」变成 **81/94 已清洗, 0 待清洗, 0 漂移**。
- 测试 292 → **315 条**：新增 `test/helper-logs.test.mjs`(8)、`test/audit-log.test.mjs`(7)、
  `test/bak-repair.test.mjs`(8)。

## English

- Version **1.1.86**. Second GitHub-ecosystem patrol: absorbed five capabilities from
  `dongliuwuzhong-arch/DSH-purge`, `Crow-purge`, `54zhien/dsh-purge-plus`,
  `555bbbAAA/dsh-purge` and `realMisakaMikoto/dsh-purge`, rewritten to this repo's conventions.
- Atomic writes now retry `rename` on transient Windows contention (`EPERM`/`EBUSY`/`EACCES`/`ENOTEMPTY`,
  delays 20/60/150 ms) instead of failing on the first attempt.
- New `lib/helper-logs.js`: reads the tail (8 KB / 12 lines) of the detached helper logs in `%TEMP%`
  and exposes them through `/dsh-purge/status` and `--status`.
- New `lib/audit-log.js`: `apply` / `revert` / `uninstall` append one JSONL record each to
  `<DSH_HOME>/dsh-purge/audit.jsonl` (rotates at 1 MB). Audit only — no approval gate.
- New `lib/bak-repair.js` + `--repair-baks [--write]`: rebuild burned `.dshpurge.bak` baselines
  from the official `app.asar`. Dry run by default; only byte-identical bak/current pairs are touched.
- #94/#95 no longer report false drift on host `0.2.1-rc.3` (`markersAny` + result-state markers).

# 1.1.85

## 中文

- 版本 **1.1.85**。合并上游 1.1.83～1.1.85，并把社区版（kingcharleslzy-ai/dsh-purge）里
  三条本地缺的能力按本仓库口径重写后整合进来。
- **尾部锚点**（上游 1.1.84 / `lib/anchor.js`）：锚点段物理追加到 system prompt sections
  末尾（waterfall 返回的数组顺序就是渲染顺序，`order` 字段不参与排序），`identity.js`
  新增 `anchorText` 参数、同名段先滤再追加；锚点跟随操作者语言，删掉写死的英文开头句
  —— 那是红队会话回答突然变英文的根因。`anchorMode: "auto"` 可关。
- **子代理审批接管**（上游 1.1.84 / `lib/subagent-control.js`）：子会话
  `approval/policy=never` 会让 `decide()` 在 `approval/request` 瀑布之前直接 rejected，
  表现为「子代理什么都干不了」。这里把子会话的 never 改回 ask 并在瀑布放行；
  `subagentControl: false` 可关。主会话策略不动。
- **office 技能自愈**（上游 1.1.84）：`resources/runtime/office-skills/office/SKILL.md`
  缺失时桌面端启动直接 `DesktopHostFatalError` 退出。`healOfficeSkillsRuntimeOnDisk()`
  在插件起来之后从 app.asar / npm 安装树把缺的文件补回磁盘（救不了崩溃当次，但下次不崩）。
- **#194 卡顿熔断**：`refreshHungOperator` 改按内容变更版本号缓存（内存里换了正文但
  mtime 没变也算失效）；加风暴熔断（10s 内 120 次）与慢调用熔断（单次 ≥1.5s 进 30s
  冷却，期间只交内存钉子）；`rewriteLiveAssembly` 用 WeakMap 按 assembly 对象去重，
  guard 与 waterfall 不再各跑一遍 22k 正文。`assemble.rewrite` 日志新增
  `approval`（审批策略探针）与 `injectTail`（末段名匹配 `dsh-purge:*`）。
- **#191**：`cordis.patch.yml` 为 `[]` 时替换整行而不是追加成第二个文档。
- **#185 / #180**：`allowBuilds` 只写裸包名（`dsh-purge@https://...` 在 pnpm 11 会报
  `ERR_PNPM_INVALID_VERSION_UNION`）；URL 键解析不再被冒号截断、写回自动加引号；
  重写只保留精确期望键、畸形/过期键自愈，写前过最小校验，不过不写盘。
- **#196 深色主题**：宿主暗色下 `--dsw-alias-brand-primary` 解析成近白色 `#f9fafb`，
  设置页与演练台「品牌色作底 + 白字」的按钮全变白块。暗色统一改 `#3d8f68` 绿实底、
  悬停 `#347a59`，并显式写 `-webkit-text-fill-color`。
- **新增 #98 / #99 / #100**（rc.3 专属，均 optional）：
  - #98 `SANDBOX_POLICY_BRAND_NEUTRAL`：沙箱策略句去品牌。
  - #99 `SKILL_BADGE_DESCRIPTION_NEUTRAL`：官方「powered by dsh」徽章描述中性化。
  - #100 `DESKTOP_HOST_SIGNAL_EXIT_LOG`：宿主被信号杀掉时 #83 直接静默 resolve，
    UI 永远不知道 host 已经没了。保持不弹框，但把 signal/code 写进
    `os.tmpdir()/dsh-purge-desktop.log`。
- **维护锁**（吸收社区版 `maintenance-lock.js` 的判据，重写实现）：改宿主文件不是原子的，
  两个窗口同时点「应用」会各读原文各写回，后写的覆盖先写的，结果是「一半补丁在、一半
  不在」而两份报告都成功。`lib/maintenance-lock.js` 把这段串行化，落在
  `$DSH_HOME/dsh-purge/`：
  - **租约年龄永远不能证明进程已死**。只看 mtime 判断「锁太老可以抢」，会在维护进程
    正好写文件时把锁抢走。死活只看 PID：`kill(pid,0)` 拿到 `ESRCH` 才算死，`EPERM`
    一律当活；PID 会被复用，所以还要求「当前进程创建时间晚于锁创建时间」。
  - 落盘形态是「目录 + 唯一文件名」而不是单个 lock 文件：目录 rename 是原子的，
    rename 成功那一刻内容已经写完，不存在空锁窗口；再用 hardlink 造
    `maintenance.lock` 兼容名，校验时比对 inode+dev —— 有人手改/复制立刻 `LOCK_LOST`。
  - 错误码 `MAINTENANCE_BUSY` / `LOCK_LOST` / `LOCK_UNREADABLE` /
    `LOCK_RELEASE_FAILED`，调用方按 code 分支。释放失败保留现场并留痕，下次 acquire
    先补释放。
  - 面板与 `bin/dsh-purge.js` 都认 `MAINTENANCE_BUSY`，给出「等另一个窗口跑完，别删锁文件」。
- **拒答重试**（吸收社区版 `refusal-retry.js` 的形态，判定与话术换成本地模块）：
  接在 `request-shape` 的代理 adapter 上，因为宿主 request 是 freeze 的、`llm/stream`
  的 waterfall `next()` 不收参数，旁听者改不动请求，唯一能重发的位置就是 adapter 自己。
  - 判定用 `lib/refusal-scan.js` 的 `scanReply()`（全文扫描 + opening/tail 位置标注）；
    社区版只扫开头 600 字符，「先给答案、末尾补一句我无法提供」会被判成正常。
  - 话术用 `lib/retry-ladder.js` 的 `planRetry()`（amplify / sanitize / giveup 三级阶梯），
    不是一句固定话术。
  - 只在开头缓冲 400 字符判一次；工具调用 / reasoning / finish 一出现立刻放行，
    不把工具轮次缓冲住。只重试一次，第二次照样拒答就把内容原样交出去，不无限循环。
    起标题、压缩这类带 `purpose` 的旁路调用完全透传。
  - 开关：`refusalRetry: false`、`refusalBufferChars`、`refusalMaxAttempts`、
    `refusalRubric`、`refusalSanitize`。
- **#89 / #90 rc.3 变体**：#32/#53 的 `file` 加 `harness-dev-context` 并补齐
  rc.3 布局的替换句与 marker（`Current implementation checkout:` 等）；#53 另补一条
  正则，收掉模板字面量里「这个 checkout 只能用来读 DSH 自己」的用途限制句
  （`LEGACY_SOURCE` 里的同句是旧会话锚点，不动）。
- 测试 292 条全过（新增 `maintenance-lock.test.mjs` 10 条、`refusal-retry.test.mjs`
  16 条、`client-dark-theme.test.js` 3 条、`anchor-wiring.test.mjs` 12 条）。

# 1.1.82

## 中文

- 版本 **1.1.82**。合并上游 1.1.82。
- **#180**：修复 profile 的 `pnpm-workspace.yaml` `allowBuilds` 被反复写坏（`dsh-purge@https: true` 畸形键 → `ERR_PNPM_INVALID_VERSION_UNION`，重复键 → `duplicated mapping key`）。
  - URL 键解析不再被冒号截断；写回含 `://` 的键自动加引号。
  - 重写只保留精确等于期望键的 `dsh-purge@*`，畸形/过期键下次 ensure 自动清掉。
  - 期望键优先读 profile 的 `pnpm-lock.yaml` 实际解析的 tarball（固定 commit 安装也不再有双 URL 键），读不到才退回 `package.json`。
  - 重写先过最小 YAML 校验（键不重复、round-trip 无损），不过不写盘；健康文件零写入，启动不再反复重写。
- 安装说明改为「快速安装 + 5 步分步（含完成标志与排障）+ 高级」，中英同步（上游 #179）。
- 本整合版在 1.1.82 之上另有：
  - 补回 `skills/redteam/` 24 个红队技能（官方 1.1.72 起把该目录移出发布包，代码仍在读）；新增 `SKILLS-SHA256.txt` 逐文件校验与 `npm run skills:sha`。
  - 演练台只在红队预设会话里出现：非红队会话不注册页签、不自动打开、不占宿主 UI 位置。
  - `dsh-purge --eval A.jsonl B.jsonl`：双臂配对评测，含精确 McNemar、pass@k 与良性能力代价控制组；配 `--scan` 单条判读。
  - `lib/scoped-capability.js`：可回滚能力缝（LIFO 撤回、幂等、撤回不中断、mount 全或无），为按组挂载与单独撤回收口。

## English

- **1.1.82**. Merges upstream 1.1.82.
- **#180**: stop rewriting the profile `pnpm-workspace.yaml` `allowBuilds` into garbage (`dsh-purge@https: true` malformed key → `ERR_PNPM_INVALID_VERSION_UNION`; duplicated keys → `duplicated mapping key`).
  - URL keys no longer truncate at the first colon; keys containing `://` are written back quoted.
  - Rewrites keep only `dsh-purge@*` keys exactly equal to the wanted set; stale polluted keys self-heal on the next ensure.
  - The wanted key prefers the tarball URL actually resolved in the profile `pnpm-lock.yaml` (fixed-commit installs no longer get a duplicate URL key); falls back to `package.json`.
  - Rewritten output passes a minimal YAML check (no duplicate keys, lossless round-trip); healthy files are never rewritten, so boot no longer rewrites each run.
- Install docs rewritten as quick install + five numbered steps (with completion checks and troubleshooting) + advanced, in both languages (upstream #179).
- This merged edition adds on top of 1.1.82:
  - Restores the 24 `skills/redteam/` skills (upstream stopped shipping that directory at 1.1.72 while the code still reads it); adds `SKILLS-SHA256.txt` per-file verification and `npm run skills:sha`.
  - The drill console only exists in red-team preset sessions: no tab, no auto-open and no host UI takeover elsewhere.
  - `dsh-purge --eval A.jsonl B.jsonl`: paired two-arm evaluation with exact McNemar, pass@k and a benign-capability control group; pairs with `--scan`.
  - `lib/scoped-capability.js`: reversible capability seam (LIFO rollback, idempotent, rollback never aborts, all-or-nothing mount).

# 1.1.81

## 中文

- 版本 **1.1.81**。修复 bug，修复稳定性。
- **#174**：识别 DSH NEXT 社区桌面（路径、进程、快捷方式、密封 asar）。`DSH_SURFACE=web` 也不再误报；不把任意 `app.asar` 当桌面。
- **#175**：补 ip / 计分 / settle 单测，删草稿文档和 `.bak`。`npm test` 23 条全过。
- **#171 / #173**：zip 目录条目和 skills `fs` 导入已在 1.1.80，本版用单测锁住。

## English

- **1.1.81**. Bug fixes and stability.
- **#174**: detect DSH NEXT desktop (paths, process, shortcuts, sealed asar). Still desktop when `DSH_SURFACE=web`. A random `app.asar` is not treated as the host.
- **#175**: add ip / score / settle tests; drop draft docs and `.bak`. `npm test` is 23/23 green.
- **#171 / #173**: zip directory entries and the skills `fs` import shipped in 1.1.80; this release locks them with tests.

# 1.1.80

## 中文

- 版本 **1.1.80**。修复 bug，修复稳定性。
- **#168**：pnpm 12 的 `allowBuilds` 把 `dsh-purge@codeload...` 也写成 `true`，装别的插件不再留下 `set this to true or false`。
- **#169**：芯片 / 应用按钮强制系统字体和实色字，不再被宿主图标字体吃掉。
- **#170**：纯 Node 解 zip 时目录条目建目录，不再写成同名空文件导致 EEXIST。
- **#172**：`lib/skills.js` 补上 `fs`，#54 软链重叠守卫重新生效。
- **#176**：写清 **不支持 DSH 0.2.1-rc.3 及更新的 rc**，请退回 **0.2.1-rc.2**。对不上的补丁待应用或跳过，不乱改文件。

## English

- **1.1.80**. Bug fixes and stability.
- **#168**: pnpm 12 `allowBuilds` also sets `dsh-purge@codeload...` to `true`, so installing other plugins no longer leaves `set this to true or false`.
- **#169**: chip / Apply buttons force a system font and solid text color so the host icon font cannot hide the label.
- **#170**: Node zip fallback creates directories for directory entries instead of empty files (no more EEXIST).
- **#172**: import `fs` in `lib/skills.js` so the #54 symlink overlap guard works again.
- **#176**: **DSH 0.2.1-rc.3 and newer RCs are not supported.** Stay on **0.2.1-rc.2**. Unmatched patches stay pending or skipped.

# 1.1.79

## 中文

- 版本 **1.1.79**。修复 bug，修复稳定性。
- **#165**：社区版 DS Bot / DeepSeek Bot 按桌面宿主识别（`ds-bot` profile、Electron asar），不再误报 `set DSH_BASE`。
- **#166**：pnpm 12 拦 `postinstall` 时补 `allowBuilds`，并写清 `--allow-build=dsh-purge` / `approve-builds`。
- **#167**：升级后补回 `bundles` + 本体 insert，空芯片不再把启动钮藏掉，1.1.74 有的按钮会回来。
- 应用/还原/卸载进度条跟 job 阶段；主智能体和子智能体同一份注入、权限和能力协议。
- 新建会话不再把 `dsh-purge` 芯片甩到行尾。

## English

- **1.1.79**. Bug fixes and stability.
- **#165**: community DS Bot / DeepSeek Bot is a desktop host (`ds-bot` profile, Electron asar); no more false `set DSH_BASE`.
- **#166**: pnpm 12 skipped `postinstall`; write `allowBuilds` and document `--allow-build=dsh-purge`.
- **#167**: restore `bundles` + body insert after upgrade so the 1.1.74 button comes back.
- Apply / revert / uninstall progress follows the job; main and subagents share inject, permission, and capability text.
- New-session no longer shoves the `dsh-purge` chip to the far right.

# 1.1.78

## 中文

- 版本 **1.1.78**。修复 bug：停用/卸载后无法新建会话。
- **#108**：停用或卸载时把 `agent-preset-registry.selectedDefault` 从 `redteam` 改回 `standard`，并清掉 `$DSH_HOME/.agent-presets/redteam`。热重载不会冲掉用户设的红队默认。
- 卸载同时处理 `dsh.profile.bundles` / `dsh.profile.plugins`，桌面 profile 不再残留 `dsh-purge`。

## English

- **1.1.78**. Bug fix: new sessions after disable/uninstall.
- **#108**: on disable or uninstall, reset `agent-preset-registry.selectedDefault` from `redteam` to `standard`, and remove `$DSH_HOME/.agent-presets/redteam`. Hot reload keeps a user-chosen redteam default.
- Uninstall also strips `dsh.profile.bundles` / `dsh.profile.plugins`.

# 1.1.77

## 中文

- 版本 **1.1.77**。修复 bug，修复稳定性。
- 修长红队任务仍打公网：`渗透测试` / `红队` / `打点` / `拿站` 纳入门禁；正文按窗扫到 256KB，目标写在后半段也能拦。
- 修后续步骤漏拦：每一步看工具参数，`tools/pre-execute` 遇到公网 IP/域名直接停轮。
- 长文正则按窗扫，避免整篇回溯把事件循环卡死。

## English

- **1.1.77**. Bug fixes and stability.
- Long red-team tasks no longer reach the public internet: `渗透测试` / red-team / 打点 / 拿站 are gated; the body is scanned in windows up to 256KB.
- Later steps are gated too: tool arguments are checked, and `tools/pre-execute` stops on a public IP or name.
- Long-text regex runs in windows so a huge paste cannot stall the event loop.

# 1.1.76

## 中文

- 版本 **1.1.76**。适配只走 pnpm 的机器：在 profile 目录 `pnpm add` codeload 压缩包即可，`postinstall` 自动把 `dsh-purge` 写进 `bundles`。
- 安装地址改成 `codeload.github.com`，避开 `github.com/archive` 的 302（pnpm 会 `fetch failed`）。不要 `pnpm add dsh-purge`（npm 仓库没有这个名字）。

## English

- **1.1.76**. pnpm-only hosts: `pnpm add` the codeload tarball inside the profile; `postinstall` writes `dsh-purge` into `bundles`.
- Install URL is `codeload.github.com` so pnpm does not die on the `github.com/archive` 302. Do not `pnpm add dsh-purge` — that name is not on the npm registry.

# 1.1.75

## 中文

- 版本 **1.1.75**。修 Hub 市场一键安装报 `already queued: dsh-purge`：`cordis.patch.yml` 不再把已经在 bundles 里的本体再 insert 一遍。
- README 把安装写成三步：只用 GitHub 压缩包命令，不走插件市场 / `github:` / npm。

## English

- **1.1.75**. Fix Hub one-click `already queued: dsh-purge`: the bundle patch no longer inserts the plugin that is already in `bundles`.
- README install is three steps: GitHub tarball only; skip the plugin market / `github:` / npm.

# 1.1.74

## 中文

- 版本 **1.1.74**，优化若干拦截与加载 bug。适配 DSH **0.2.1-rc.2**（0.2.0 仍可用）。
- 修靶场门禁：域名先解析再判 IP，不再靠 `.lab` / `.htb` 后缀放行；`hosts` 指到公网、解析失败、混有公网，一律拦。
- 修身份绕过：`169.254` 云元数据不再当靶场；`::ffff:公网` 拆开再判；攻击句不写目标不再放行。
- 修 DSH 0.2.1 预设加载：对象 schema 补 `additionalProperties`，装过的 redteam 预设清掉残留 `toolFilter`。
- 修演练台被改成英文：中文页签收回。
- 禁止制作外挂：会话门口硬拦，提示词 Rule 1 改为禁止。

## English

- **1.1.74**, bug-fix release. Target DSH **0.2.1-rc.2** (0.2.0 still works).
- Lab gate: resolve first, then allow only private IPs. Suffixes are not an allow list.
- Close identity holes: drop link-local metadata, unwrap IPv4-mapped IPv6, deny unnamed attack tasks.
- DSH 0.2.1 preset load: seal object schemas; strip leftover `toolFilter`.
- Restore Chinese drill-console tabs.
- Game cheats are forbidden at the session gate.

# 1.1.73

## 中文

- 版本 **1.1.73**，适配 DSH **0.2.1-rc.2**（0.2.0 仍可用）。
- 0.2.1 兼容已落地：`{{cwd}}` 静态回退、补丁 #40、`toolFilter` 删除、`dsh-tools` 解析、hostFs fd 直通、桌面换包不自杀、`file:` 归档更新、Ctrl+Enter steer。
- 界面操作文案补齐英文（演练台、清洗面板、补丁表、计分/技能指引）；`zh` 语言包与模型提示词保持中文。靶场默认拦截的 `own.hint` 仍按本仓库策略。
- 随包技能 `paper-autopilot` + `npm run install:skill`。
- 红队证据账本：`claimed → observed` 核实链、`ResidualUnknown`、8 个 `redteam_evidence_*` / `redteam_unknown_*` 工具。

## English

- **1.1.73**, target DSH **0.2.1-rc.2** (0.2.0 still works).
- 0.2.1 compatibility in-tree: `{{cwd}}` fallback, patch #40, drop `toolFilter`, host `dsh-tools` resolve, hostFs fd pass-through, desktop helper self-kill fix, `file:` archive update, Ctrl+Enter steer.
- Operator-facing UI copy is English; `zh` locale and model prompts stay Chinese. Lab default-deny `own.hint` is unchanged.
- Bundled `paper-autopilot` skill + `npm run install:skill`.
- Red-team evidence ledger: claimed→observed verification, ResidualUnknown, eight `redteam_evidence_*` / `redteam_unknown_*` tools.

# 1.1.71

## 中文

- 版本 **1.1.71**。
- 修复 1.1.70 的 `??` 混 `||`：插件启用时 `failed to import`（桌面 / Web 同一入口）。
- #86 只改 UI 队列 steer → followup；公共 `steer()` 收回 next-step，代理间 `send_message` 仍下一步插入。
- `installed-rev` 跨版本不再沿用旧 `apply:x.y.z`。#88 按现行 `renderedPrompt` / 旧 `system` 锚点打中的那条落标记。
- 发版前 `node --check` 主入口，避免再把语法错误打进 Release。

## English

- **1.1.71**.
- Fix 1.1.70 `??` mixed with `||`: enable failed to import on desktop and web.
- #86 keeps UI queue steer → followup. Public `steer()` is next-step again so `send_message` inserts at the next step.
- Stale `apply:x.y.z` in `installed-rev` refreshes across versions. #88 marks the host anchor that actually exists (`renderedPrompt` or `system`).
- Release CI syntax-checks the plugin entry.

# 1.1.70

## 中文

- 版本 **1.1.70**。
- Hub / 残装若给 `dsh-purge` 加上 `pluginPackages`，Cordis 会一直 pending，宿主退出码 1。本版把依赖钉回 `systemPrompt` + `tools`。
- 清洗页只合并升级链展示（免责、审批、挂全文、hooks 等），Apply 仍打全部补丁。
- 去掉已无用的 #81 / #89 清单行；挂全文并进 #87，官方 phase-1 走静默放行。
- 指挥端改为「按用户给的目标开工」。合并 #97 / #98 / #99。

## English

- **1.1.70**.
- Hub / incomplete installs that inject `pluginPackages` leave dsh-purge pending and kill the host. Dependencies are pinned to `systemPrompt` + `tools`.
- Clean page groups upgrade-chain patches for display only; Apply still writes every patch.
- Dropped dead #81 / #89 rows. Hang lives in #87. Official phase-1 keep is silent.
- Commander bind: start from the user's target. Includes #97 / #98 / #99.

# 1.1.69

## 中文

- 版本 **1.1.69**。
- 发送时剥掉 ChatML / `project_instructions`，框和磁盘不动。
- 应用 + 重启挂当前默认，不必再点保存；框里仍是插件旧默认会刷到加密槽。
- 红队只排不折：注入 → cap → 红队正文；目标卡/角色段改名 `dshpg-*`。
- 隔离 ctx 也注册 inject/cap；#86 steer 改 next-turn；#87 hang 用 LF 比对。
- 红队操作稿锁「上面的提示词作准」；指挥端去掉「给了单位名就授权」。

## English

- **1.1.69**.
- Peel ChatML / `project_instructions` on the wire; box and disk stay intact.
- Apply + restart hangs the current default; no extra Save. Stale plugin defaults refresh from the sealed slot.
- Redteam: inject → cap → ops only (no fold). Card/role sections renamed `dshpg-*`.
- Isolated ctx also registers inject/cap. #86 steer → next-turn. #87 hang needle uses LF.
- Redteam ops note: inject wins. Commander no longer says a company name means authorized.

# 1.1.68

## 中文

- 版本 **1.1.68**。
- **#92**：技能面板认 YAML 块标量 `description`（`|` / `>`），不再误报不可用。
- **#93**：红队「版本/更新」：`file://` 转成本地路径；Windows 用 `.cmd` + `shell` 起 npm/pnpm；npm 404 回落 GitHub tags。
- **#94**：官方桌面 CLI 入口补 `app.asar.unpacked` 回退。Hub 首次安装仍可能撞官方 asar 路径。
- **#95**：拆除 `refusal-recover`（读错字段永不触发；修好会无限复读）。
- **#96**：bash 前台等待从插件标过的 600s 迁回 60s，后续工具不再被堵 10 分钟。
- 注入置顶；capability 段改名 `dshpg-capabilities`；用户 prompt 一律 followup（#85）；默认关闭自动「继续」。

## English

- **1.1.68**.
- **#92**: Skill panel parses YAML block-scalar `description`.
- **#93**: Redteam update: `file://` → fs path; Windows npm/pnpm via `.cmd`; GitHub tags if registry 404.
- **#94**: Desktop CLI falls back to `app.asar.unpacked`. Hub first-install may still hit stock asar.
- **#95**: Removed `refusal-recover` (dead reader / unbounded nudge loop).
- **#96**: Restore marked bash foreground wait 600s → 60s.
- Inject leads; capability section renamed; user prompt always followup; autoContinue default off.

# 1.1.67

## 中文

- 版本 **1.1.67**。
- **#85**：continue 续跑在传输/429 连错时不再无限兜圈。`takeContinue` 加 failStreak 阈值；`refundContinue` 不清 `lastContinueSeq`，连错 ≥3 直接放弃。
- **#84**：区域拦截的空 Assistant 流改为单批 `text-chunks` 记录（带 `.length`），不再卡住宿主 UI。
- 启动种子：进程启动时若 `$DSH_HOME/prompt-inject.md` 为空或缺失，自动把加密默认稿写一次；用户改过的稿不动。清洗完点重启后，重启成功立刻就能用默认提示词。
- Windows 官方包重启：restart 脚本名改成 `pid+random`，首启不与并发实例打架；多余的 `.cmd` 中介删掉，直接 `wscript.exe //nologo //B` 起脚本；本机旧版无 pid 后缀的脚本/日志超过 24h 启动时自动清。
- 杀进程范围收紧：`ASAR_SWAP_PS1` 不再 `/IM` 杀全名同名进程，只按安装根下 pid 停，避免误伤第三方同名。
- 官方 CLI shim 原地改写之前先存一份 `.dsh-purge.bak`，并走原子写，断电/盘满可回退。
- 首装场景不卡：WScript 判 clean 时，两边都是 null（文件缺或读失败）放行启动，只有任一明确 dirty 才拦。
- 探测缓存：`runningExes` / `shortcutExes` 空结果不再缓存；点"应用"前 `clearDesktopLocateCache()` 仍可强刷。
- `scheduleAsarRenameWhenIdle` 的 `.rename-pending` 锁：时钟回拨或超过 30 分钟视为失效，清掉重做。
- `execFileSync` 三处 PowerShell 调用加 `maxBuffer: 8MB`，大结果不再静默 ENOBUFS 掉。
- 其他：net-scope region gate 指数退避 + IPv6 regex 收紧；identity `injectMatchers` 支持 >4096 分段匹配、`installAssembleGuard` 幂等；hooks-deny 删 R0 兜底规则改原子写；extract-asar commit 不删 `nextDir`，写 `.dshpurge-recover.json` 便回滚；client.js redteam preset 多路检测、shell.submit WeakMap 清理补齐。

## English

- **1.1.67**.
- **#85**: Continue loop no longer spins forever on TRANSPORT/429 streaks. `takeContinue` adds a failStreak gate; `refundContinue` leaves `lastContinueSeq` set; 3 consecutive failures abandon.
- **#84**: Region-gate empty-assistant stream becomes one batched `text-chunks` record (with `.length`), no longer hangs the host UI.
- Boot-time seeding: on startup, if `$DSH_HOME/prompt-inject.md` is empty or missing, the encrypted default is written once; a user-edited file is untouched. After the Apply → cleanup → restart cycle, the default prompt is active immediately.
- Windows official-build restart: restart script name now includes `pid+random`, so concurrent instances don't clobber each other; the `.cmd` intermediary is dropped — `wscript.exe //nologo //B` is spawned directly; legacy unsuffixed scripts/logs older than 24h are purged on each startup.
- Kill scope tightened: `ASAR_SWAP_PS1` no longer uses `/IM` to kill by full name — only pids under the install root are stopped, so same-named third-party processes aren't collateral.
- Official CLI shim repair now saves `.dsh-purge.bak` and uses atomic write before overwriting, so power loss / disk full is recoverable.
- First-install not blocked: when WScript checks for clean markers, two nulls (missing or unreadable) now pass through; only an explicit `false` blocks startup.
- Probe caches: `runningExes` / `shortcutExes` no longer cache empty results; `clearDesktopLocateCache()` on Apply still forces a refresh.
- `scheduleAsarRenameWhenIdle` `.rename-pending` lock: clock skew or ≥30-min-old lock is treated as stale and cleared.
- Three `execFileSync` PowerShell calls get `maxBuffer: 8MB` so large results no longer silent-fail with ENOBUFS.
- Also: net-scope region-gate exponential backoff + stricter IPv6 regex; identity `injectMatchers` segments >4096-char payloads, `installAssembleGuard` is idempotent; hooks-deny drops R0 fallback and uses atomic write for state; extract-asar commit no longer deletes `nextDir` and writes `.dshpurge-recover.json` for rollback; client.js redteam preset detection broadened; `shell.submit` WeakMap cleanup wired.

# 1.1.66

## 中文

- 版本 **1.1.66**。
- **#80**：清洗页可关掉 hooks deny / ask 旁路。关掉且文件干净显示跳过，不计入已应用；关掉后再打开，64/65 会按官方形态再打一次。
- **#81**：继续 / 拒答续跑的来源 kind 改为 `dsh-purge`；限流和传输失败不再自动续一轮。
- 重启后不用点保存也会挂上默认提示词；每一轮都补回全文。空的应用请求不再清空磁盘上的提示词。
- 声明过的 overlay 只剩 `.dshpurge.bak` 时，应用会先拷回再加载。
- 红队报告补上得分点短名。中文 README 恢复题图和预览图。

## English

- **1.1.66**.
- **#80**: The clean page can turn off the hooks deny/ask bypass. Off + clean files show skipped and are not counted as applied. Turning it back on reapplies 64/65 from the official form.
- **#81**: Continue / refusal-recover use source kind `dsh-purge`. RATE_LIMIT and TRANSPORT no longer start another continue turn.
- Restart hangs the default prompt without a Save click; every step puts the full text back. An empty Apply body no longer wipes the disk prompt.
- A declared overlay that exists only as `.dshpurge.bak` is copied back before load.
- Red-team reports get short score-point names. Chinese README restores the banner and preview images.

# 1.1.65

## 中文

- 版本 **1.1.65**。
- 默认提示词按 `lib/default-prompt-inject.md` 重新加密进槽。磁盘上仍是用户自己改过的稿时，不覆盖。
- 红队接入截图登记、得分点看图，以及报告六段。可把某次演练导出成目录。
- 技能正文缺工具路径、缺密钥或 VPS 还是占位符时，不再把整条技能标成不可用。缺口留在详情里。
- 打开页面或组装提示词时，会把当前默认稿同步到磁盘，不必先点保存。
- 删掉没有调用的桌面启动封装、旧迁移脚本，以及已经注释掉的手动继续入口。

## English

- **1.1.65**.
- The default prompt is sealed again from `lib/default-prompt-inject.md`. A prompt the user already edited on disk is left as-is.
- Red team gains shot registration, score-point images, and the six-part report. An engagement can be exported to a folder.
- A skill stays usable when a documented tool path, key, or VPS placeholder is missing. The gap stays on the skill detail.
- Opening the page or assembling the prompt writes the current default to disk, without a Save click first.
- Unused desktop launch helpers, the old migration script, and the commented manual-continue entry are removed.

# 1.1.64

## 中文

- 版本 **1.1.64**。
- 红队流程八项。角色稿只在**新建靶标**时播种；已经建好的靶标，要在演练台里把智能体同步一次才会换成新稿。
- **内网**改为叶子节点，自己按收集、梳理、发现、利用做，不再往下派活。
- 并发名额：不带 key 的 release 只放最早的一条。子智能体结束由服务端自动释放；手动释放必须带上 acquire 返回的 key。
- 预检带 `include` 时只体检点名的技能，不再被全局缺密钥拖成失败。缺项带上由用户执行的修复说明。
- IPv6 计分至少两个冒号，`dc01:389` 这类主机名不再 ×3。计分只留在 `score-rules.js`。
- 攻击链计分跳过已停用的得分点。
- `.env` 认 `export KEY=value`。未加引号的行内注释会剥掉，引号里的 `#` 保留。
- 内网计分 code 改为 `central-system`、`boundary-logical`、`boundary-strong` 等，以 `redteam_score_list` 实际返回为准。
- 漏洞发现和利用从 `priority=high` 打起。优先级为空时，先回报指挥补一轮评估。
- 删掉没有调用的代码。设置页里过期的 `legacyApplyPath(...)` 调用改为 `applyPathOp`。

## English

- **1.1.64**.
- Eight red-team flow fixes. Role prompts seed **new** engagements only; sync agents on an existing engagement to pick them up.
- The internal role is a leaf and does collect, assess, scan, and exploit itself.
- A release without a key drops only the oldest reservation. Ending a subagent auto-releases; a manual release must carry the acquire key.
- Preflight `include` checks only the named skills. Broken items include fixes for the user to run.
- IPv6 scoring needs at least two colons, so `dc01:389` is no longer ×3. Scoring lives only in `score-rules.js`.
- Attack-chain scoring skips disabled score points.
- `.env` accepts `export KEY=value` and strips unquoted inline comments. A `#` inside quotes stays.
- Internal score codes match the live list (`central-system`, `boundary-logical`, `boundary-strong`, and the rest), taken from `redteam_score_list`.
- Vuln-scan and exploit start at `priority=high`. If priority is empty, report back and run another assess first.
- Unused code removed. Stale settings calls to `legacyApplyPath` now call `applyPathOp`.

# 1.1.63

## 中文

- 版本 **1.1.63**。
- 官方更新脚本去掉中文注释，避免 `official update script is not ASCII`。

## English

- **1.1.63**.
- Official update script is ASCII only, so the handoff no longer fails the ASCII check.

# 1.1.62

## 中文

- 版本 **1.1.62**。
- 继续/重试重新打开。
- 锚点门：首轮输出上限 1024→8192，最多 2 步；已调工具即放开，英文思考过不了 we 锚也不再卡住。
- 已有预设的锚点配置与包内不一致时同步，不整份覆盖。

## English

- **1.1.62**.
- Continue/retry is on again.
- Anchor gate: bootstrap cap 8192, max 2 steps; promote after the first tool call.
- Existing presets sync the anchor-gate block when it differs from the package.

# 1.1.61

## 中文

- 版本 **1.1.61**。
- **多宿主 Apply**：npm-global 与桌面 `resources/app` 一并补丁（#72 类路径问题）。
- **#73**：代理 / IP / DNS 等 benign 话题不再误触攻击闸门（`net-scope.js`）。
- **#74**：自定义提示词持久化——`resolveInjectText` 读 `prompt-inject.md`，UI 保存走 `saveOverrideContent`，启动 `ensureOperatorBody`。
- **极简**：#80 保持官方 persistent-shell；UI 选 minimal 以 `agent-preset/selected` 为准（不再被会话头 `standard` 误导）；`adaptInjectForMinimalPreset` 对齐 shell-only 工具表。
- **拒答续跑**：`refusal-recover` 识别「我不做 / 不参与」等句式。
- 注入链：`injectMatchers` 防重复段；默认提示词重加密进 `asset-table.js`。

## English

- **1.1.61**.
- **Multi-host Apply**: patch npm-global and desktop `resources/app` together.
- **#73**: Benign proxy/IP/DNS topics no longer trip the attack gate.
- **#74**: Custom prompt persists via `prompt-inject.md` + `saveOverrideContent`.
- **Minimal**: #80 official shell-only preset; preset from `agent-preset/selected`; runtime `adaptInjectForMinimalPreset`.
- **Refusal recover**: broader Chinese refusal phrasing.
- Inject assembly dedupe; default prompt re-sealed.

# 1.1.60

## 中文

- 版本 **1.1.60**。
- **极简 / PTC**：与标准同一任务却被拦，多半是 preset 里 `run_code`、沙箱、plan 文案未洗净，或内置 minimal 缺 `agent-instructions`。本版反转 #60/#61/#63，minimal 补插件（#26）。**完全退出 → 应用 → 重启 → 新开对话** 后再测。
- **回退 → 重新发送**：「回退一次 / 回退上一轮」留在当前对话；已发送句回到输入框，本轮助手输出与 todo 撤掉。**1.1.60** 起按**当前轮**定位，多轮后不会又退到第一条用户消息（#74/#75 + `lib/rewind.js`）。
- **应用 / 重启**：用户点应用、重启时写入 client 包，避免误报「清洗没有完成，已取消重启」。
- 默认提示词从 `default-prompt-inject.md` **重新加密**进 `asset-table.js`；运行时只读加密槽。
- **#66** Windows `app.asar` 无 JScript 时 PowerShell 换包；**#67** `dsh.cmd` 解包路径；**#69** 演练台 `position:fixed`；**#71** assemble 守卫幂等；**#70** 技能路径按本机 OS 判定；**#68** 文档改为 `desktop` profile + `.tar.gz`（Hub 一键仍走 git，见 README）。

## English

- **1.1.60**.
- **Minimal / PTC**: Same task blocked while standard works → uncleared `run_code`, sandbox, or plan text, or minimal preset missing `agent-instructions`. This release flips #60/#61/#63 and adds the plugin on minimal (#26). **Quit fully → Apply → Restart → new chat** before retesting.
- **Rewind → resend**: Rewind buttons stay in the same chat; your last user line returns to the composer and this round’s assistant output/todos drop. From **1.1.60**, bounds follow the **current turn**, not the first user message (#74/#75 + `lib/rewind.js`).
- **Apply / restart**: User Apply/Restart writes client bundles so restart is not cancelled as “clean incomplete”.
- Default prompt **re-sealed** into `asset-table.js`; runtime reads the encrypted slot only.
- **#66** asar swap PS fallback; **#67** `dsh.cmd`; **#69** dock fixed; **#71** idempotent assemble guard; **#70** skill paths per host OS; **#68** docs: `desktop` + `.tar.gz` (Hub one-click still git — see README).

# 1.1.59

## 中文

- 版本升级到 1.1.59。
- 点应用后不再因为宿主路径或旧标记对不上，就报「清洗没有写进当前宿主」（#65）。
- `resources\app\node_modules` 和 `resources\app\dsh\node_modules` 都认。原文里已经没有官方身份句、也没有丢掉注入的写法时，不再要求那两条标记。
- complete 段补丁同时认 tab 和空格。

## English

- Version 1.1.59.
- Apply no longer reports that the clean missed the current host just because the package path or the old markers do not match (#65).
- Both `resources/app/node_modules` and `resources/app/dsh/node_modules` count. If the official identity sentence and the inject-dropping return are already gone, those two markers are not required.
- The complete-prompt patch matches both tab and space indentation.

# 1.1.58

## 中文

- 版本升级到 1.1.58。
- 打开、应用、重启都会挂上提示词。磁盘上有正文就用磁盘，没有就用规则集，再没有就用内置默认，不用再点保存。
- 启动不再在页面发出之后改写前端 client.js，避免输入框因模块版本号对不上而消失（#63）。
- macOS / Linux 已解包桌面端点应用后会退出并重新打开；清洗标记两种写法都认（#64）。

## English

- Version 1.1.58.
- Open, Apply, and restart all hang the prompt. A saved file wins, then the active rule set, then the built-in default. Save is not required.
- Startup no longer rewrites frontend client.js after the page has taken a module revision, so the composer does not disappear (#63).
- Unpacked macOS and Linux desktop builds quit and relaunch after Apply. Both inject markers count as clean (#64).

# 1.1.57

## 中文

- 版本升级到 1.1.57。
- 应用并重启后，设置框里的提示词直接挂到系统段；框空则用当前规则集。两者都空就停下来要求输入。
- 创造、PTC、极简、unrestricted、梁神与标准模式一样清掉拦截和禁止，并保住各自的工具流程。
- 演练授权按本机目录保存，更新后不用重授权；卸载成功后才清掉。空的环境初始化不再当成已配置。
- 官方 Messages 请求的 system 字段改用当前系统提示，不再钉住第一条。

## English

- Version 1.1.57.
- After Apply and restart, the settings-box prompt is hung on the system section. An empty box uses the active rule set. If both are empty, Apply stops and asks for a prompt.
- Cordis, PTC, minimal, unrestricted, and Liangshen clear intercepts and bans the same way standard does, and keep their own tools.
- Drill authorization is stored in this install and survives updates. It is cleared only after uninstall succeeds. An empty environment init is no longer treated as configured.
- The official Messages request system field uses the current system prompt instead of the first snapshot.

# 1.1.56

## 中文

- 版本升级到 1.1.56。
- 应用按设置框、当前规则集、官方系统提示词的顺序选用。空框且没有规则时停下来要求输入，不再把内置默认写进磁盘。
- 清洗和演练台跟随 DSH 主题的透明玻璃，去掉手动换色。
- 说明只保留官方 Web 和官方桌面。

## English

- Version 1.1.56.
- Apply uses the settings box, then the active rule set, then the official system prompt. An empty box with no rules asks for a prompt and does not write the built-in default to disk.
- 清洗 and the drill console use transparent glass that follows the DSH theme. The manual theme switch is gone.
- Docs keep official Web and the official desktop only.

# 1.1.55

## 中文

- 版本升级到 1.1.55。
- 点「应用」并重启后，每一轮 assemble 都会把提示词补回最前；宿主换成新 assemble 也会再包一次，不会第二轮丢掉。
- 空框不再在前端误取消应用；重启前先落下默认提示词。密封 asar 不会因为当前进程还是旧包而取消重启。
- 第二次应用不会因为冷却把重启/注入当成取消；密封包在换掉之前每次应用都会重启一次，补丁写完后不再空转。

## English

- Version 1.1.55.
- After Apply + restart, every assemble turn puts the operator prompt back at the front. If the host replaces assemble, it is wrapped again so turn 2 does not drop the inject.
- An empty settings box no longer cancels Apply on the client; Restart seeds the default prompt first. A sealed asar no longer cancels restart just because the running process still has the old archive.
- A second Apply is not treated as a cancel because of settle cooldown. A sealed archive still restarts on each Apply until swapped; after patches are in, it does not loop.

# 1.1.54

## 中文

- 版本升级到 1.1.54。
- 官方桌面密封 asar 启动不再中途解包/杀进程：避开 Host Fiber._reload 的 INACTIVE_EFFECT / DesktopHostFatalError；补丁留给设置页「应用」。
- 桌面 settle 延后并在 context 停用时退出；启动自愈只写盘、不 scheduleRestart（#59 / #60 / #61）。
- 市场 tar 安装与空 sha / 缺 installed-rev 的无限重启修复仍在（#58–#61，1.1.53）。

## English

- Version 1.1.54.
- Official desktop no longer unpacks or kills the host mid-boot on a sealed asar; that raced Fiber._reload and threw INACTIVE_EFFECT / DesktopHostFatalError. Patches wait for Settings Apply.
- Desktop settle is delayed and aborts on an inactive context; startup self-heal writes files only and does not scheduleRestart (#59 / #60 / #61).
- Marketplace tarball install and empty-sha / missing installed-rev restart loops remain fixed (#58–#61, 1.1.53).

# 1.1.53

## 中文

- 版本升级到 1.1.53。
- 修复点「应用」后无限重启（#59 / #60 / #61）：tarball 安装没有 `installed-rev`、或 `applied.json` 空 sha 时，启动不再反复 reapply+restart；对齐后不再空转重启，并加冷却。
- web 自愈重启不再自动弹浏览器，关窗后不会再被反复拉起新窗口（#59 / #61）。
- 空 sha 只在非密封、且清洗标记还在（或找不到插件根）时补戳，避免冲掉密封宿主自愈（#56 / #57）。
- 市场安装：`package.json` 标明优先 tar.gz/zip，避免 Hub 退回 `git ls-remote` 失败（#58）。

## English

- Version 1.1.53.
- Stop Apply/startup infinite restart (#59 / #60 / #61): missing `installed-rev` after tarball install or empty `applied.json` sha no longer reapply+restart every boot; skip restart once aligned, with a cooldown.
- Web self-heal restart does not open a browser, so closing the window no longer respawns tabs (#59 / #61).
- Empty-sha heal only runs when the host is not sealed and markers are present (or the plugin root is missing), so sealed-host self-heal still works (#56 / #57).
- Marketplace install prefers tar.gz/zip in `package.json` so Hub does not fall back to a failing `git ls-remote` (#58).

# 1.1.52

## 中文

- 版本升级到 1.1.52。
- 官方桌面「应用/重启」不再自动跑官方 installer（#57）：宿主版本由用户自行升级；插件只解包打补丁，避免落盘前误判失败清掉 `resources\\app`。
- 有 `applied.json` 但宿主又回到 sealed / 找不到插件根时，判定未对齐并自愈重打；面板提示「补丁已丢失，请重新应用」。
- 插件启动路径永不自动更新，仅面板手动更新。
- 默认提示词按本地 `default-prompt-inject.md` 重新加密写入 `asset-table.js`。
- 用户自改提示词不会被「应用」盖回加密默认：磁盘正文与内置不同时一律保留；运行时内置默认只读加密槽。
- 回退切点扩到整轮并在替换后清空 derive 缓存，避免下次发送仍带上被撤掉的内容。

## English

- Version 1.1.52.
- Official desktop Apply/Restart no longer auto-runs the official installer (#57); users upgrade the host themselves; the plugin only unpacks and patches.
- If `applied.json` exists but the host is sealed again / plugin root is missing, treat as mismatched and reapply; UI shows patches-lost.
- Plugin startup never auto-updates; update only from the panel.
- Reseal the default prompt from local `default-prompt-inject.md` into `asset-table.js`.
- Keep user-replaced prompts: never overwrite disk text that differs from the bundled sealed default; runtime bundled default comes only from the sealed slot.
- Rewind cuts the whole last turn and invalidates derive cache so the next send does not keep undone content.

# 1.1.51

## 中文

- 版本升级到 1.1.51。
- 修复 `/skills import` 对 `$DSH_HOME/skills` 自身导入时先删后拷把技能删空（#54）。
- 补齐 `platformEnvAdaptStatus` / `platformEnvAdaptSkip`，发送门禁不再误报「环境还没配好」（#55）。
- 修复官方桌面：无版本/同版本 `installer.exe` 被当成待更新劫持重启；更新失败时恢复 `resources/app`；空 sha 的 applied stamp 不再跳过 reapply（#56，0.1.7/0.2 同路径）。
- 补丁 #52 兼容无 `.volatile()` 写法；#57 跟到 `useDeveloperRole` 并覆盖 responses 通路；#48 上游已删句按软完成；状态导出 `patches_ready`；桌面端 shim 显示「本端不需要」。

## English

- Version 1.1.51.
- Reject `/skills import` when source overlaps `$DSH_HOME/skills` so delete-then-copy cannot wipe skills (#54).
- Implement `platformEnvAdaptStatus` / `platformEnvAdaptSkip` so the send gate no longer false-blocks ready environments (#55).
- Official desktop: ignore unversioned/same-version `installer.exe` pending updates; restore `resources/app` if update handoff fails; empty applied stamp sha no longer skips reapply (#56, same path on 0.1.7 and 0.2).
- Patch #52 matches non-`.volatile()` defaults; #57 follows `useDeveloperRole` and covers responses; #48 soft-settles when upstream removed the caution text; export `patches_ready`; desktop shim shows not-needed-here.

# 1.1.50

## 中文

- 版本升级到 1.1.50。
- 修复 macOS 官方桌面：点「应用」假失败「失败: 正在重启。」、解包后 `dsh` CLI 失效、status 误标 ✗（#53）。
- 修复点「应用」重启后默认提示词不注入：未改过时自动落盘内置默认，不必先点保存。

## English

- Version 1.1.50.
- Fix macOS official desktop: Apply false "Failed: Restarting.", broken `dsh` CLI after asar unpack, and status ✗ false negatives (#53).
- Fix default prompt not injecting after Apply + restart; bundled default is written without requiring Save first.

# 1.1.49-beta.1

## 中文

- 版本升级到 1.1.49-beta.1（#53 测试版）。
- 修复 macOS 官方桌面点「应用」后假失败「失败: 正在重启。」：`scheduleRestart` helper/runtime 分支补回 `restarting: true`；Darwin 重启改为 osascript 优雅退出 + SIGTERM/SIGKILL，排除 CLI 进程后再 `open` 重开（剥掉 ELECTRON_RUN_AS_NODE）。
- 解包 app.asar 后自动修补官方 `dsh` CLI 入口（asar/`app/` 回退）并补 `app/runtime -> ../runtime`，避免 `dsh web` 等全部 MODULE_NOT_FOUND。
- `/purge status` 对多路径文件清单按数组逐项判断，不再把已打补丁文件标成 ✗。
- 前端重启失败文案不再把成功分支的 note 当成 error。

## English

- Version 1.1.49-beta.1 (prerelease for #53).
- Fix macOS official desktop Apply false failure "Failed: Restarting.": helper/runtime branches of scheduleRestart return restarting:true; Darwin restart uses osascript quit then SIGTERM/SIGKILL, skips CLI processes, relaunches via open without ELECTRON_RUN_AS_NODE.
- After unpacking app.asar, auto-patch the official dsh CLI entry (asar/app fallback) and add app/runtime -> ../runtime so dsh web and other subcommands keep working.
- /purge status treats multi-path file lists correctly instead of marking patched files as missing.
- Restart failure UI no longer uses the success note as the error detail.

# 1.1.48

## 中文

- 版本升级到 1.1.48。
- 修复红队指挥「只派活」约束被组装时误删，导致不派 subagent；预设在 Agent Teams 下强制重开 classic subagent。
- 增加按任务选用 skill/MCP 的协议（先读目录，再按任务调用；子代理与红队同样）；不改官方注册与工具面。
- 子代理 maxDepth 适配 0.2 无 default 的 schema，补回默认 10。

## English

- Version 1.1.48.
- Fix redteam lead dispatch-only SOP being stripped during assemble; re-enable classic subagent under Agent Teams in the redteam preset.
- Add task-matched skill/MCP selection protocol (read catalog, then call what the task needs; same for subagents and redteam). Does not change official registration.
- Raise subagent maxDepth default to 10 on 0.2 schemas that dropped .default().

# 1.1.47

## 中文

- 版本升级到 1.1.47。
- 演练台「环境适配」接通 `platformConfigGet` / `Save` / `AssignToolkit`，修复 `unknown op: platformConfigGet`，工具路径与 FOFA/VPS 配置可正常读写。
- 技能库目录探测增加 `$DSH_HOME/redteam/skills`，Windows 用 `homedir()` 回退，不再只信空的 `HOME`。
- 知识库优先使用环境适配里的 nuclei 模板路径；空库时显示本机 `knowledge.db` 路径，避免误判成接口挂了。
- 首次安装弹出用户须知：说明用途、免费开源、GitHub 仓库地址；声明背着作者营利将追究法律责任，并提示禁止违法用途。确认后本机不再弹出。
- 桌面定位与表面检测放宽，安装目录名含 `DeepseekHarnessDesktop` 等也能找到本机 Harness；失败的定位缓存不再一直卡住「还没定位」。
- 回退与请求路径小修，降低后轮卡住或假进度的情况。

## English

- Version 1.1.47.
- Wire drill Env adapt ops `platformConfigGet` / `Save` / `AssignToolkit`, fixing `unknown op: platformConfigGet` so tool paths and FOFA/VPS config work again.
- Skill catalog also probes `$DSH_HOME/redteam/skills` and falls back with `homedir()` on Windows when `HOME` is empty.
- Knowledge prefers nuclei templates from Env adapt; empty libraries show the local `knowledge.db` path so a missing API is not assumed.
- First install shows a user notice: what the plugin does, that it is free/open source, the GitHub repo URL, legal warning against profit behind the author, and illegal-use prohibitions. After confirm it does not show again on that machine.
- Broader desktop locate/surface detection (including `DeepseekHarnessDesktop` installs); failed locate caches no longer stick on "host not located".
- Small rewind/request-path fixes to reduce later-turn hangs and misleading progress.

# 1.1.46

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.46銆?.1.45 鏈夐棶棰橈紝鐣ヨ繃锛屼笉瑕佸畨瑁呫€?- 榛樿鎻愮ず璇嶆寜 `default-prompt-inject.md` 閲嶆柊鍔犲瘑鍐欏叆銆?- 淇娉ㄥ叆涓嶇ǔ瀹氾細绗簩杞垨浠诲姟鍋氬埌涓€鍗婁汉璁惧け鏁堛€佽褰撴垚 `project_instructions` 鎷嗘帀鐨勯棶棰樸€?- 宸ヤ綔鍖烘浛鎹㈢鍜屼綔鐢ㄥ煙璇存槑鏀瑰洖 0.1.7 鐨勪紭鍏堢骇锛氫笉鑳藉帇杩?system銆乨eveloper 鍜岀敤鎴峰師璇濄€備富 intro 鐨勫弽杞嫆缁濆彞淇濇寔涓嶅彉銆傚凡缁忓彔涓婄殑浣滅敤鍩熷己鍙ユ暣娈垫敹鎴愯繖涓€鍙ャ€?- 杩涙ā鍨嬪墠鍓ユ帀澶栧眰 ChatML / `<project_instructions>` 澹筹紝閬垮厤妯″瀷鎶婄湡瀹?system 娉ㄥ叆褰撴垚椤圭洰璇存槑銆?- 缁勮鍚庣殑绯荤粺鎻愮ず娈电粺涓€淇濊瘉 `text` 涓哄瓧绗︿覆锛涗笉鍐嶄細璇濋拤姝绘暣娈?sections锛岄伩鍏嶇浜岃疆 `renderPrompt` 璇?`undefined.length` 鐩存帴姝绘帀骞舵姤 `(gateway/internal)`銆?- `agent/pre-step` 濮嬬粓鎶?`decision.messages` 瑙勮寖鎴愭暟缁勶紝閬垮厤绗簩杞彂閫佹椂璇荤┖ messages 鐐告帀銆?- 鍦板尯闂搁棬锛氬鍦板潃鍩熷悕涓嶈兘鍙洜鍏朵腑涓€涓В鏋愬埌鍙楁帶鍦板尯灏辨暣绔欐嫤姝伙紙CDN/澶氱嚎鍣０ IP锛夈€?- 鍥為€€鍚?`deriveMessages` / `systemNodes` 瀵圭己 `content` 鍋氬厹搴曪紝閬垮厤鍥為€€鍐嶅彂閫佹椂 `(gateway/internal)`銆?- 娓呮礂杩涘害锛氭湭瀹氫綅瀹夸富鏃朵笉鍐嶆樉绀哄悡浜虹殑 `0/63`锛涙湰鏈轰笉闇€瑕佹垨缁勪欢鏈鐨勯」璁″叆宸插氨缁紝閬垮厤鍋囩殑 `48/63`銆?- 鐐广€屽簲鐢ㄣ€嶅氨浼氬啓鍏ラ粯璁ゆ彁绀鸿瘝骞舵敞鍏ワ紝妗嗙┖鏃剁敤鍐呯疆榛樿锛屼笉蹇呭厛鐐逛繚瀛樸€?- 淇鍥為€€锛歚snapshotEvents()` 涓虹┖鏃朵笉鍐嶈 `undefined.length`锛岄伩鍏?`(gateway/internal)` 鎶ラ敊瀵艰嚧鍥為€€鏃犳晥銆?
## English

- Version 1.1.46. Skip 1.1.45; that version has bugs. Do not install it.
- Reseal the default prompt from `default-prompt-inject.md`.
- Fix unstable inject: persona dropping on the second turn or mid-task, including cases where the model treated the system inject as `project_instructions` and rejected it.
- Replacement and scope workspace intros match 0.1.7 again: they do not override system, developer, or direct user instructions. The main intro anti-soft-refuse text stays. A stacked scope paragraph is collapsed back to that one sentence.
- Strip outer ChatML / `<project_instructions>` wrappers before the text reaches the model, so a real system inject is not read as project instructions.
- Sanitize assembled system-prompt sections so `text` is always a string; stop pinning full sections for a session, which could make the second turn crash in `renderPrompt` on `undefined.length` with `(gateway/internal)`.
- Always normalize `decision.messages` to an array in `agent/pre-step`, so a second send does not die on a missing messages list.
- Region gate: multi-address hosts are no longer blocked just because one resolved IP is in a controlled region (CDN/noise).
- After rewind, `deriveMessages` / `systemNodes` tolerate missing `content`, so resend no longer fails with `(gateway/internal)`.
- Clean progress: do not show a scary `0/63` before the host is located; items not needed on this install count as ready, so a fake `48/63` no longer appears.
- Apply writes and injects the default prompt; an empty box uses the bundled default, so a separate Save is not required.
- Fix rewind: empty `snapshotEvents()` no longer reads `undefined.length`, so undo no longer fails with `(gateway/internal)`.

# 1.1.44

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.44銆?- 瀹樻柟妗岄潰瑙ｅ紑 `app.asar` 鏃跺厛鍐欏埌鏃佽竟鐨勭洰褰曪紝瑙ｅ紑瀹屾垚鎵嶆崲涓?`resources/app`銆傜洰褰曢噷宸茬粡鏈夊涓讳箣鍚庡彧鏀硅繖浜涙枃浠躲€傚悓涓€浠藉綊妗ｅ張鍑虹幇鏃跺彧鎶婂畠鎸紑銆傚綊妗ｇ殑澶у皬鎴栨椂闂村彉浜嗭紝鎴栫洰褰曚笉鍦ㄤ簡锛屾墠鍐嶈В涓€娆°€傝В鍖呭崱浣忔垨琛ヤ竵娌″啓瀹岋紝鎶婁笂涓€浠芥斁鍥炲幓锛屽崌绾ф爣璁扮暀鍒颁笅娆″啀璇曘€?- 鍥為€€涓婁竴杞彧鎾ゆ帀鏈€鍚庝竴鏉″凡缁忓彂鍑虹殑娑堟伅鍜屽畠鐨勫洖澶嶏紝鏇存棭鐨勮疆娆＄暀鍦ㄥ璇濋噷锛屼篃浠庢ā鍨嬭姹傞噷鎷挎帀銆傝繛缁洖閫€鍚庣暀涓嬬殑绌烘爣璁颁笉鍐嶈繘涓嬩竴杞姹傦紝涓嬩竴鍙ユ寜鏂版秷鎭彂銆?- 鍙紪杈戞彁绀鸿瘝鏁翠唤鏀惧湪绯荤粺鎻愮ず鏈€鍓嶏紝鍚屼竴浠芥鏂囦笉鍐嶆嫾绗簩閬嶃€傛瘡涓€姝ョ敤褰撳墠杩欎竴浠芥浛鎹㈢涓€鏉＄郴缁熸彁绀恒€?- deepseek.com 鐨勭郴缁熸彁绀哄浐瀹氳蛋 system锛屾€濈淮閾剧収鏃у彂閫併€?- 鍦板尯鎷︽埅鍙湅杩欐浠诲姟閲岀殑鐩爣銆傝嚜宸辩殑鏈嶅姟鍣ㄥ彧璁ゅ悕鍗曚笂鐨勯偅涓€涓湴鍧€鎴栦富鏈哄悕銆傜姝㈠彞鍐欎笂涔嬪悗鎵嶇粨鏉熻繖涓€杞€?- 瀹樻柟濮嬬粓鐢ㄥ甫 CTF 鐨勯粯璁ゆ彁绀鸿瘝銆傜孩闃熷紑浜嗚鍒欓泦灏卞彧鐢ㄨ鍒欓泦锛涘惁鍒欑敤鍘绘帀 CTF 鐨勯粯璁ゆ彁绀鸿瘝锛屽啀鎺ョ孩闃熸搷浣溿€傚瓙浠ｇ悊璺熶富浼氳瘽鍚冨悓涓€浠姐€傜鐩樻病鏈夋彁绀鸿瘝鏃跺惎鍔ㄥ氨鐢ㄩ粯璁ら偅浠斤紝涓嶅繀鍏堢偣淇濆瓨銆?
## English

- Version 1.1.44.
- Unpacking `app.asar` writes beside `resources/app` and swaps in only after the unpack finishes. Once that directory is usable, later starts only edit those files. The same archive showing up again is moved aside. A new size or mtime, or a missing directory, is unpacked once. If unpacking sticks or that patch round does not finish, the previous directory is put back and the upgrade marker stays for the next start.
- Rewinding the previous round removes only that sent message and its reply. Earlier rounds stay on screen and leave the next model request. Leftover rewind markers stay off the next model request, so the next send is a new message.
- The editable prompt is placed once at the front of the system prompt. Each step replaces the first system prompt with that current text.
- Instructions for deepseek.com stay on the system role. Thinking is still sent.
- The region check looks only at this task's target. An own server is allowed only when that exact address or hostname is on the list. The turn ends after the denial sentence is written.
- Official mode always uses the default prompt, including CTF. Red team uses only the active rule set, or the default prompt without CTF followed by the red team steps. Subagents receive the same inject as the main session. If the prompt file is empty, startup uses the bundled default without requiring Save.

# 1.1.43

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.43銆?- 杩樻病瀹氫綅鍒版湰鏈?Harness 鏃讹紝涓嶅啀鎶婃瘡涓€鏉℃樉绀烘垚璺宠繃锛屽垎缁勮鏁颁篃涓嶅啀鎶婅烦杩囩畻鎴愬凡瀹屾垚銆?- 琛ヤ竵鍒楄〃琛ラ綈鍒板叏閮?52 鏉★紝鎬绘暟鍜屽垎缁勫寰椾笂銆?- 鍚姩鏃跺鏋滄殏鏃舵壘涓嶅埌瀹夸富鐩綍锛屼笉鍐嶆妸杩欎釜绌虹粨鏋滅紦瀛樹綇銆?
## English

- Version 1.1.43.
- Before this install is located, rows are no longer shown as skipped, and a skip no longer counts as done in the group total.
- The patch list now includes all 52 items, so the total matches the groups.
- A miss while looking up the host directory is not cached for the rest of the process.

# 1.1.42

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.42銆?- 娓呮礂椤垫彁绀鸿瘝涓嬮潰鍙互鐧昏鑷繁鐨勬湇鍔″櫒锛氭瘡琛屼竴涓?IP 鎴栧畬鏁翠富鏈哄悕锛岀偣淇濆瓨鍚嶅崟銆傝鏄庨噷鍐欎簡姝ラ锛屽苟闄勪簡鎴浘銆?- 鏂板璇濇妸鎻愮ず璇嶆斁鍦ㄧ郴缁熸彁绀烘渶鍓嶃€傞潰鏉挎敼涓虹櫧澧ㄧ幓鐠冿紝涓ょ涓婚閮借兘鐪嬫竻瀛椼€?- 琛ヤ竵杩涘害鍙宸插簲鐢ㄧ殑椤广€傜綉椤佃韩浠介偅鏉″湪鍚庝竴鏉℃敼鍐欏彞瀛愪箣鍚庯紝浠嶆樉绀哄凡搴旂敤銆?- 琛ヤ笂 0.1.x 鐨勫叆鍙ｉ拡銆傚凡缁忔墦杩囩殑 0.2.0 涓嶄細琚噸鍐欍€?
## English

- Version 1.1.42.
- Under Prompt on the Clean page, register your own server: one IP or exact hostname per line, then Save list. The docs include the steps and a screenshot.
- New chats place the prompt at the front of the system prompt. The dock is frosted glass, and both the light and ink themes stay readable.
- The patch count includes only applied items. The web-surface identity row stays applied after the later sentence rewrite.
- Needles for 0.1.x entry points were added. An already patched 0.2.0 host is not rewritten.

# 1.1.41

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.41銆?- 瀹樻柟妯″紡鍙敞鍏ュ綋鍓嶆彁绀鸿瘝锛涘惎鐢ㄨ鍒欓泦鍚庝互瑙勫垯闆嗕负涓汇€傜孩闃熷啀闄勪笂绾㈤槦鎿嶄綔瑕佹眰銆?- 鍥為€€鐣欏湪褰撳墠浼氳瘽锛氬厛閫夊洖閫€涓€娆℃垨涓婁竴杞紝涓婁竴鍙ユ斁鍥炶緭鍏ユ锛屽苟娓呮帀宸茬粡鍙戝嚭鍘荤殑鍐呭銆?- 瀹夸富娌℃竻娲楀畬锛屾垨娌℃湁鍙敞鍏ョ殑鎻愮ず璇嶆椂锛屼笉閲嶅惎銆?- 榛樿宸叉槸瀹屽叏鏉冮檺鏃讹紝鏂颁細璇濅笉鍐嶈閽夊洖鍙楅檺鏉冮檺銆傚畼鏂规ā鍨嬬殑 Session Log 涓婁紶榛樿鍏抽棴銆?- 鐩爣鍦板潃钀藉湪涓浗澶ч檰銆侀娓€佹境闂ㄦ椂鍋滄銆?
## English

- Version 1.1.41.
- Official modes inject the editable prompt, or the active rule set when one is enabled. Red team also keeps its operating section.
- Rewind stays on the current session: choose one step or the last round, return the last line to the composer, and clear what was already sent.
- Restart is cancelled unless the host is cleaned and inject text is present.
- A full-access default is no longer pinned back to a restricted preset. Official model Session Log upload is off by default.
- Targets whose addresses fall in mainland China, Hong Kong, or Macau are stopped.

# 1.1.40

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.40銆?- 閫傞厤 **DSH 0.2.0-rc.2**锛欰nthropic OAuth 涓嶅啀鍦ㄧ郴缁熸彁绀烘渶鍓嶉潰寮烘彃銆孻ou are Claude Code鈥︺€嶏紝鑷畾涔?`prompt-inject` 涓嶄細琚帇鍒板悗闈€?- 鍘绘帀鍦?0.2 閲屽凡涓嶅瓨鍦ㄧ殑 **patch 41**锛坉eveloper 瑙掕壊鏀瑰啓锛夛紝閬垮厤鏃犳晥琛ヤ竵鍗犱綅銆?- 璁剧疆椤电偣 **搴旂敤** 鎴愬姛鍚?**鑷姩閲嶅惎** 瀹夸富锛屼笉蹇呭啀鎵撳紑鎻掍欢鐐圭浜屾閲嶅惎銆?
## English

- Version 1.1.40.
- For **DSH 0.2.0-rc.2**, Anthropic OAuth no longer prepends 鈥淵ou are Claude Code鈥︹€?ahead of your system prompt, so custom `prompt-inject` is not pushed behind a Claude identity block.
- Removed **patch 41** (developer-role remap) because those needles are gone in 0.2.
- After **Apply** in settings, the host **restarts automatically**; you no longer need to open the plugin again to confirm restart.

# 1.1.39

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.39銆?- 涓枃 Windows 涓婏紝瀹樻柟妗岄潰鐗堢偣銆屽畨瑁呭苟閲嶅惎銆嶄笉鍐嶅仠鍦ㄣ€屾鍦ㄥ噯澶囬噸鍚€嶃€傛洿鏂拌剼鏈琛屾敼涓虹函 ASCII锛岃矾寰勯噷鐨勪腑鏂囧啓鎴?`\u` 杞箟锛岄伩鍏?Windows Script Host 鎸?GBK 鎶婃崲琛屽悶杩涙敞閲娿€?- macOS 鍜?Linux 涓嶈蛋杩欐潯鑴氭湰锛岄噸鍚柟寮忎笉鍙樸€?
## English

- Version 1.1.39.
- On Chinese Windows, the official desktop install-and-restart no longer stays on preparing to restart. The update script starts with an ASCII comment, and non-ASCII paths are written as `\u` escapes, so Windows Script Host does not swallow the newline when it reads the file as GBK.
- macOS and Linux do not use this script. Their restart path is unchanged.

# 1.1.38

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.38銆?- 绾㈤槦涓嶅啀鏇跨敤鎴蜂笅杞藉伐鍏枫€傛病鏈夊畨瑁呰剼鏈椂锛屽紩瀵兼敼璧版紨缁冨彴銆岀幆澧冮€傞厤銆嶏紝鐢辩敤鎴疯嚜宸卞～璺緞銆?- 闀挎椂闂翠换鍔′細鍦ㄧ郴缁熸彁绀鸿瘝閲屾斁涓€寮犮€屾湰娆＄洰鏍囥€嶅崱銆傛寚鎸ュ拰瀛愪唬鐞嗙湅鐨勬槸鍚屼竴寮狅細鍙墦杩欎釜鍗曚綅锛屽洖鎶ラ噷甯﹀嚭鏉ョ殑鍏跺畠鍗曚綅涓嶆墦銆傚瓙浠ｇ悊鎸夎鑹蹭娇鐢ㄨ嚜宸辩殑鎻愮ず璇嶏紝娲炬椿鏃剁殑鍗曚綅鍚嶇О蹇呴』鍜岃繖寮犲崱涓€鑷淬€?- 宸ュ叿鏌ユ壘璁ゅ彂琛岀増涓婄殑鐪熷疄鏂囦欢鍚嶏紝渚嬪 Kali 鐨?`httpx-toolkit`銆乣impacket-secretsdump`锛屼笉鍐嶆妸 Python 鐨?`httpx` 褰撴垚鎵弿鍣ㄣ€?- 瀹樻柟妗岄潰鍦?macOS銆丩inux 涓婁篃鑳芥壘鍒?`app.asar`锛圡ac 鐢?`Contents/Resources`锛夈€俉indows 浠ュ涓嶅啀鍖呬竴灞備細鎶?`require` 寮勫潖鐨勬帶鍒跺彴闅愯棌銆?- 绾㈤槦鎺ュ叆閿氱偣闂細寮€澶村嚑姝ヨ緭鍑轰笂闄?1024锛涚涓€娈垫€濊€冮噷鏈?`we`銆佹病鏈?`let me` 灏辨斁寮€锛屽惁鍒欏悓涓€杞渶澶氬啀璧?4 姝ャ€備笂涓嬫枃鍘嬬缉鍚庡啀鍏充竴娆°€傜孩闃熷伐鍏峰拰浜鸿淇濇寔鍘熸牱銆?- 闅忓寘鎶€鑳藉悓姝ュ埌 `$DSH_HOME/redteam/skills`锛岄璁剧敤 `dshHomePath` 鎸囧悜瀹冿紝涓嶅啀鎶婃煇涓€鍙扮數鑴戠殑 `node_modules` 璺緞鍐欒繘棰勮銆備綘鑷繁鐨勬妧鑳戒粛鍦?`$DSH_HOME/skills`锛屽悓鍚嶄互浣犵殑涓哄噯銆?- 淇ソ绾㈤槦妯″紡涓嶆樉绀猴細澹版槑棰勮鏃舵紡浜嗚矾寰勫彉閲忥紝鎻掍欢涓€旈€€鍑猴紝妯″紡涓嬫媺灏辨病鏈夎繖涓€椤广€?- 璇存槑閲屽姞鍥炶禐鍔╁湴鍧€銆?
## English

- Version 1.1.38.
- Red team no longer downloads tools for you. When the setup script is missing, the guide points at the drill console environment page so you fill in the paths.
- Long jobs keep a target card in the system prompt. The commander and subagents see the same card: stay on that organization, and do not switch to other names that show up in results. Each subagent loads its own role text, and dispatched work must use the name on the card.
- Tool lookup accepts distro filenames such as Kali's `httpx-toolkit` and `impacket-secretsdump`, and does not treat Python's `httpx` as the scanner.
- The official desktop app can find `app.asar` on macOS and Linux (`Contents/Resources` on Mac). Outside Windows, the console-hide wrapper that broke `require` is not installed.
- Red team uses an anchor gate: the first steps are capped at 1024 output tokens, the cap lifts when the first reasoning block contains `we` and not `let me`, otherwise it lasts at most 4 steps in that turn, and a context compaction closes the gate again. Red team tools and the persona stay as they are.
- Bundled skills are copied to `$DSH_HOME/redteam/skills` and the preset points there with `dshHomePath`, instead of a machine-specific `node_modules` path. Your own skills stay in `$DSH_HOME/skills` and win on the same name.
- Red team mode shows in the mode list again. Declaring the preset no longer exits early because a path variable was missing.
- The sponsor addresses are back in the readme.

# 1.1.37

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.37銆?- 淇敼婕旂ず鍙扮幆澧冮厤缃粴鍔ㄩ棶棰樸€?
## English

- Version 1.1.37.
- The drill console environment page scrolls, so the rest of the settings can be filled in.

# 1.1.36

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.36銆?- 瑙ｅ喅绾㈤槦妯″紡鎷掔粷闂銆?
## English

- Version 1.1.36.
- Fix red team mode refusing the cleaned prompt.

# 1.1.35

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.35銆?- 鍚姩鏃朵笉鍐嶈嚜鍔ㄦ洿鏂帮紝瑕佽嚜宸卞湪闈㈡澘閲岄€夋嫨銆?- dsh-purge 鍏ュ彛鏀瑰埌銆屼笂涓嬫枃銆嶆梺杈癸紝涓嶅啀鎸′綇鍒殑鎻掍欢鎸夐挳銆?- 寰楀垎鍙ｅ緞瀵归綈涓婃父锛?5 椤癸紝Web 搴旂敤澧炲姞鍏滃簳褰掔被銆?- 鐭ヨ瘑搴?14 绫昏鏁板寘鍚湰鏈?nuclei 妯℃澘锛岀偣鏌愪竴绫诲彲浠ョ瓫閫夈€?- 鎶€鑳借矾寰勮窡闅?`$DSH_HOME`锛屼笉鍐嶅洜涓虹ず渚嬭矾寰勫湪鏈満涓嶅瓨鍦ㄥ氨鎶婃暣鏉℃妧鑳芥爣鎴愪笉鍙敤銆?
## English

- Version 1.1.35.
- Startup no longer auto-updates; choose the update in the panel.
- The dsh-purge entry sits beside Context, so it no longer covers other plugin buttons.
- Scoring matches upstream: 25 items, with a fallback bucket for other web apps.
- The 14 knowledge categories count local nuclei templates, and a category filters the list.
- Skill paths follow `$DSH_HOME`. A skill is no longer marked unavailable just because an example path is missing on this machine.

# 1.1.34

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.34銆?- **婕旂粌鍙扮煡璇嗗簱鐩存帴鍒楀嚭鏈満妯℃澘**銆傛墦寮€銆岀煡璇嗗簱 路 POC / EXP銆嶅氨鑳界湅鍒颁竴椤?nuclei 妯℃澘锛屽苟鍙互缈婚〉銆佹寜 CVE 鎴栫粍浠舵悳绱€備笉鍐嶅彧鏄剧ず銆屾湰鏈烘ā鏉?N銆嶃€佷笅闈㈡槸绌虹殑銆?- **鏇存柊鍖呭湪 Windows銆乵acOS銆丩inux 涓婇兘鑳借В鍘?*銆侺inux 涓嶅啀璋冪敤 PowerShell銆傞『搴忔槸锛歐indows 鐢?tar锛屼笉琛屽啀鐢?PowerShell锛沵acOS 鍜?Linux 鐢?tar銆乽nzip銆乸ython3銆乥sdtar銆傝繖浜涢兘娌℃湁鏃讹紝鐢?Node 鑷繁瑙?zip銆傛劅璋?@cracer4869 鍦?#44 鎶ュ嚭 Kali 涓婄殑 `spawnSync powershell ENOENT`銆?
## English

- Version 1.1.34.
- **The drill knowledge page lists local templates.** Opening Knowledge shows a page of nuclei templates, with paging and search by CVE or component. It no longer shows only the template count.
- **Update archives extract on Windows, macOS, and Linux.** Linux does not call PowerShell. Windows tries tar, then PowerShell. macOS and Linux try tar, unzip, python3, then bsdtar. If none of those exist, Node extracts the zip itself. Thanks to @cracer4869 for reporting `spawnSync powershell ENOENT` on Kali in #44.

# 1.1.33

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.33銆?- **淇宸茬粡閲嶅惎鍚庯紝鎵撳紑闈㈡澘浠嶅脊鍑恒€岄渶瑕侀噸鍚€?*銆傚畼鏂瑰鎴风宸茬粡浠庤В寮€鐨?`resources/app` 杩愯鏃讹紝涓嶅啀浠呭洜涓哄綋鍓嶆槸瀹樻柟杩涚▼灏卞啀瑕佹眰閫€鍑轰竴娆°€傚彧鏈夎繖娆＄湡鐨勬尓寮€浜?`app.asar`锛屾墠浼氭彁绀洪噸鍚€?
## English

- Version 1.1.33.
- **Fix the restart dialog coming back after you already restarted.** When the official app is already running from the unpacked `resources/app`, opening the panel no longer asks you to quit again just because this is the official process. The restart prompt appears only when `app.asar` was actually moved aside in this run.

# 1.1.32

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.32銆?- **鎸夋祴璇曠増鎺ヤ笂婕旂粌鍙板竷灞€**锛氶潰鏉垮彲鎷栧姩銆佸彲鏀瑰ぇ灏忥紝娴呰壊鍜屾繁鑹茶窡瀹夸富涓婚璧般€?- **璁剧疆椤典笉鍐嶅嚭鐜版湰鎻掍欢**銆備粠浼氳瘽鏍囬鏃佺殑 dsh-purge 鎵撳紑鍙充晶鏍忥紝娓呮礂鍜屾紨缁冨彴閮藉湪閲岄潰銆?
## English

- Version 1.1.32.
- **Bring the beta dock layout onto stable**: the panel can be dragged and resized, and light and dark follow the host theme.
- **The plugin no longer appears on the Settings page.** Open the right dock from dsh-purge beside the session title. Clean and Drill are both in that dock.

# 1.1.31

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.31銆?- **婕旂粌鍙拌繘鍏ユ寮忕増**銆傚彸渚ф爮涓ら〉锛氭竻娲椼€佹紨缁冨彴銆傜涓€娆¤繘鍏ユ紨缁冨彴瑕佽澹版槑骞剁‘璁ゆ巿鏉冦€傝祫浜с€佹妧鑳藉拰鏈満鐜閮藉湪鏈彃浠堕噷锛屼笉鍐嶅崟鐙娴嬭瘯鐗堢孩闃熷寘銆?- **淇鍥為€€鍫嗗垎鏀?*锛氬涓讳笉鑳藉湪鍘熶細璇濋噷鎴柇锛屽洖閫€鍚庝細鎶婃棫浼氳瘽浠庝晶杈规爮绉诲嚭锛屽閫€鍑犳涓嶄細鐣欎笅涓€涓插垎鏀€?
## English

- Version 1.1.31.
- **Drill console is on the stable release.** The right dock has two pages: Clean and Drill. The first time you open Drill you read the notice and confirm authorization. Assets, skills, and the local environment ship inside this plugin.
- **Fix rewind leaving a branch every time.** The host cannot truncate a session in place. After rewind the old session leaves the sidebar, so repeated undo does not pile up branches.

# 1.1.30

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.30銆?- **淇姝ｅ紡鐗堝拰 web 鍒囨崲鐗堟湰澶辫触**锛氫笉鍐嶇敤 `dsh plugin add` 鎷夊寘銆俻npm 璇锋眰 GitHub 鍘嬬缉鍖呬細 `http 302` 鎴?`fetch failed`銆傛敼鐢辨彃浠惰嚜宸变笅杞姐€?- **淇鎬濊€冨拰杈撳嚭姝诲惊鐜?*锛氬幓鎺夐粯璁ゆ彁绀鸿瘝閲屾病鏈夌粓姝㈡潯浠剁殑閲嶇疆銆?
## English

- Version 1.1.30.
- **Fix version switching on the desktop app and web**: stop installing through `dsh plugin add`. pnpm's fetch of the GitHub archive returns `http 302` or `fetch failed`. The plugin downloads the package itself.
- **Fix the thinking and output loop**: remove the default-prompt reset that had no stop condition.

# 1.1.28

## 涓枃

- **淇鏇存柊澶辫触 `http 302`**锛氫笅杞芥敼涓虹洿杩?`codeload.github.com`锛屽苟鎵嬪姩璺熼殢璺宠浆锛岄伩鍏?Electron/閮ㄥ垎 Node 瀵?github.com 鈫?codeload 鐨?302 澶勭悊澶辫触銆?- **淇娴嬭瘯鐗堝垪琛ㄧ┖鐧?*锛氬墠绔?`keepListedVersion` 涓庡悗绔竴鑷达紝姝ｅ紡鐗堝凡鍙戝竷鏃朵粛淇濈暀 beta tip / `beta` 鍒嗘敮锛泃ip SHA 鎷変笉鍒版椂鍥為€€ raw/jsDelivr 鎺㈡祴銆?
## English

- **Fix update failure `http 302`**: download via `codeload.github.com` and follow redirects manually so Electron/some Node builds no longer stall on github.com 鈫?codeload 302.
- **Fix empty beta list**: client `keepListedVersion` matches the server 鈥?keep the beta tip / `beta` branch after stable ships; fall back to raw/jsDelivr when tip SHA cannot be fetched.

# 1.1.27

## 涓枃

- **淇搴旂敤閲嶅惎鍚庤繘瑙勫垯璁惧畾浠嶅脊銆岄渶瑕侀噸鍚€?*锛氭墜鍔ㄣ€屽簲鐢ㄣ€嶆垚鍔熷悗鍐欏叆 `applied` 鎴筹紝閲嶅惎鍚?settle 涓嶅啀璇垽琛ヤ竵鏈榻愩€?- 鐐广€岄噸鍚€嶆竻鎺?`boot_full_quit` 绮樻€ф爣璁帮紱status 鎸夊竷灏斿€煎悓姝ュ脊绐椼€?- web `waitForRestart` 蹇呴』鍏堢湅鍒版棫杩涚▼鎺夌嚎鍐嶅垽瀹氭垚鍔燂紝閬垮厤鍚岃繘绋嬭鍒锋柊鍙堝脊绐椼€?
## English

- **Fix restart prompt still showing after Apply + successful restart**: write the `applied` stamp on successful manual Apply so settle does not think patches are out of date.
- Clear sticky `boot_full_quit` when Restart is clicked; status syncs the modal from the boolean.
- Web `waitForRestart` requires the old process to go down before treating restart as success, avoiding same-process false refresh.

# 1.1.26

## 涓枃

- **淇娴嬭瘯閫氶亾琚寮忕増鍚屽彿钘忔帀**锛歚1.1.25` 姝ｅ紡鍙戝竷鍚庯紝`1.1.25-beta.*` 鍥犮€屾寮忓凡杩戒笂銆嶉€昏緫鏁撮€氶亾涓嶅彲瑙侊紱鐜?**beta 鍒嗘敮 tip 濮嬬粓鍒楀嚭**锛堟寮?娴嬭瘯骞惰锛屾祴璇曞甫绾㈤槦锛夈€?- 宸茶拷涓婄殑鏃?beta **鏍囩**浠嶄細闅愯棌锛沗1.1.11-beta` 浠嶄笅绾裤€?
## English

- **Fix beta lane hidden by same-number stable**: after `1.1.25` stable, `1.1.25-beta.*` vanished via the 鈥渟table caught up鈥?filter; the **beta branch tip always stays listed** (parallel channels; beta carries red-team).
- Older caught-up beta **tags** still hide; `1.1.11-beta` stays withdrawn.
# 1.1.25

## 涓枃

- **淇 [#43](https://github.com/YuJunZhiXue/dsh-purge/issues/43)**锛氫笉鍐嶆妸 `profiles/*/cordis.patch.yml`锛堢敤鎴?patch 灞傦級绾冲叆 `backupAll`/`revertAll`锛涘崌绾ц嚜鎰堟椂涓嶄細鐢ㄦ棫 bak 瑕嗙洊鐢ㄦ埛鍚庢潵杩藉姞鐨?`insert`銆?- 鍚姩/杩樺師鏃朵富鍔ㄤ涪鎺夊巻鍙蹭笂璇缓鐨?`cordis.patch.yml.dshpurge.bak`锛屼繚鐣欏綋鍓嶇敤鎴锋枃浠躲€?- 鏂板 `npm run test:profile-patch`銆?
## English

- **Fix [#43](https://github.com/YuJunZhiXue/dsh-purge/issues/43)**: stop including `profiles/*/cordis.patch.yml` (user patch layer) in `backupAll`/`revertAll`, so upgrade reapply no longer restores an old bak over later user `insert`s.
- Drop stale `cordis.patch.yml.dshpurge.bak` without restoring; keep the live user file.
- Add `npm run test:profile-patch`.
# 1.1.24

## 涓枃

- **淇 [#40](https://github.com/YuJunZhiXue/dsh-purge/issues/40)**锛歚pathLooksDesktop` 涓嶅啀浠呭嚟璺緞閲岀殑 `deepseek-harness` 瀛愪覆鎶婃簮鐮佺増鍒ゆ垚妗岄潰绔紱闇€甯?`resources/` / `.exe` / `.app` 绛夊畨瑁呭舰鎬併€?- **淇 [#41](https://github.com/YuJunZhiXue/dsh-purge/issues/41)**锛氭簮鐮侀儴缃茬殑 `apps/cli`锛坱sdown 鏋勫缓浜х墿锛夌姝?hide-console 娉ㄥ叆锛沗revertAll` 鍦ㄦ棤 `.dshpurge.bak` 鏃跺彧璺宠繃銆佺粷涓嶅垹闄ょ洰鏍囨枃浠躲€?- 鏂板 `npm run test:surface` 鍥炲綊銆?
## English

- **Fix [#40](https://github.com/YuJunZhiXue/dsh-purge/issues/40)**: `pathLooksDesktop` no longer treats source trees as desktop just because the path contains `deepseek-harness`; require install shapes (`resources/`, `.exe`, `.app`).
- **Fix [#41](https://github.com/YuJunZhiXue/dsh-purge/issues/41)**: skip hide-console injection into source `apps/cli` build output; `revertAll` never deletes targets when `.dshpurge.bak` is missing.
- Add `npm run test:surface`.
# 1.1.23

## 涓枃

- **淇 [#38](https://github.com/YuJunZhiXue/dsh-purge/issues/38)**锛歚#1`/`#2`/`#3` 鎻愮ず璇嶈ˉ涓佹瘡娆?`apply` 鍙犲姞绾?+841 瀛楃銆佹案涓嶆敹鏁涖€?- **鍘熷洜**锛氭浛鎹骇鐗╀粛浠ュ墠涓€鐗堟枃鏈负鍓嶇紑锛屼笖鏈 `skipIfMarked`锛宍autoApplyOnStart` 姣忚疆閮戒細鍐嶅啓涓€灞傘€?- **淇**锛氫负 `#1`/`#2`/`#3` 琛?`skipIfMarked: true`锛圼#42](https://github.com/YuJunZhiXue/dsh-purge/pull/42)锛夛紝骞跺姞 `npm run test:idempotence` 鍥炲綊銆?- 宸茶啫鑳€鐨勫涓绘枃浠朵笉浼氳嚜鍔ㄧ缉鍥烇紝闇€杩樺師 `.dshpurge.bak` 鎴栭噸瑁?dsh 鍚庡啀 apply銆?
## English

- **Fix [#38](https://github.com/YuJunZhiXue/dsh-purge/issues/38)**: prompt patches `#1`/`#2`/`#3` grew by ~+841 chars on every `apply` and never converged.
- **Cause**: replacement text still starts with the previous pattern, and `skipIfMarked` was missing, so `autoApplyOnStart` rewrote every boot.
- **Fix**: set `skipIfMarked: true` on `#1`/`#2`/`#3` ([#42](https://github.com/YuJunZhiXue/dsh-purge/pull/42)); add `npm run test:idempotence`.
- Already-bloated host files are not auto-shrunk 鈥?restore `.dshpurge.bak` or reinstall dsh, then apply again.

# 1.1.22

## 涓枃

- **淇瀹樻柟妗岄潰鐐广€屽簲鐢ㄣ€嶆姤 ENOENT**銆俙app.asar` 杩樺湪鏃讹紝鏂板缓 `dsh-purge-child-process-hide.mjs` 浼氬け璐ワ紝璺緞琚啓鎴?`resources\app.asar\...\dsh-purge-child-process-hide.mjs`锛岃ˉ涓佸仠鍦ㄥ緟搴旂敤銆?- **鍘熷洜**锛氬畼鏂瑰鎴风杩樺甫鐫€ `app.asar` 鏃讹紝Electron 浼氭妸 `resources\app` 鏄犲皠杩涜繖涓綊妗ｃ€傚綊妗ｉ噷娌℃湁鐨勬柊鏂囦欢锛岀敤鏅€氭枃浠舵帴鍙ｅ幓鍒涘缓灏变細 ENOENT銆?- **涓ょ鍐欐硶閮戒繚鐣?*銆傚綊妗ｈ繕鍦ㄦ椂锛屾敼鍐欑湡瀹炵鐩樹笂鐨?`resources\app`銆傛病鏈?`app.asar` 鏃朵粛鐢ㄥ師鏉ョ殑 `node:fs`锛屽寘鎷?Web銆佺ぞ鍖烘闈紝浠ュ強瀹樻柟鍖呭凡缁忚В寮€骞舵妸褰掓。鎸垚 `app.asar.bak` 鐨勬儏鍐点€?- 瀹夎鐩綍涓嶅啓姝荤洏绗︺€俉eb 鍜岀ぞ鍖烘闈㈢殑搴旂敤銆侀噸鍚繚鎸佸師鏍枫€傚涓讳粛瀵瑰噯 **dsh 0.1.7-rc.2**銆?
## English

- **Fixes ENOENT when Apply runs on the official desktop.** While `app.asar` is still present, creating `dsh-purge-child-process-hide.mjs` failed. The path was rewritten to `resources\app.asar\...\dsh-purge-child-process-hide.mjs`, and patches stayed pending.
- **Cause**: with the archive still in place, Electron maps `resources\app` into `app.asar`. Creating a file that is not already in the archive through the normal file API throws ENOENT.
- **Both write paths stay.** If the archive is still there, files are written on the real `resources\app` directory. If there is no `app.asar`, the previous `node:fs` path is unchanged. That covers Web, community desktop, and an official install that has already been unpacked and had the archive moved to `app.asar.bak`.
- Install paths are not pinned to a drive letter. Web and community desktop keep their existing Apply and restart. The host target remains **dsh 0.1.7-rc.2**.

# 1.1.21

## 涓枃

- **淇蹇呴渶琛ヤ竵澶辫触 #43銆?9銆?15銆?23銆?42**銆傜偣銆屽簲鐢ㄣ€嶄笉鍐嶅洜涓鸿繖 5 鏉℃姤銆屾竻娲楁湭瀹屾垚銆嶃€傛彁绀鸿瘝鏈潵灏变細鍐欏叆锛涜繖 5 鏉℃病鍐欎笂鏃讹紝鐣岄潰鍗存妸鏁存搴旂敤鍒ゅけ璐ワ紝鐪嬭捣鏉ュ儚鎻掍欢澶辨晥銆?- **鍘熷洜**锛氫笂绾ф枃浠跺す鍚嶅彨 DeepSeek Harness 鏃讹紝鏁存５鐩綍琚綋鎴愬畼鏂规闈€俉eb 鐨?npm 鍖呭洜姝よ鎺掗櫎锛岃繖 5 鏉″寰椾笂鐨勫師鏂囦篃娌″啓杩涘幓銆傚畨瑁呰矾寰勪笉鍐欐鐩樼銆傜幇鍦ㄥ彧鏈夋梺杈圭湡鏈夋闈㈢▼搴忥紝鎴栬矾寰勫湪璇ュ畨瑁呯殑 `resources/app` 閲岋紝鎵嶇畻妗岄潰瀹夎銆俉eb銆佺ぞ鍖烘闈€佸畼鏂规闈㈠悇鑷墦鑷繁鐨勫寘銆?- **#43**锛氬幓鎺?Web 鍥涗釜鍐呯疆棰勮锛坰tandard銆乸tc銆乧ordis銆乵inimal锛夐噷鐨勮韩浠藉彞銆傛病鍐欎笂鏃讹紝棰勮閲岀殑鍘熻韩浠藉彞浼氱暀鍦ㄦ敞鍏ユ梺杈广€?- **#9**锛氬鎵硅姹傝嚜鍔ㄦ斁琛屻€?- **#15**锛氭矙绠?`confine` 涓嶅啀鍖呬竴灞傦紝鍛戒护鎸夊師鏍锋墽琛屻€?- **#23**锛氬瓙浠ｇ悊榛樿娣卞害浠?1 鎻愬埌 10銆?- **#42**锛氱粰璁剧疆鏈嶅姟琛ュ洖鏃х殑 `register` / `get`锛岃繕鍦ㄨ皟鏃ф帴鍙ｇ殑鎻掍欢鎵嶈兘鍔犺浇銆?- 鏂囦欢鍦ㄣ€佷絾杩欎唤鍘熸枃涓嶅湪褰撳墠鐗堟湰閲屾椂锛屾樉绀鸿烦杩囷紝涓嶅啀鎶婃暣娆″簲鐢ㄥ垽澶辫触銆傚師鏂囪繕鍦ㄦ椂浠嶄細鍐欎笂銆?
## English

- **Fixes required-patch failures #43, #9, #15, #23, and #42.** Apply no longer reports the cleanse as incomplete because of these five. The prompt was already written; the failure made the plugin look dead.
- **Cause**: a parent folder named DeepSeek Harness was treated as the official desktop install, so the Web npm packages were excluded and these five were never written. Install paths are not pinned to a drive letter. A tree counts as the desktop install only when the desktop executable is beside it, or the path is under that install's `resources/app`. Web, community desktop, and official desktop each patch their own packages.
- **#43**: strips the identity sentence from the four built-in Web presets (standard, ptc, cordis, minimal). Left in place, that sentence stays next to the inject.
- **#9**: approval requests are auto-granted.
- **#15**: sandbox `confine` no longer wraps the command.
- **#23**: subagent default depth moves from 1 to 10.
- **#42**: the settings service gets the old `register` / `get` methods back, so plugins that still call them can load.
- When the file exists but this version does not contain that original text, the row shows skipped and Apply still completes. Text that is present is still written.

# 1.1.20

## 涓枃

- **瀹夸富鐗堟湰**锛氬綋鍓嶅鍑?**dsh 0.1.7-rc.2**銆備笂涓€妗?**0.1.7-rc.1**锛堝惈 `0.1.7-rc.1.20260924.1`锛夌殑鏃ч敋鐐逛粛鍙敤銆?- **瀹樻柟妗岄潰鍗囩骇**锛氬凡缁忎笅杞界殑鏂扮増鏈細鍦ㄩ噸鍚紝鎴栧湪搴旂敤閲岀偣瀹夎骞堕噸鍚椂鐪熸瀹夎锛岀劧鍚庤В寮€鏂扮増鏈苟閲嶆柊鎵撹ˉ涓併€傛病鏈夋柊鐗堟湰鏃讹紝閲嶅惎浠嶆槸鍏虫帀鍐嶆墦寮€褰撳墠瀹㈡埛绔€傚畨瑁呯洰褰曚笉鍐欐鐩樼銆?- **琛ヤ竵**锛?14銆?35 璺熶笂 rc.2 鐨勫崌绾у啓娉曪紝涓嶅啀鎶ュ繀闇€琛ヤ竵澶辫触銆?29銆?33銆?36 鐨勬柊鎻愮ず鍙ヤ篃浼氭墦涓娿€?- Web 鍜岀ぞ鍖虹増 DSH Desktop 鐨勫簲鐢ㄣ€侀噸鍚繚鎸佸師鏍枫€?
## English

- **Host version**: current target is **dsh 0.1.7-rc.2**. Anchors for the previous target, **0.1.7-rc.1** (including `0.1.7-rc.1.20260924.1`), still match.
- **Official desktop upgrade**: a downloaded update installs on Restart, or on the in-app install-and-restart action, then the new build is unpacked and patched. With no pending update, Restart still closes and reopens the current client. Install paths are not pinned to a drive letter.
- **Patches**: #14 and #35 match the rc.2 escalation text, so Apply no longer fails those required patches. #29, #33, and #36 follow the new prompt wording.
- Web and community DSH Desktop keep their existing Apply and restart.

# 1.1.19

## 涓枃

- **瀹樻柟妗岄潰 EXE**锛氭敮鎸佸畼鏂?DeepSeek Harness銆傜偣銆屽簲鐢ㄣ€嶈В寮€ `app.asar` 骞惰ˉ涓婂師鐢熸ā鍧楋紝鍐嶇偣銆岄噸鍚€嶏紝瀹㈡埛绔嚜宸卞叧鎺夊苟閲嶆柊鎵撳紑銆俉eb 鍜岀ぞ鍖虹増 DSH Desktop 鐨勫簲鐢ㄣ€侀噸鍚繚鎸佸師鏍枫€?- **閲嶅惎**锛氬畼鏂瑰鎴风閫€鍑轰笉鍐嶈澶栧３褰撴垚宕╂簝锛屼篃涓嶄細鐣欎笅鍚庡彴 PowerShell銆傞噸鍚剼鏈笉鍐嶈皟鐢?Windows 鑴氭湰瀹夸富娌℃湁鐨?`toISOString`锛岄伩鍏嶅脊鍑鸿繍琛屾椂閿欒銆傛柊杩涚▼涓嶅啀缁ф壙 `ELECTRON_RUN_AS_NODE`锛屽惁鍒欎細鍒氭墦寮€灏遍€€鍑恒€?- **鏇存柊**锛氭崲鐗堟湰鎴栧洖閫€鏃讹紝鎸夎惤鍦扮殑閭ｄ竴鐗堣嚜鍔ㄨ繕鍘熷啀搴旂敤锛屼笉蹇呮瘡娆℃墜鍔ㄥ厛杩樺師鍐嶅簲鐢ㄥ啀閲嶅惎銆?- **琛ヤ竵鍒楄〃**锛氬涓诲凡缁忚嚜甯?`dsh-web-fetch-http` 鏃讹紝涓嶅啀鏄剧ず涓€鏉℃案杩滆烦杩囩殑 #20銆傚畨瑁呯洰褰曚笉鍐嶅啓姝荤洏绗︺€?
## English

- **Official desktop EXE**: Apply on official DeepSeek Harness unpacks `app.asar`, restores native modules, then Restart closes the client and opens it again. Web and community DSH Desktop keep their existing Apply and restart.
- **Restart**: exiting the official host is no longer treated as a crash, and no PowerShell process is left behind. The helper no longer calls `toISOString`, which made Windows Script Host pop a runtime error. The new process does not inherit `ELECTRON_RUN_AS_NODE`, which made it exit immediately.
- **Updates**: switching or rolling back a version restores and reapplies that version's patches without a manual revert first.
- **Patch list**: hosts that already depend on `dsh-web-fetch-http` no longer show a permanently skipped #20. Install paths are not pinned to a drive letter.

# 1.1.18

## 涓枃

- **閲嶅惎**锛氱偣銆岄噸鍚€嶅悗鏃ч〉闈㈢殑 token 浼氬け鏁堬紝鍙埛鏂扮瓑浜庢墦涓嶅紑銆傜幇鍦ㄤ細绛夌鍙ｉ噴鏀撅紙蹇呰鏃剁粨鏉熸棫杩涚▼锛夛紝骞舵寜鏂拌繘绋嬫墦鍗扮殑鍦板潃鎵撳紑娴忚鍣ㄣ€傝鐢ㄦ柊鎵撳紑鐨勯〉闈紝鍐嶆柊寮€涓€杞璇濄€?- **璁剧疆**锛?.1.17 涔嬪墠鑻ュ凡鎶?`legacyApplyPath` 鍙犺繘 `dsh-settings`锛岀偣銆屽簲鐢ㄣ€嶄細鏀舵垚涓€浠斤紝鎻愪緵鍟嗙洰褰曟墠鑳借捣鏉ャ€傛敹濂戒箣鍚庡啀閲嶅惎涓€娆°€?
## English

- **Restart**: the old page token dies with the process, so a refresh looks like restart did nothing. Restart now frees the port and opens the browser at the new `dsh web:` URL. Use that page and start a new chat.
- **Settings**: Apply collapses duplicate `legacyApplyPath` left by earlier 1.1.17 patches so `dsh-settings` can load. Restart once after that apply.

# 1.1.17

## 涓枃

- **绋冲畾鎬?*锛氫慨澶嶈缃ˉ涓?#42 鍦?dsh 0.1.7 涓婇噸澶嶆彃鍏?`legacyApplyPath` 鐨勯棶棰樸€傛鍓嶄細瀵艰嚧 `@deepseek-ai/dsh-settings` 鏃犳硶鍔犺浇銆佹彁渚涘晢鐩綍鎶ラ敊銆乵nemon 绛夋彃浠惰繛閿?pending銆傜幇鏀逛负 `skipIfMarked`锛屼笖涓嶅啀涓庡畼鏂瑰凡鑷甫鐨?`legacyApplyPath` 鍙犲啓銆?- **宸ヤ綔鍖哄己鎸囦护**锛?1/#2 鍚屾椂璇嗗埆 `WORKSPACE_*` 涓?`AGENT_*` 甯搁噺鍚嶏紝閬垮厤銆屽叏灞€/鏇挎崲寮忓厤璐ｃ€嶅湪鏃у涓讳笂鏄剧ず璺宠繃銆佸簲鐢ㄦ棤鏁堛€?- **鎷掔瓟涓庤蒋鎷?*锛氬畼鏂?`agent-instructions` 寮烘寚浠よˉ鍏呮湰鏈烘巿鏉冭瘎娴嬩笌鍙嶈蒋鎷掕瘽鏈紱鎻掍欢澧炲姞鍥哄畾 `dsh-purge:rules` 娈碉紙涓庢墽琛岃鍒欎竴鑷达級銆?*鏂板紑浼氳瘽骞堕噸鍚?dsh 鍚?*鐢熸晥銆?
## English

- **Stability**: patch #42 no longer stacks duplicate `legacyApplyPath` on dsh 0.1.7, which broke `@deepseek-ai/dsh-settings`, provider catalog loading, and downstream plugins. Uses `skipIfMarked` and does not re-insert the helper the official package already ships.
- **Workspace intros**: patches #1/#2 match both `WORKSPACE_*` and `AGENT_*` constant names so rows no longer show Skipped on older installs.
- **Refusal / soft refusal**: stronger official workspace intros plus a fixed `dsh-purge:rules` section. **Restart dsh and start a new chat** for prompt changes.

# 1.1.16

## 涓枃

- 瀵瑰噯 **dsh 0.1.7-rc.1**銆傚伐浣滃尯璇存槑甯搁噺鏀瑰悕涓?`AGENT_INSTRUCTIONS_INTRO`锛屽彞瀛愭病鍙橈紝琛ヤ竵璺熺潃鏀广€?- 娌欑 `confine()` 宸叉槸 `async confine(argv, policy, signal)`锛岃ˉ涓佹寜鏂板嚱鏁板啓銆傜洿閫氳涓轰笌涓婁竴鐗堢浉鍚屻€?- 瀛愪唬鐞嗘繁搴︽敼鍒?`dsh-subagent`锛岄粯璁や粠 1 鎻愬埌 10銆傛繁搴︽鏌ヨ繕鍦ㄣ€?- 璁剧疆鏈嶅姟琛ュ洖鏃х殑 `register` / `get`銆俙dsh-mnemon`銆乣dsh-better-reasoning-effort` 杩欑被杩樺湪璋冩棫鎺ュ彛鐨勬彃浠跺彲浠ョ户缁敤銆傚畼鏂?`describe` / `update` 涓嶅姩銆傝ˉ涓佸彧鎵撲竴娆★紝涓嶄細鍦ㄥ惎鍔ㄦ椂閲嶅鎻掑叆銆?- 鍒犳帀 0.1.7 閲屽凡缁忓涓嶄笂鐨勬棫鏉℃枃锛屽寘鎷崟鐙粰 `dsh-base` 琛?`dsh-web-fetch-http` 渚濊禆鐨勯偅鏉°€傚畼鏂瑰寘宸茬粡鑷甫銆?- Web 鍥涗釜鍐呯疆棰勮锛坰tandard銆乸tc銆乧ordis銆乵inimal锛夊彧娓呯┖韬唤鍙ャ€傚伐浣滅洰褰曘€佸伐鍏峰垪琛ㄣ€乣ptc` 妯″紡锛屼互鍙?minimal 鐨?`complete: true` 鍜?`includeRuntimeContext: false` 涓嶅姩銆?- `complete: true` 鏃讹紝`prompt-inject.md` 浠嶆帴鍦ㄨ繖娈靛墠闈€傛崲瀹夸富鐗堟湰鎴栨棫閽╁瓙鍒犳涔嬪悗锛屾敞鍏ヤ笉浼氫涪銆傜偣銆屽簲鐢ㄣ€嶄箣鍚庝粛瑕佸啀鐐广€岄噸鍚€嶏紝鏂板紑涓€杞璇濇墠杩涘綋鍓嶄細璇濄€?- `dsh-compaction-instant` 缃戦〉绔粠宸插垹闄ょ殑 `settingsScope` 鏀瑰埌 `configForms`锛岄〉闈笉鍐嶅仠鍦?Failed to load plugins銆?- 鍥為€€鍦?0.1.7 涓婁細寤哄嚭鏂颁細璇濓紝浣嗙晫闈粛鍋滃湪鏃у璇濓紝鐪嬭捣鏉ュ儚娌″弽搴斻€?.1.7 宸叉病鏈?`sessions.open`銆傜幇鍦ㄦ敼鐢?`uiWorkspace.openSession` 鍒囧埌鏂颁細璇濓紝骞舵妸涓婁竴鍙ュ～鍥炶緭鍏ユ銆傚け璐ュ師鍥犳樉绀哄湪鎸夐挳涓娿€?- README 鐨勮禐璧忓尯鎹㈡垚闈炵泩鍒╁０鏄庯細涓ョ鍟嗕笟鍞崠銆佷粯璐瑰€掑崠鎴栭粦鐏颁骇鐗熷埄锛屼粎渚涙妧鏈弬鑰冦€?
## English

- Aligned with **dsh 0.1.7-rc.1**. The workspace-instruction constant is now `AGENT_INSTRUCTIONS_INTRO`. The sentence is unchanged, and the patch follows it.
- Sandbox `confine()` is now `async confine(argv, policy, signal)`, and the patch matches that function. Passthrough behavior is the same as the previous release.
- Subagent depth lives on `dsh-subagent`. The default moves from 1 to 10. The depth check remains.
- The settings service again exposes the old `register` / `get` methods, so plugins such as `dsh-mnemon` and `dsh-better-reasoning-effort` keep working. Official `describe` / `update` stay. The patch applies once and does not insert itself again on startup.
- Patch text that no longer exists in 0.1.7 is removed, including the extra `dsh-web-fetch-http` dependency on `dsh-base`. The official package already depends on it.
- The four built-in Web presets (standard, ptc, cordis, minimal) lose only the identity sentence. The working-directory suffix, tool lists, `ptc` mode, and minimal's `complete: true` plus `includeRuntimeContext: false` stay.
- When `complete: true`, `prompt-inject.md` is still prepended to that section. A host upgrade or an older hook that drops the section does not drop the inject. After Apply you still click Restart and start a new chat before it enters the session.
- The `dsh-compaction-instant` web client uses `configForms` instead of the removed `settingsScope`, so the page no longer stops on Failed to load plugins.
- Rewind on 0.1.7 created the new session and left the UI on the old chat, so the click looked dead. 0.1.7 has no `sessions.open`. The button now opens the new session with `uiWorkspace.openSession` and puts the previous user line back in the composer. A failure shows on the button.
- The README sponsor block is now a non-profit notice: no commercial resale and no gray-market profit; technical reference only.
