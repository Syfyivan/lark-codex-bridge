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

function statusChangeLines(gitStatus) {
  return String(gitStatus || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line && !line.startsWith('##'));
}

export function formatDirectTaskFailureReply(error, recovery = {}) {
  const detail = sanitizeBridgeStatusText(error?.message || error || '未知错误', 500);
  const gitStatus = sanitizeBridgeStatusText(recovery.gitStatus || '', 1200);
  const changeLines = statusChangeLines(recovery.gitStatus);
  const hasChanges = Boolean(recovery.hasWorktreeChanges || changeLines.length);
  const changedCount = Number(recovery.changedCount || changeLines.length || 0);
  const cwd = recovery.cwd ? sanitizeBridgeStatusText(recovery.cwd, 240) : '';
  const wasBridgeRestart = recovery.reason === 'bridge_restart';
  const didWhat = wasBridgeRestart
    ? 'Codex run 已启动，但 bridge 重启时任务还没有上报最终状态；当前没有 active runner。'
    : 'Codex run 已启动，但执行过程中出错。';

  if (hasChanges) {
    return [
      '当前状态：失败（可恢复）',
      `做了什么：${didWhat} bridge 已检测到本地工作区存在未提交改动。`,
      `是否修改了代码：是，检测到 ${changedCount} 条未提交变更。`,
      '验证结果：未完成；需要修复失败命令后重新验证。',
      `失败摘要：${detail || '请查看 bridge 本地日志定位原因。'}`,
      cwd ? `工作目录：${cwd}` : '',
      gitStatus ? `当前 git 状态：\n${gitStatus}` : '',
      '剩余风险或下一步：不要重写整个任务；从当前本地改动继续，先修复失败命令，重跑必要验证，通过后再 commit + push。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '当前状态：失败',
    `做了什么：${didWhat}`,
    recovery.gitStatus
      ? '是否修改了代码：未检测到未提交变更。'
      : '是否修改了代码：未知；bridge 未能确认工作区状态。',
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
