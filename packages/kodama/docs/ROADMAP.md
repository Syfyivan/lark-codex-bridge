# Kodama + Bridge 优化蓝图

> 维护说明:这是滚动更新的改进蓝图。完成项打勾并标注 commit。开源参考见文末。
> 最近更新:2026-06-21。

## 已完成(本轮)
- [x] 终端跳转优先用 cmux CLI 精确聚焦会话(按 tty 匹配 workspace/pane),不再误开新 cmux;sessionId 不在 argv 时用 lsof 按 cwd 兜底匹配。`dc47bb6`
- [x] 核验桥接器分享:气泡走 session-share(每会话独立稳定链接、累积不覆盖);面板走 task-viewer(支持 scope 过滤,但共用固定 alias、会覆盖)。
- [x] 桌宠改全工作区透明覆盖层:可贴屏幕边缘、气泡边缘自适应不再被裁;大小改为缩放桌宠。`fc90de2`(待肉眼验证)

## P0 — 正确性 / 体验硬伤
- [ ] **子 Agent 会话单独展示**(#7):气泡里不拆(整段当一个会话);桌宠 session 列表 + Bridge 详情页里子 Agent 单独成条,标清父子级层级。跳转/分享按 session 粒度。
- [ ] **覆盖层重构回归验证**:多显示器、全屏切换、GIF 后端层内定位适配(当前仅 Live2D 适配)。
- [ ] **自动注册 agent hooks**(参考 clawd-on-desk):现在要手动改 `~/.claude/settings.json` 指到 7766。应做成启动时自动检测并注入 Claude Code / Codex 的 hook(幂等、可卸载),免去手动配置。

## P1 — 功能补全
- [ ] **完整管理页**(#4):独立窗口/网页,集中管理外观(大小/透明度/触发键/边缘/置顶)、养成(等级/食物/配饰佩戴)、番茄钟、token 统计、事件/任务、bridge 连接状态。参考 openpets 的设置中心、petto 的表情/动作管理。
- [ ] **task-viewer 分享改 per-shareId**(#8):像 session-share 那样按 shareId 生成子路径、累积保留,实现多链接不可变归档(当前固定 alias + --override 覆盖)。
- [ ] **更广的 agent 覆盖**(参考 clawd-on-desk):除 Claude Code / Codex,识别 Cursor / Gemini CLI / Copilot CLI / opencode 等的 hook 或会话,统一进事件流。
- [ ] **更细粒度事件**:正在跑测试 / 测试失败 / git 操作 / 构建失败 等(现仅 task_started/progress/done/failed/waiting)。

## P2 — 增强 / 差异化
- [ ] **上下文感知**(参考 Live2DPet):截屏 / 活动窗口感知,桌宠根据你在干嘛说更贴切的话(注意隐私,纯本地、可关)。
- [ ] **语音**(参考 Open-LLM-VTuber / petto):TTS 播报关键事件(任务完成 / 待确认),可选 ASR 语音指令。
- [ ] **插件 SDK**(参考 openpets):把反应/事件源/配饰做成可插拔插件,社区可扩展。
- [ ] **换装/配饰系统完善**:按等级解锁、托盘佩戴、持久化(素材需免费可商用)。
- [ ] **打包发布**:.dmg / .exe(electron-builder 已配 LSUIElement),开机自启一键安装。
- [ ] **跨平台**:Windows / Linux 的置顶、穿透、托盘、全屏行为系统验证(当前主要按 macOS)。

## 桥接器侧
- [ ] task-viewer 多链接(同 #8)。
- [ ] 按 profile 的 per-群后端切换(某群走我 / 其它走 Codex)——getRunner 已读 config.backend,给 profile 加 backend 覆盖字段即可。
- [ ] 参考同事 `code.byted.org/novel/codex-feishu-bridge` 的实现做对照(relay / 白名单 / 会话分享)。

## 开源参考
- [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) — 像素桌宠盯 AI coding agents,**启动自动注册多家 agent hook**,agent 覆盖广。
- [openpets](https://github.com/alvinunreal/openpets) — 桌宠平台,**Plugin SDK + 官方插件 + MCP stdio server + hooks/memory**。
- [Live2DPet](https://github.com/x380kkm/Live2DPet) — **截屏 + 窗口感知**生成陪伴对话,VOICEVOX TTS。
- [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) — 本地 LLM + ASR/TTS + Live2D,**语音交互**,跨平台。
- [petto](https://github.com/funnycups/petto) — Live2D 助手,**表情/动作管理**、定时问候、语音。
- [narze/live2d-electron](https://github.com/narze/live2d-electron) — Electron 跑 Live2D 的最小参考(macOS)。
