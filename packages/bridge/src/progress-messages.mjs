function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function clampText(value, maxLength) {
  const text = stripAnsi(String(value || '')).trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:token|secret|cookie|jwt|appsecret|app_secret)\s*[=:]\s*)[^\s'",，。]+/gi, '$1[redacted]');
}

export const DIRECT_TASK_RECEIVED_TEXT = '已收到，正在判断任务范围和执行环境。';
export const DIRECT_TASK_STARTED_TEXT = '已开始执行，我会在这里同步关键进展。';
export const DIRECT_TASK_HEARTBEATS = [
  '仍在处理：正在读取项目上下文。',
  '仍在处理：正在运行必要检查或验证。',
  '仍在处理：正在整理结果和剩余风险。',
  '仍在处理：还在等待底层命令或平台响应。',
];

export function sanitizeBridgeStatusText(value, maxLength = 800) {
  return clampText(
    redactSensitiveText(String(value || ''))
      .replace(/\/(?:Users|var|tmp|private|Applications)\/[^\s'",，。)]+/g, '[local-path]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'),
    maxLength,
  );
}

export function formatDirectTaskFailureReply(error) {
  const detail = sanitizeBridgeStatusText(error?.message || error || '未知错误');
  return [
    '当前状态：失败',
    '做了什么：Codex run 已启动，但执行过程中出错。',
    '是否修改了代码：未知；bridge 不在失败摘要中展开完整工具日志。',
    '验证结果：未完成。',
    `剩余风险或下一步：${detail || '请查看 bridge 本地日志定位原因。'}`,
  ].join('\n');
}

export function formatDirectTaskStoppedReply() {
  return [
    '当前状态：已阻断',
    '做了什么：任务收到停止信号，Codex run 已终止。',
    '是否修改了代码：未知；如果任务已经运行过，需要按具体执行日志确认。',
    '验证结果：未完成。',
    '剩余风险或下一步：需要 owner 重新发起或缩小任务范围。',
  ].join('\n');
}
