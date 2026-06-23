# Kodama Bridge Compatibility

这份文档描述 **Kodama 桌宠本体** 期待的最小 bridge 协议。

目标不是要求别人复用 `lark-codex-bridge` 的实现，而是允许任何本地 bridge / adapter 只要兼容这组接口，就能驱动 Kodama。

## 约束

- Kodama 当前只连接 **本机 loopback** bridge：`127.0.0.1` / `localhost` / `::1`
- SSE 订阅用 query 参数 token：`GET /pet/events?token=...`
- 任务详情/分享接口用 Bearer Token：`Authorization: Bearer <token>`
- `bridgeUrl` / `token` 从 `src/renderer/config/agent.local.js` 注入

## 最小可用接口

如果你只想让桌宠“会提醒、会冒泡、会动”，实现这两个接口就够了：

### `GET /pet/events`

SSE 流。每条消息形如：

```text
event: task_done
data: {"type":"task_done","source":"lark","text":"任务完成","tokens":123}
```

Kodama 当前认识的事件类型：

- `lark_message_received`
- `task_started`
- `task_progress`
- `lark_reply_sent`
- `task_waiting`
- `agent_done`
- `task_done`
- `task_failed`

最常用字段：

- `type`: 事件类型
- `source`: 通常是 `lark`；缺省时 Kodama 会默认补成 `lark`
- `text`: 气泡摘要
- `tokens`: 可选，用于飞书侧 token 归账
- `chatId` / `messageId`: 可选，用于跳转或详情页联动

### `GET /pet/state`

返回：

```json
{ "ok": true }
```

Kodama 用它做 bridge 在线探测和重连后的状态确认。

## 可选高级接口

如果你还想保留“任务详情页 / 会话分享 / 任务分享”能力，再实现下面这些：

### `GET /task-viewer/tasks.json`

查询参数：

- `limit`
- `task_id`
- `context_key`
- `chat_id`
- `message_id`

典型返回：

```json
{
  "ok": true,
  "tasks": [],
  "scope": {
    "task_id": "task-123"
  }
}
```

### `POST /v1/sessions/session-shares`

请求体：

```json
{
  "provider": "codex",
  "session_id": "session-123"
}
```

返回里只要能提供一个 URL 即可，Kodama 会优先读这些字段：

- `share.url`
- `doc.url`
- `url`

### `POST /v1/bridge/task-viewer/share`

请求体示例：

```json
{
  "limit": 100,
  "task_id": "task-123"
}
```

返回同样只要能提供 share URL 即可：

- `url`
- `share.url`
- `doc.url`

## 推荐做法

如果对方已有自己的 bridge，不建议直接改 Kodama 本体；更稳的是在对方机器上加一个很薄的本地 adapter：

1. 把原始 bridge 事件翻译成 Kodama 认识的 SSE 事件
2. 把任务详情/分享能力翻译成上面的 HTTP 接口
3. 对外只暴露一个本机 loopback 地址，例如 `http://127.0.0.1:8787`

这样可以保证：

- Kodama 仓库保持稳定
- 不同 bridge 可以各自演进
- 用户只需要改 `agent.local.js`，不需要改桌宠代码
