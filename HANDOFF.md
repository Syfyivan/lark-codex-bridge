# Kodama 交接文档（HANDOFF）

> 给接手的 Agent：读完本文件即可继续开发。所有路径为绝对路径或相对 `kodama` 仓库根。

## 1. 这是什么

**Kodama** = 一只 Live2D 桌面宠物（Electron），是用户飞书机器人的"本机分身"：把**飞书机器人的 AI 交互**和**本地编码 Agent（Claude Code / Codex）的活动**统一同步成一只会动、会提醒、会养成的桌宠。

**核心新意（已做 prior-art 核查）**：桌宠 / 养成 / token 统计 / 飞书桥单拎都是红海；唯一空白 = **"本地 agent 活动 + 飞书机器人 AI 交互 两条来源统一追踪 + 跨源 token 归账"**。护城河押这里，开发时优先保护这条主线。

用户背景：番茄小说前端，无 UI/美术经验。这最初是课设，已长成个人项目。回复用中文，代码注释英文。

## 2. 两个仓库（保持独立，SSE 松耦合，**勿擅自合并**）

| 仓库 | 路径 | 角色 |
|------|------|------|
| kodama | `/Users/bytedance/code/kodama` | 桌宠 Electron app（本仓库）。本地 git，**无远程** |
| lark-codex-bridge | `/Users/bytedance/code/lark-codex-bridge` | 用户已发布的 npm 工具（零依赖、可服务器跑）。GitHub: `Syfyivan/lark-codex-bridge`。里面只放了"连接胶水"，不放桌宠本体 |

**已定决策**：不融成一个包（会毁掉 bridge 的轻量/服务器可部署）。要"连上就开桌宠"用 `PET_AUTOLAUNCH`（bridge 可选 spawn 独立桌宠进程）。monorepo 是**未来可选项**（待事件契约频繁变或要做成一个产品时，新建 umbrella 仓库 + `git subtree` 迁移 + `packages/shared`，**不要把桌宠塞进 bridge 现有仓库**）。

## 3. 架构与数据流

```
飞书消息 → lark-codex-bridge → 跑 Codex（--ephemeral，不落本地 ~/.codex）
   bridge emitPet(事件, {tokens})  ──SSE──► GET 127.0.0.1:8787/pet/events
                                                  │ (source: 'lark')
本地 Claude Code hooks ──curl──► POST 127.0.0.1:7766 ─┐
本地 Codex notify ──转发脚本──► POST 127.0.0.1:7766 ──┤ (source: 'local')
                                                       ▼
                              Kodama: 统一 handleAgentEvent
                                ├ reactToEvent → 动作 + 气泡 + 系统通知
                                ├ feedGrowth → 养成（喂食/升级）
                                └ source=lark 带 tokens → 并入飞书 token 账本
```

端口：bridge HTTP **8787**（SSE）、桌宠本地 hook 接收口 **7766**。

## 4. 功能状态（已完成 P0–P4）

- **P0**：透明置顶穿透窗 + PixiJS/Live2D + JS 拖拽 + 托盘
- **P1**：bridge `pet-event-bus` + 6 埋点 + `/pet/events`(SSE)/`/pet/state`；Kodama EventSource 订阅。默认关，零影响
- **P2**：动作表配置驱动 + 来源标签(💬飞书/💻本地) + 气泡优先级；**可插拔渲染后端**（公开 Live2D / 私人 GIF）；`pnpm run setup` 离线下载渲染栈+模型；模型动作组自适应
- **P3**：本地 hook 接收口（Content-Type 校验 + 64KB 上限 + 可选 `KODAMA_HOOK_TOKEN`）
- **P4**：养成核心（喂食/经验/升级/持久化）、本地 token 统计/喂食、番茄钟+久坐、**跨源 token 归账**
- **收尾**：系统通知（弹窗+声音）、本地 Codex notify（链式转发）、全屏置顶重申、托盘调大小、bridge `PET_AUTOLAUNCH`

## 5. 关键文件地图

**kodama/src/main/**
- `index.js` — 窗口(透明/置顶/穿透/`reassertTopmost`/调大小)、托盘(番茄钟控制+token+「大小」)、本地 hook 接收口(7766, `mapHookToEvent` 同时认 CC 的 `hook_event_name` 和 Codex 的 `type`)、番茄钟接线、token IPC + lark 账本、growth 状态 IPC、窗口尺寸持久化
- `preload.js` — 暴露 `setIgnoreMouse/move/onAgentEvent/getState/saveState/tokenStats/addLarkTokens/onNotify`
- `pomodoro.js` — 番茄钟状态机（纯逻辑 + `tick()` 驱动，可测）
- `token-usage.js` — 读 `~/.claude/projects` + `~/.codex/sessions` JSONL，`usageByDay`/`summarizeByDay`/`summarize`（接受 root/now 参数便于测试）

**kodama/src/renderer/**
- `renderer.js` — 编排：选后端(Live2D/gif)、窗口交互(命中/拖拽/穿透)、气泡(浮头顶)、agent-sync、growth、token 轮询
- `agent-sync.js` — SSE 客户端 → `onEvent`（透传 tokens；bridgeUrl 可经 agent.local.js 覆盖）
- `reactions.js` — 事件 → 反应（气泡/动作/状态 + `notify:true` 触发原生系统通知），气泡优先级守护
- `growth.js` — `feed(type)` / `feedTokens(total)`（首次记基线，之后按增量）/ 升级
- `backends/gif.js` — GIF 渲染后端（img 按 status 切）
- `config/pet-config.js` — **动作表**（事件→状态/动作/气泡/notify/priority），加反应改这里
- `config/render.local.example.js` — 复制为 `render.local.js` 启用私人 GIF 后端
- `config/agent.local.example.js` — 复制为 `agent.local.js` 改 bridge 地址/token
- `index.html` / `style.css`

**kodama/scripts/**
- `setup-assets.mjs`（`pnpm run setup [wanko|rice|mark|haru]`）下载渲染栈+模型到 gitignored `vendor/`、`models/`
- `check.mjs`（`pnpm run check` 全量语法）、`codex-notify.sh`（Codex notify 链式转发）

**lark-codex-bridge/**（连接胶水）
- `src/pet-event-bus.mjs` — 无依赖事件总线（环形缓冲+SSE 订阅+replay）
- `lark-codex-bridge.mjs` — `emitPet()`(默认 source=lark，SAFE 脱敏)、6 埋点、`/pet/events`+`/pet/state`、`handlePetEventStream`、`maybeLaunchPet`(PET_AUTOLAUNCH)、token：`buildReply` 经 `options.usageRef` 带出 + `src/codex-app-server.mjs` `run()` 取 `turn.usage`
- `.env.example` — `PET_SYNC_*` / `PET_AUTOLAUNCH` / `PET_COMMAND` / `PET_CWD`

## 6. 本机配置改动（非仓库，已改好）

- `~/.claude/settings.json`：`Stop` + `Notification` 各加一条 `curl ... 127.0.0.1:7766`（保留了原有 VibeBuddy/Flux Island hook）。**改后需重启 Claude Code 生效**
- `~/.codex/config.toml`：`notify = ["/Users/bytedance/code/kodama/scripts/codex-notify.sh"]`（脚本链式调用用户原 Computer Use + 通知桌宠）
- bridge `.env`（用户自己配）：`PET_SYNC_ENABLED=1`、可选 `PET_AUTOLAUNCH=1` + `PET_CWD=/Users/bytedance/code/kodama`

状态文件（Electron userData 目录）：`kodama-state.json`(养成)、`kodama-lark-tokens.json`(飞书token账本)、`kodama-window.json`(窗口尺寸)。

## 7. 怎么跑 / 测（重要：改完必须重启）

```bash
cd /Users/bytedance/code/kodama
pnpm install
pnpm run setup        # 首次：下载渲染栈+模型（gitignored）
pnpm start            # 启动桌宠
pnpm run check        # 全量语法检查
pnpm test             # 16 个单测（reactions/growth/token-usage/pomodoro）
```

**测试清单**（务必先重启 Kodama + 重启 Claude Code）：
1. 本地 CC / Codex 跑完 → 弹系统通知 + 桌宠「💻 本地搞定啦」
2. 飞书 @ 机器人 → 「💬 飞书…」+ 托盘「飞书 token」进账
3. 全屏 App 之上能否看到桌宠
4. 托盘「大小」调小；点桌宠看 `Lv·🍖·⭐·今日 tok`
5. 番茄钟（托盘 🍅）

## 8. 待办 TODO（优先级从上到下）

**待验证（用户测，可能要小修）**
- [ ] 飞书 token 是否进账：若一直 0，多半 `turn.usage` 字段名不同 → 看 bridge 返回的 `raw.usage` 结构，调 `src/codex-app-server.mjs` 里的 tokens 提取（目前兜底 input/output/cached_*_tokens）
- [ ] 全屏覆盖：若个别全屏 App 仍压不住 → 接 `electron-panel-window`（把窗口变 NSPanel，彻底解决，代价是加原生依赖）

**功能**
- [ ] **换装/配饰系统**（下一个要做）：同一角色叠帽子/眼镜等**配饰图层**（不是换模型），按等级解锁 + 托盘佩戴 + 持久化。设计参考：VPet/DyberPet 的"全量内置 + 解锁名单门控"；状态加 `unlockedSkins[]`，升级时按阈值表 push。**需素材**：公开版用免费可商用配饰图；私人水豚 GIF 版用户自备
- [ ] 私人水豚 GIF：用户把 GIF 放进 gitignored `src/renderer/pets/capybara/` + 复制 `render.local.js`
- [ ] 番茄钟/久坐时长配置化（目前写死 25/5/15、45min）

**打包 / 公开发布（自用 → 给大家）**
- [ ] 给 kodama 建 GitHub 远程并推送（现无远程）
- [ ] 打成 `.dmg`/`.exe` 安装包
- [ ] 跨平台适配（Win/Linux 的托盘/置顶/穿透；现偏 macOS）
- [ ] 公开版用免费可商用配饰/模型；私人 GIF 不进发布包；保留 Live2D 署名

**工程 / 组织**
- [ ] （可选，暂缓）monorepo + `shared` 契约包 —— 见 §2，待契约频繁变或做成一个产品时再做
- [ ] （可选）token 精度：JSONL 是近似值，要精确需走代理拦截

## 9. 易踩的坑 / 已知约定

- **改完任何 main/renderer 代码都要重启 Kodama**；改 settings.json 要重启 Claude Code
- CSP 需 `unsafe-eval`（PixiJS v6 着色器）+ `file:`（本地模型 XHR）；`connect-src` 限回环
- Live2D 模型动作组名各异（Haru=`Tap`、Wanko=`TapBody`）→ `resolveGroup` 自适应，pet-config 里写逻辑名 `Idle`/`Tap`
- 合规：Cubism Core、Live2D 模型、私人 GIF、`render.local.js`/`agent.local.js` 全 **gitignore**，不进公开仓库
- bridge 用 `--ephemeral`，飞书 Codex **不落本地 `~/.codex`**，所以本地+飞书 token 直接相加**不会重复**
- 错误兜底：index.html 有 `window.onerror → 气泡`，渲染层任何错误会冒「⚠️」气泡而非白屏

## 10. 关键提交

- **kodama**：`fcb6d1d` 初始 → `2be3012` 双后端 → `82ea541` 加固 → `07b116a` 养成 → `1a17a98` token → `6db07c9` 番茄钟 → `352fc52` 跨源接收端 → `b3062e6` 系统通知 → `018cc43` Codex/全屏/大小
- **bridge**：pet 同步(进 `d17131d`) → `4c6b8aa` token 上报 → `c590adc` PET_AUTOLAUNCH
- **博客**（`Syfyivan.github.io`，推 main 经 Actions `pages.yml` 自动发布）：2 篇已上线（飞书分身踩坑、可插拔渲染后端/CSP/版权）
