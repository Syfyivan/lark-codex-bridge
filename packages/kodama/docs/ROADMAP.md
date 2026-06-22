# Kodama + Bridge 优化蓝图

> 滚动更新的改进蓝图。完成项打勾并标注 commit。开源参考见文末。
> 最近更新:2026-06-22。

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

## ▶ 进行中 / 下一步(#9 养成经济,带可恢复方案)
已确认方向 = **换 CC0 像素精灵宠物 + 经验商店**。拆成两半:

**A. 配饰商店(emoji 配饰,零素材)—— ✅ 已完成 (2026-06-22)**
- emoji 配饰(🎩🧢👑🎀🕶️🥸🎖️⭐🦴💫🌸 共 11 件)用经验购买,零版权/免下载。锁定=灰(grayscale),解锁=彩色;购买后自动佩戴。
- 落点:`config/accessories.js` 加 `EMOJI_SHOP`(`icon`+`cost`,`unlockLevel:9999` 只能买);`accessories.js` 渲染层见 `icon` 即画 emoji 文本(字号随 anchor 盒);`growth.js` 加 `unlockWithExp()`(exp≥cost 扣经验+解锁+持久化);同步沿用 accessory-menu 管道(pet→main 缓存 `accessoryMenuState`→管理窗 `getAccessoryCatalog` 读;管理窗命令→main→`sendToPet`);`manage.html/js` 加「配饰商店」网格卡(解锁 N⭐ / 佩戴 / 卸下)。托盘「配饰」子菜单也显示 emoji + 售价。
- 测试:growth.test 加购买/经验不足/购后可佩戴 3 例;全套 34 绿。
- 经验经济说明:exp 同时是升级货币,可购预算 = 距下一级的累积 exp;高等级缓冲大,买 emoji 件绰绰有余,不够先「投喂」换经验。

**A′. 气泡可读性修复(顺带,用户反馈)—— ✅ 已完成 (2026-06-22)**
- 标题不再统一「本地·完成」:`bubbleTitle` 改用任务名(cwd 项目名 → 任务 prompt → 兜底 source)。
- 悬浮「摘要读取失败:missing-transcript-path」:Codex `agent-turn-complete` notify 不带 transcript_path,改为无 transcript 时用事件自带的 `prompt`(input-messages)+ 结果直接合成摘要;Codex prompt 在 hook-events 捕获。

**B. 宠物随等级进化(CC0 史莱姆)—— ✅ 已完成 (2026-06-22)**
- 换人物已落地:**"Slime (CC0)" by Rick Hoppmann**(https://opengameart.org/content/slime-0),CC0 可商用免署名。从 5 色 sprite sheet 用 ffmpeg 切成**每色 2 帧循环 APNG**(带 alpha,无白边),放 `src/renderer/pets/slime/` + `LICENSE.txt`。
- **进化 = 等级选颜色阶段**:绿(Lv1)→蓝(5)→黄(15)→红(30)→紫(60)。`backends/gif.js` 加 `stages`+`setLevel()`(按 file 比对重渲染);`renderer.js` 的 `syncAccessories` 在等级变化时调 `setLevel`。
- **gif 后端可拖动**:补 `gifLayout`(renderer 作用域,按 petX/petY 定位 `<img>`、贴边、缩放、重排气泡)赋给 `backend.applySettings`——之前 gif 没有 applySettings 导致拖拽无效。
- **分发**:slime 素材从 gitignore 放出(CC0 可提交),作为**可选宠物**;默认仍 Live2D,经 `render.local.js` 启用(`render.local.example.js` 已以 slime 为开箱示例)。
- 下一步可做:蛋→孵化的真·形态(目前是颜色阶段,非蛋/幼崽不同体型);per-status 动画(当前各状态共用待机帧);emoji 配饰 anchor 按 slime 头部微调。
- 许可常识:CC0=可商用/不用署名/不用授权;CC-BY=要署名;"free for personal use"≠可商用。

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
