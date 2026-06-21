# Kodama + Bridge 优化蓝图

> 滚动更新的改进蓝图。完成项打勾并标注 commit。开源参考见文末。
> 最近更新:2026-06-21。

## ✅ 已完成
- [x] 桌宠浮在别的 App 原生全屏之上(`type:'panel'` + `setActivationPolicy('accessory')` + LSUIElement)。`36d8e8e`
- [x] 终端跳转用 cmux CLI 按 tty 精确 `select-workspace/focus-pane`,不再误开新 cmux。`dc47bb6`
- [x] 桌宠改全工作区透明穿透覆盖层:可贴屏幕边缘(半露 clamp 尊重 edgeMode)、气泡边缘自适应不再被裁、贴近可见核心;大小改为缩放。`fc90de2` `50c71f3` `0c39f35`
- [x] 已完成会话也能跳回终端:活着时缓存 `sessionId→tty`(claude argv 带 `--session-id`,活跃直接命中;完成后用缓存)。`7cacc5f`
- [x] 子 Agent:sessions 列表单列 + 父子层级 + 单独分享(走 session-share);气泡不拆(整段当一个会话)。`e446691` `1b5270f`
- [x] 独立「管理 / 设置中心」窗口(外观/行为/番茄钟/只读统计),经 main 缓存与桌宠同步。`c8229e3`
- [x] task-viewer 分享改 per-shareId 多链接不覆盖(根治「分享单任务却看到一大块/别的会话」)。`2e93075`
- [x] 博客:开发笔记 12/13 + 知识点 01/02/03(均在 `blog/kodama-12...` 分支)。

## ⏳ 待你的环境验证(代码已就绪)
- [ ] **重启 launchd 桥接器** + 联网点一次分享,验证 #8 的 Goofy per-shareId 产物。
- [ ] 桌宠各项肉眼验收(全屏/贴边/气泡距离/子 Agent 分享/完成会话跳转)。
- [ ] 决定推送代码 / 合并发布博客。

## P1 — 还能做的功能
- [x] **一键注册 Claude Code Hook**(参考 [clawd-on-desk]):托盘按钮,安全合并(备份+只追加+幂等)进 `~/.claude/settings.json`,补齐缺失的失败/细粒度事件;不覆盖已有 hook。`4ae8c56`
- [x] **更细粒度事件**:测试/构建/Git 的 正在跑/完成/失败(commandEvent 已实现,去噪后纳入注册)。`4cbf9b5`
- [ ] **更广 agent 覆盖**(参考 [clawd-on-desk] 支持十几家):识别 Cursor / Gemini CLI / Copilot CLI / opencode 的 hook/会话 —— *需各家 hook 规格,暂缺、待补*。
- [ ] **GIF 后端覆盖层定位适配**(当前仅 Live2D 适配 petX/petY)——低优先(默认用 Live2D)。
- [ ] **task-viewer 单任务渲染更"干净"**:目前是任务时间线样式;可做成单会话对话回放视图(bridge+Goofy,需联网验证)。
- [ ] **多显示器 / 全屏切换回归**:覆盖层在外接屏、Space 切换下的位置与穿透验证(需你的硬件)。

## P2 — 增强 / 差异化(参考开源)
- [ ] **上下文感知**(参考 [Live2DPet]):截屏 / 活动窗口感知,桌宠按你在干嘛说更贴切的话(纯本地、可关、隐私优先)。
- [ ] **语音 TTS/ASR**(参考 [Open-LLM-VTuber] / [petto]):关键事件语音播报(完成/待确认),可选语音指令。
- [ ] **表情 / 动作管理**(参考 [petto]):事件→表情/动作映射的可视化配置。
- [ ] **插件 SDK + MCP**(参考 [openpets]):反应/事件源/配饰做成可插拔插件,甚至暴露 MCP server。
- [ ] **换装/配饰系统完善**:按等级解锁、托盘佩戴、持久化(素材需免费可商用)。
- [ ] **打包发布 + 开机自启**:.dmg/.exe(electron-builder 已配 LSUIElement),一键安装器。
- [ ] **跨平台**:Windows/Linux 的置顶、穿透、托盘、全屏行为系统验证(当前主要 macOS)。

## 桥接器侧
- [ ] 按 profile 的 per-群后端切换(某群走我 / 其它走 Codex)——getRunner 已读 config.backend,给 profile 加 backend 覆盖字段即可。
- [ ] 参考同事 `code.byted.org/novel/codex-feishu-bridge`(relay / 白名单 / 会话分享)做对照增强。

## 开源参考
- [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) — 像素桌宠盯 AI coding agents,**启动自动注册多家 agent hook**,agent 覆盖广。
- [openpets](https://github.com/alvinunreal/openpets) — 桌宠平台,**Plugin SDK + 官方插件 + MCP stdio server + hooks/memory**。
- [Live2DPet](https://github.com/x380kkm/Live2DPet) — **截屏 + 窗口感知**生成陪伴对话,VOICEVOX TTS。
- [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) — 本地 LLM + ASR/TTS + Live2D,**语音交互**,跨平台。
- [petto](https://github.com/funnycups/petto) — Live2D 助手,**表情/动作管理**、定时问候、语音。
- [narze/live2d-electron](https://github.com/narze/live2d-electron) — Electron 跑 Live2D 的最小参考(macOS)。

[clawd-on-desk]: https://github.com/rullerzhou-afk/clawd-on-desk
[openpets]: https://github.com/alvinunreal/openpets
[Live2DPet]: https://github.com/x380kkm/Live2DPet
[Open-LLM-VTuber]: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
[petto]: https://github.com/funnycups/petto
