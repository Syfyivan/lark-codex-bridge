// 桌宠"动作表"配置 —— 事件 -> 状态 + 动作 + 气泡模板。
// 设计目的：加新反应只改这里，不动逻辑代码（解决"没经验、迭代难"的痛点）。
// 模板变量：{icon} 来源图标、{label} 来源名、{text} 摘要。
// priority：数字越大越重要；显示窗口内，低优先级气泡不会顶掉高优先级气泡。
export const PET_CONFIG = {
  sources: {
    lark: { icon: '💬', label: '飞书' },
    local: { icon: '💻', label: '本地' },
  },
  events: {
    lark_message_received: { status: 'looking', motion: 'Idle', priority: 2, ms: 4000, bubble: '{icon} 有人在{label}喊我啦 👀' },
    task_started: { status: 'working', motion: 'Idle', priority: 2, ms: 4000, bubble: '{icon} {label}任务开工 🛠️' },
    task_progress: { status: 'working', motion: null, priority: 1, ms: 2500, bubble: '{icon} {text}' },
    lark_reply_sent: { status: 'replying', motion: 'Idle', priority: 3, ms: 4500, bubble: '{icon} 我刚替你回了{label}：{text}' },
    task_waiting: { status: 'waiting', motion: 'Idle', priority: 5, ms: 6000, bubble: '{icon} {label}需要你确认一下！👉' },
    task_done: { status: 'done', motion: 'Tap', priority: 4, ms: 5000, bubble: '{icon} {label}搞定啦 🎉 {text}' },
    task_failed: { status: 'failed', motion: null, priority: 5, ms: 6000, bubble: '{icon} {label}任务失败了… 去看日志 😣' },
  },
}
