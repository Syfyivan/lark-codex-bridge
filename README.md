# 🌳 Kodama

住在你代码里的 Live2D 小精灵。当 **Claude Code / Codex** 跑完任务或需要你介入时，它会做动作 + 冒泡提醒你。

> Kodama（こだま / 木霊）= 日本传说中栖息在树上的小精灵，谐音 `code`。

## 运行

```bash
pnpm install
pnpm run setup   # 下载渲染栈 + Live2D 模型到本地（首次必跑，之后离线可用）
pnpm start
```

开发校验：`pnpm run check`（全量语法检查）、`pnpm test`（reaction/config 单测）。

启动后桌宠出现在屏幕右下角：

- **鼠标移到它身上**才可交互，移开即点击穿透（不挡桌面）
- **按住拖动**可以挪位置
- **菜单栏 🌳 图标** → 退出

> 渲染栈（PixiJS / pixi-live2d-display / Cubism Core）和示例模型由 `pnpm run setup` 下载到本地 `src/renderer/vendor`、`src/renderer/models`（已 gitignore：Cubism Core 与官方模型受再分发限制，故按需下载而非提交）。下载后运行时**完全离线**。

## 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | 透明置顶窗 + Live2D 模型 + 待机动画 + 拖动 + 点击穿透 | ✅ |
| **P1** | 飞书机器人联动：订阅 `lark-codex-bridge` 的 `/pet/events`(SSE)，把收消息/起任务/进度/回复/完成/失败同步成动作+气泡 | ✅ |
| **P2** | ✅ JSON 动作表 + 来源标签 + 气泡优先级 + 渲染栈/模型本地化(`pnpm run setup`)；⏳ 行为状态机/命中分区 | 🚧 |
| **P3** | ✅ 本地 Claude Code/Codex hook 接收(`source:local`)；⏳ 构建/测试/Git 联动、插件化 | 🚧 |
| **P4** | 养成系统：token 消耗→喂食→经验→升级→解锁皮肤/动作表演；番茄钟 + 久坐提醒；本地项目任务 | ⏳ |

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

**事件类型**：`lark_message_received`（看手机）/ `task_started`（开工）/ `task_progress`（进度）/ `lark_reply_sent`（回复摘要）/ `task_done`（撒花）/ `task_failed`（报错）。

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

映射规则在 `src/main/index.js` 的 `mapHookToEvent`：`Stop`→完成撒花、`Notification/permission_prompt`→需要你确认、`UserPromptSubmit`→开工。气泡会带 `💻 本地` 前缀，和飞书的 `💬 飞书` 区分。

接收口只绑 `127.0.0.1`、要求 `Content-Type: application/json`、body 上限 64KB。需要更强隔离时设环境变量 `KODAMA_HOOK_TOKEN=xxx` 启动，并在 hook 里加 `"headers": { "X-Kodama-Token": "xxx" }`。

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
