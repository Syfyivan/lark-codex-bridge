# 🌳 Kodama

独立分享用的桌宠仓库。

这份仓库可以单独给别人使用，不要求对方必须采用 `lark-codex-bridge`；它有三种落地方式：

- 只接本地 Claude Code / Codex hooks，当作纯本地桌宠用
- 直接接 `lark-codex-bridge`，开箱即用
- 接任意一个**兼容 Kodama bridge 协议**的本地适配层

如果对方的桥接器不是你的这套实现，关键不在“是不是同一个仓库”，而在“能不能暴露出 Kodama 认识的本地接口”。最小兼容面见 [docs/bridge-compatibility.md](./docs/bridge-compatibility.md)。

住在你代码里的 Live2D 小精灵。当 **Claude Code / Codex** 跑完任务或需要你介入时，它会做动作 + 冒泡提醒你。

> Kodama（こだま / 木霊）= 日本传说中栖息在树上的小精灵，谐音 `code`。

## 运行

```bash
pnpm install
pnpm run setup   # 下载渲染栈 + Live2D 模型到本地（首次必跑，之后离线可用）
pnpm start
```

开发校验：`pnpm run check`（全量语法检查）、`pnpm test`（单测）、`pnpm run pack`（目录包）、`pnpm run dist:mac`（macOS DMG）。

启动后桌宠出现在屏幕右下角：

- 默认只在**很小的图案命中区**接管鼠标，移开即点击穿透（尽量不挡桌面）
- 默认用**右键**触发桌宠/打开设置；设置里可切回左键触发并拖动
- 右键打开面板后，拖动面板标题栏的 `⠿` 可以移动整只桌宠；也可以按住 `⌥/Alt` 后拖动宠物
- 支持贴边半露：拖到屏幕边缘时只要求保留一部分可见，不会完全丢出屏幕；也可在设置里改回严格屏内
- **右键桌宠 / 气泡** 打开事件与设置面板；点击气泡会打开对应会话，多个会话时打开列表
- 支持双击抚摸和可选自动游走；游走默认关闭，避免打扰
- 飞书机器人事件和本地 Agent 事件会以不同颜色的常驻气泡卡片提示，点「忽略」才消失；非事件类提示仍会自动淡出
- 支持**勿扰模式**：事件仍记录、仍喂养，但不弹气泡、不响、不发系统通知；可从面板或菜单栏切换
- 支持声音/系统通知独立开关；重要事件默认有系统通知和短提示音
- 事件面板用 tab 分区，顶部「待交互 / 已完成 / 事件」数字可直接切到对应列表
- 事件面板和菜单栏都有 **Bridge 任务详情**入口：读取 bridge `/task-viewer/tasks.json`，显示任务列表、prompt、最终回复、错误、token、cwd、飞书 chat/message 和完整公开进度时间线
- 支持跨显示器拖动；仍会保证桌宠至少部分可见，不会完全丢出所有屏幕
- **菜单栏 Kodama** → 显示/隐藏、事件 / 配置面板、Bridge 任务详情、勿扰、开机自启、番茄钟、大小、配饰、退出；找不到菜单栏入口时可按 `⌘⌥K` 显示/隐藏、`⌘⌥P` 打开面板，或在本仓库运行 `pnpm run show`

> 渲染栈（PixiJS / pixi-live2d-display / Cubism Core）和示例模型由 `pnpm run setup` 下载到本地 `src/renderer/vendor`、`src/renderer/models`（已 gitignore：Cubism Core 与官方模型受再分发限制，故按需下载而非提交）。下载后运行时**完全离线**。

## 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | 透明置顶窗 + Live2D 模型 + 待机动画 + 拖动 + 点击穿透 | ✅ |
| **P1** | 飞书机器人联动：订阅 `lark-codex-bridge` 的 `/pet/events`(SSE)，把收消息/起任务/进度/回复/完成/失败同步成动作+气泡 | ✅ |
| **P2** | ✅ JSON 动作表 + 来源标签 + 气泡优先级 + 渲染栈/模型本地化(`pnpm run setup`)；⏳ 行为状态机/命中分区 | 🚧 |
| **P3** | ✅ 本地 Claude Code/Codex hook 接收(`source:local`) + 测试/构建/Git 细分事件；⏳ 插件化 | 🚧 |
| **P4** | ✅ 养成核心 + 本地 token 统计/喂食 + 可配置番茄钟/久坐提醒 + 跨源 token 归账 + 配饰/等级解锁 + 打包脚本；⏳ 正式签名/跨平台实机验证 | 🚧 |

开源桌宠能力对标和后续 backlog 见 [`docs/desktop-pet-capability-matrix.md`](docs/desktop-pet-capability-matrix.md)。

## 飞书机器人联动（核心特色）

Kodama 是飞书机器人的"本机分身"——同一个机器人在飞书里收发消息，桌宠在本机同步状态/动作/气泡。同步点在 `lark-codex-bridge` 里，桌宠只订阅、不决策。

```text
飞书消息 → lark-codex-bridge → Codex 执行 / 回复飞书
                            └→ emit pet event → GET /pet/events (SSE) → 桌宠动作+气泡
```

**开启方式**（在 `lark-codex-bridge` 的 `.env`）：

```bash
BRIDGE_HTTP_PORT=8787      # 需开启 HTTP server
PET_SYNC_ENABLED=1
PET_SYNC_MODE=safe         # safe=脱敏+截断摘要(默认推荐)；full=本机 owner 看完整内容
```

桌宠启动后自动连 `http://127.0.0.1:8787/pet/events`，bridge 没开也不影响桌宠独立运行（EventSource 会自动重连）。事件→反应映射在 `src/renderer/agent-sync.js`。

> bridge 改了端口或地址？`cp src/renderer/config/agent.local.example.js src/renderer/config/agent.local.js`，在里面写 `bridgeUrl`（和可选 `token`）。该文件 gitignore。
>
> bridge 不是 `lark-codex-bridge` 也没关系，只要它在本机 loopback 上兼容 Kodama 的接口层即可。协议说明见 [docs/bridge-compatibility.md](./docs/bridge-compatibility.md)。

**事件类型**：`lark_message_received`（看手机）/ `task_started`（开工）/ `task_progress`（进度）/ `lark_reply_sent`（回复摘要）/ `task_waiting`（待交互）/ `agent_done`（子 Agent 完成）/ `task_done`（撒花）/ `task_failed`（报错）。

菜单栏 Kodama 的「事件 / 配置面板」会保留最近事件、待交互项、Agent 完成项、可跳转会话和当前 bridge/hook 状态；气泡错过时可以从这里回看。气泡本身可点击：只有一个可跳转会话时直接打开；多个会话时打开列表。当前优先跳到飞书 chat，若事件 payload 将来带明确 URL，会优先打开该 URL。

如果要看飞书机器人一次任务的完整过程，打开「Bridge 任务详情」：

- 桌宠右键 →「事件 / 配置」→「Bridge 任务详情」或 Bridge tab 里的「完整详情」
- 菜单栏 Kodama →「Bridge 任务详情」
- 终端：`pnpm run bridge-tasks`
- 本地控制口：`http://127.0.0.1:7766/pet/bridge-tasks`

Kodama 会在主进程里用 `~/.lark-codex-bridge-http-token` 或 `agent.local.js` 的 token 访问 bridge，不会把 token 放进浏览器 URL。详情页显示的是 bridge 记录的安全摘要和公开进度，不包含隐藏推理或原始工具输出；分享按钮走 bridge 的 `/v1/bridge/task-viewer/share`，生成 Goofy 静态任务页并复制链接。

## 本地 Claude Code / Codex 联动（source: local）

一只桌宠，两个来源：除了飞书机器人（`source:lark`），本地终端里跑的 Claude Code / Codex 也能同步（`source:local`）。桌宠主进程在 `127.0.0.1:7766` 起了个接收口，把 CC 的 hook 事件转成桌宠反应。

在 `~/.claude/settings.json` 配 hook（任务完成 / 需要确认时通知桌宠）：

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:7766", "timeout": 2 }] }],
    "Notification": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:7766", "timeout": 2 }] }]
  }
}
```

映射规则在 `src/main/hook-events.js` 的 `mapHookToEvent`：`Stop`→完成撒花、`Notification/permission_prompt`→需要你确认、`UserPromptSubmit`→开工。也识别 `PermissionRequest` / `SubagentStart` / `SubagentStop` / `TaskCreated` / `TaskCompleted` / `TeammateIdle` / `PreToolUse` / `PostToolUse`，用于更细的本地 Agent / Agent Team 交互提示。Bash/Shell 命令里会额外识别 `test`、`build/typecheck/lint`、`git`，失败时直接显示测试失败、构建失败或 Git 操作失败。气泡会带 `💻 本地` 前缀，和飞书的 `💬 飞书` 区分。

接收口只绑 `127.0.0.1`、要求 `Content-Type: application/json`、body 上限 64KB。需要更强隔离时设环境变量 `KODAMA_HOOK_TOKEN=xxx` 启动，并在 hook 里加 `"headers": { "X-Kodama-Token": "xxx" }`。

> ⚠️ 没配这个 hook，本地 Claude Code 完成时桌宠**不会有任何反应**——这是最常见的"没提示"原因。配置后重启 Claude Code 生效。
>
> 重要事件（完成 / 需确认 / 失败 / 番茄钟完成）除了桌宠气泡，还会发**系统通知（弹窗 + 声音）**，不容易错过。哪些事件弹由 `pet-config.js` 的 `notify` 字段控制。

**本地 Codex**：Codex 没有 hooks，但有 `notify` 配置。在 `~/.codex/config.toml`：

```toml
notify = ["/abs/path/to/kodama/scripts/codex-notify.sh"]
```

`scripts/codex-notify.sh` 把 Codex 的 `agent-turn-complete` 负载转发到 7766（`mapHookToEvent` 识别 `type` 字段 → `task_done`）。若你 `notify` 已被别的程序占用，该脚本支持**链式转发**（先调原程序、再通知桌宠），改脚本里的 `ORIG` 路径即可。

## 大小 / 全屏

托盘菜单「大小」可选 很小 / 小 / 中 / 大（持久化到 `userData/kodama-window.json`，桌宠按窗口自适应缩放）。右键面板还能实时调「图案大小」「透明度」「点击范围」「触发方式」「贴边」「抚摸」「游走」「气泡位置」「面板位置」「气泡高度」「气泡间距」，设置存在 Electron 本地存储里，并支持复制/粘贴配置 JSON。

默认窗口是 `280x400`，图案默认 `72%`、透明度 `82%`、命中框 `35%`，气泡/面板默认贴近宠物但不压住宠物，贴边默认允许半露。旧版本地配置会迁移一次，避免继续沿用过大的窗口和透明边界命中。

窗口用 `screen-saver` 层级 + `visibleOnFullScreen` 并在 show 时重申，尽量浮在其它 App 全屏之上；macOS 上若个别全屏仍压不住，后续可接 `electron-panel-window`（NSPanel）彻底解决。

## 重启 / 热更新

- 改右键面板里的设置：**实时生效**，不用重启。
- 改 Kodama 的 `src/main` / `src/renderer` 代码：需要**重启桌宠**，当前没有热更新。
- 改 `lark-codex-bridge` 代码、`.env`、LaunchAgent：需要**重启桥接器**；只是在飞书里收发消息不需要重启。
- 改 `~/.claude/settings.json` 或 Codex hook/notify 配置：需要重启对应的 Claude Code / Codex 会话，桌宠和桥接器不一定要重启。

常用健康检查：

```bash
curl http://127.0.0.1:7766/healthz          # Kodama 本地 hook
curl http://127.0.0.1:7766/pet/token-stats  # 本地+飞书 token 合并账本
curl http://127.0.0.1:8787/pet/state        # bridge → Kodama SSE 状态
```

隐藏后恢复：

```bash
pnpm run show       # 显示桌宠；如果桌宠没启动，会先启动
pnpm run panel      # 显示桌宠并打开事件 / 配置面板
pnpm run bridge-tasks # 打开 Bridge 完整任务详情页
pnpm run hide       # 隐藏桌宠
pnpm run toggle     # 显示/隐藏切换
pnpm run tokens     # 查看本地+飞书 token 合并账本
pnpm run token:test # 注入一笔 Feishu token 测 Kodama 侧进账链路
```

也可以直接访问本地控制接口：`http://127.0.0.1:7766/pet/show`、`/pet/panel`、`/pet/bridge-tasks`、`/pet/hide`、`/pet/toggle`。

## 动作表（改配置不改代码）

事件 → 状态/动作/气泡的映射全在 `src/renderer/config/pet-config.js`，模板变量 `{icon}`/`{label}`/`{text}`。加新反应只改这张表，逻辑代码（`reactions.js`）不动。两个来源共用同一张表、同一个 `reactToEvent` 入口。

## 渲染后端：公开 Live2D / 私人 GIF

桌宠的窗口、穿透、拖拽、agent 同步、动作表全部与"用什么渲染"无关，所以支持两套后端：

| 后端 | 用途 | 形象 | 提交/分发 |
|------|------|------|-----------|
| **Live2D**（默认） | 对外、给别人用 | 官方免费可商用模型（Wanko/Rice/Mark） | ✅ 干净可分发 |
| **GIF/序列帧** | 自己用、不公开 | 任意 GIF（如水豚噜噜） | ❌ gitignore，永不提交/分发 |

切到私人 GIF 后端：

```bash
cp src/renderer/config/render.local.example.js src/renderer/config/render.local.js
# 把 GIF 丢进 src/renderer/pets/capybara/（至少 idle.gif，详见该目录 README）
pnpm start
```

`render.local.js` 和 `src/renderer/pets/*` 已 gitignore——私人（可能有版权的）GIF 只在本机用，不会进仓库或分发包；删掉 `render.local.js` 即回到公开的 Live2D。

## 养成系统（P4）

桌宠会"长大"：每个 agent 事件都会喂食它。

- **喂食/经验**：事件按 `src/renderer/growth.js` 的 `GAINS` 表加 🍖饱食 与 ⭐经验（`task_done` 给得最多）。
- **升级**：经验过阈值自动升级，触发升级气泡 + 动作表演。
- **状态持久化**：`{ level, exp, food, totalFed, unlockedAccessories, equippedAccessories }` 存在主进程的 `userData/kodama-state.json`，经 preload 的 `getState/saveState`。
- **查看**：点一下桌宠显示 `Lv.N · 🍖food · ⭐exp/next`。

## 配饰 / 换装（P4）

配饰不是换整只模型，而是叠在同一角色上的独立图层。公开版内置配饰用 CSS 画出来，不携带第三方素材；私人 GIF 版仍可继续用本机 gitignored 素材。

- **配置**：`src/renderer/config/accessories.js` 定义 `slot`、名称、解锁等级和相对角色 bounds 的定位。
- **本地覆盖**：复制 `src/renderer/config/accessories.local.example.js` 为 `accessories.local.js`，可按模型/GIF 单独调坐标或增加本机私有配饰；该文件 gitignore，不进公开包。
- **渲染**：`src/renderer/accessories.js` 只做透明窗内 overlay，跟 Live2D/GIF 后端解耦。
- **解锁**：升级时按等级自动把配饰写入 `unlockedAccessories`。
- **佩戴**：托盘菜单「配饰」按槽位选择；锁住的配饰会显示所需等级。

## 番茄钟 + 久坐提醒（P4）

- **状态机**在主进程 `src/main/pomodoro.js`：`idle → focus → short/long_break`，暂停是标志位不是独立状态，逻辑用 `tick()` 驱动（好测）。
- **时长配置**在右键面板：专注、短休、长休、长休间隔、久坐提醒都可改，写入 `userData/kodama-pomodoro.json`，无需重启。默认仍是 25/5/15 分钟、每 4 轮长休、45 分钟久坐提醒。
- **控制**走托盘菜单：开始 / 暂停·继续 / 放弃；菜单栏标题显示倒计时 `🍅 24:59`。
- **联动**：进入各阶段经 `pet-notify` 让桌宠换状态+冒泡；**完成一个番茄 → 发 `pomodoro_completed` 事件**走和 agent 事件同一条 `handleAgentEvent → feed` 喂食链路（+20🍖/+50⭐）。**放弃不给奖励**（损失厌恶，不扣分）。
- **久坐提醒**：独立计时，非休息时段轻提醒"起来走走~"；设置为 0 即关闭。

## Token 用量与喂食（P4）

桌宠会因为你"用 token"而长大——这也是本项目的核心新意（跨来源统一归账）的本地半边。

- **取数**：主进程 `src/main/token-usage.js` 读本地 JSONL —— Claude Code(`~/.claude/projects`，读 `message.usage`) + Codex(`~/.codex/sessions`，尽力解析)，按天聚合。
- **统计**：托盘菜单显示「今日 token / 近 7 天」，点桌宠显示「今日 X tok」。IPC `pet:token-stats` 返回 `{today,last7,total,byDay}`。
- **喂食**：`growth.js` 的 `feedTokens(total)` 首次只记基线（不把历史用量一次性灌成升级），之后按 token 增量喂食（默认每 2000 token = 1 🍖）。
- ⚠️ JSONL 的 token 数是**近似值**（缓存 token、字段缺失会导致与官方计量有偏差），够用来"喂宠物 + 看大致用量"，不是账单级精度。
- **跨源归账（Kodama 侧已就绪）**：飞书事件带 `tokens` 即并入独立的 lark 账本（`userData/kodama-lark-tokens.json`），与本地合并出「今日/近7天/总量 + 本地/飞书明细」（托盘 + 点击桌宠显示）。因 bridge 用 `--ephemeral`（飞书 Codex 不落本地 `~/.codex`），相加不会重复计数。**bridge 侧已接通**：app-server 从 completed turn 取 `turn.usage` → `task_done` 事件带 `tokens` → 桌宠并入飞书账本。先用 `pnpm run token:test` 验 Kodama 侧链路；真实飞书任务后再用 `pnpm run tokens` 看飞书栏是否自然增长。若一直 0，多半是 `turn.usage` 字段名不同，bridge 的 `raw.usage` 留了原始结构可核对。

## 打包 / 自启 / 跨平台

- **开发态启动**：`pnpm start` 或 `pnpm run start:detached`。
- **开机自启**：菜单栏 Kodama →「开机自启」。开发态会用当前 Electron + app 路径注册；打包后用应用自身注册。
- **macOS 包**：`pnpm run pack` 生成目录包，`pnpm run dist:mac` 生成 `.dmg`。当前默认未签名；公开分发前需要 Developer ID 签名和 notarization。
- **Windows/Linux**：已放 `dist:win` / `dist:linux` 配置，但置顶、托盘、穿透和安装器还需要对应平台实机验证。

## 架构

```
src/
  main/        Electron 主进程（窗口、置顶、穿透、托盘、拖拽 IPC）
    index.js
    preload.js
  renderer/    渲染层（PixiJS + Live2D，行为逻辑）
    index.html
    renderer.js
    style.css
```

设计原则：**引擎与资产分离**。动作/台词将由 JSON 配置表驱动（P2），加新反应只改配置 + 换资产，不动逻辑代码。

## 技术选型

- 窗口壳：Electron（透明无边框 + `screen-saver` 置顶 + `setIgnoreMouseEvents` 穿透）
- 渲染：PixiJS 6 + pixi-live2d-display（Cubism 4）
- 模型：Live2D 官方原创 Sample（当前为 Haru）

## 授权 / 署名

本项目示例使用 Live2D Inc. 拥有版权的官方示例模型：

> This content uses sample data owned and copyrighted by Live2D Inc.

- Live2D Cubism Core 为 Live2D Inc. 专有，受其许可协议约束，禁止逆向、禁止单独再分发。
- 商用前需确认所用模型授权与 Cubism SDK 授权（小团队年营收 < 1000 万日元通常免费）。
