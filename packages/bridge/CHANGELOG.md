# Changelog

本文件记录 `lark-codex-bridge` 每次版本更新中用户能够感知的变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，正式发布时会把 `Unreleased` 条目移动到对应版本和日期下。

## [Unreleased]

### Added

- 群聊默认绑定一个持久 Codex Session，并通过 Codex app-server 在 Bridge 重启后继续恢复；群内需求记忆仍由原有群级 Memory 独立管理。
- 新增 `/new [标题]`、`/sessions`、`/session`、`/use <序号|session_id|标题>`，支持在同一个群里显式新建、查看和切换 Session。
- Lark 消息、话题和回复会与对应 Session 建立稳定绑定；切换当前 Session 后，旧话题的后续回复仍能回到原 Session。
- Bridge 任务记录与桌宠事件增加 `sessionId`，便于把机器人执行过程关联到 Codex App 中的任务。
- 新增 Changelog 校验脚本和 Bridge CI 门禁；Bridge 代码变更必须同步更新本文件。

### Changed

- Codex 群任务的队列和 Session 上下文由“话题级”改为“群级”；非 Codex 后端仍沿用原有话题行为。
- 持久 Codex Session 的 token 只由 Codex 本地用量账本统计，避免桌宠的 Bridge 用量重复累计。
- `/health` 和 HTTP 健康检查现在会展示群 Session 开关、持久化状态与 Session Store 路径。
- 适配当前 Codex app-server 初始化协议，并移除已不需要的实验性 `runtimeWorkspaceRoots` 参数。
- Bridge CI 使用 Node.js 22.13，以满足仓库固定的 pnpm 11.7 运行要求。

### Fixed

- 修复启用持久 Codex Session 后，MR review 自动化和代理草稿因未传递群聊 Session 上下文而稳定失败的问题。

### Security

- 只有 Bridge owner 可以新建或切换群 Session；查询 Session 状态和列表保持只读开放。
- 当前群存在运行中或排队任务时拒绝新建、切换 Session，避免任务被中途改绑。
