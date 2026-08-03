# Changelog

本文件记录 `lark-codex-bridge` 每次版本更新中用户能够感知的变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，正式发布时会把 `Unreleased` 条目移动到对应版本和日期下。

## [Unreleased]

### Added

- 群内每个独立话题默认绑定自己的持久 Codex Session，并通过 Codex app-server 在 Bridge 重启后精确恢复；群级 Profile 和 Memory 仍然共享，任务过程互不串线。
- 新增 `/new [标题]`、`/sessions`、`/session`、`/use <序号|session_id|标题>`，支持为当前话题新建或绑定 Session，并查看群内保留的 Session。
- Lark 消息、话题和回复会与对应 Session 建立稳定绑定；同一话题持续进入原 Session，不同顶层请求可以并行执行。
- 新增 `CONTEXT_QUEUE_MAX_CONCURRENT` 全局并发上限，在保留任务级并行的同时保护本机 Codex 和下游工具。
- Profile Capability 现在会下沉为实际 Codex 运行策略：普通成员使用只读沙箱，禁用环境中的插件、MCP、Hook、App 与多 Agent，仅暴露 `allowedSkills` 明确允许的本地 Skill。
- 新增 `approvalMode: "owner_review"`；审批卡会记录 Capability 类型与读写影响，确认后重新校验同一个 Capability，再继续原请求。
- Bridge 任务记录与桌宠事件增加 `sessionId`，便于把机器人执行过程关联到 Codex App 中的任务。
- 新增 Changelog 校验脚本和 Bridge CI 门禁；Bridge 代码变更必须同步更新本文件。
- 运行中的飞书进度卡片新增“停止”按钮，按 `task_id` 精确中断对应 Codex 任务；停止后卡片进入“已停止”状态。

### Changed

- Codex 群任务改为“群级权限与共享 Memory、话题级 Session、Session 级串行队列”；同群独立任务不再互相阻塞。
- 飞书进度卡片不再展示带有转义符、临时路径和嵌套引号的原始 shell 命令，改为少量可公开的分析进度摘要，并去重重复步骤。
- 代理草稿由 Bridge 先读取并裁剪当前群最近消息，再作为显式上下文交给 Codex；读取失败时回退到原有的模型侧只读查询。
- 持久 Codex Session 的 token 只由 Codex 本地用量账本统计，避免桌宠的 Bridge 用量重复累计。
- `/health` 和 HTTP 健康检查现在会展示群 Session 开关、持久化状态与 Session Store 路径。
- 适配当前 Codex app-server 初始化协议，并移除已不需要的实验性 `runtimeWorkspaceRoots` 参数。
- Bridge CI 使用 Node.js 22.13，以满足仓库固定的 pnpm 11.7 运行要求。

### Fixed

- 修复启用持久 Codex Session 后，MR review 自动化和代理草稿因未传递群聊 Session 上下文而稳定失败的问题。
- 修复普通成员每轮更换临时工作区后，同一话题无法恢复原 Codex Session 的问题；Session 现在按稳定安全策略隔离，不再按一次性临时目录隔离。
- 修复 Codex app-server 同时返回过程消息和最终回答时，Bridge 误把较早的过程消息放进待审批卡的问题。
- 代理草稿现在必须满足结构化 JSON 契约并包含非空 `reply_text`；无效输出会进入失败态，不再生成可误发的审批卡。
- Kodama 对缺少文本的完成、失败和飞书回复事件显示明确兜底文案，不再出现只有状态动作、没有可读结果的气泡。
- 修复 MR review 请求中的“修复、准备上线、通过后发布”等背景描述被误判为额外高风险操作，以及轮询补捞入口强制转人工确认的问题；可信机器人发起的纯 review 现在可直接执行，明确混合发布、改代码或删除请求仍保留确认。

### Security

- Capability/Skill 策略加入 Codex app-server Session 身份，权限范围变化后不会复用旧的宽权限 Session；allowlist 中不存在的 Skill 会在 Codex 启动前失败关闭。
- 敏感审批优先使用 `DELEGATE_APPROVER_OPEN_ID`，未配置时回退到 Profile 的首位 Owner；只有审批记录中的指定 Open ID 可以确认。
- 只有 Bridge owner 可以为话题新建或改绑 Session；查询 Session 状态和群内列表保持只读开放。
- 当前话题存在运行中或排队任务时拒绝新建、改绑 Session，避免任务被中途切换。
- 卡片停止操作在 Bridge 服务端校验操作者 Open ID，只有 Bridge owner 可以执行；同群其他任务不会被连带中断。
