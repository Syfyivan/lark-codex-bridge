function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function clampText(value, maxLength) {
  const text = stripAnsi(value).trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 4)).trim()} ...`;
}

function clampSingleLine(value, maxLength) {
  return clampText(value, maxLength).replace(/\s+/g, ' ').trim();
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function messageText(message) {
  const direct = String(message?.content || message?.text || message?.plain_text || '').trim();
  if (!direct) return '';
  const parsed = parseJson(direct);
  if (parsed?.text) return String(parsed.text);
  if (parsed?.content) return String(parsed.content);
  return direct;
}

function messageSenderName(message) {
  const sender = message?.sender || {};
  return (
    sender.name ||
    sender.display_name ||
    sender.displayName ||
    sender.id ||
    sender.open_id ||
    sender.openId ||
    message?.sender_name ||
    message?.senderName ||
    message?.sender_id ||
    'unknown'
  );
}

function messageTime(message) {
  return String(message?.create_time || message?.createTime || message?.timestamp || '').trim();
}

function messageId(message) {
  return String(message?.message_id || message?.id || '').trim();
}

function isDeletedMessage(message) {
  return Boolean(message?.deleted || message?.is_deleted || message?.isDeleted);
}

function formatRecentMessage(message, targetMessageId, maxContentChars, maxLineChars) {
  const id = messageId(message);
  const text = messageText(message);
  if (!id || !text || isDeletedMessage(message)) return '';
  const prefix = `- ${messageTime(message) || 'unknown-time'} ${messageSenderName(message)}: `;
  const meta = [
    id ? `message_id=${id}` : '',
    message?.reply_to ? `reply_to=${message.reply_to}` : '',
    id && id === targetMessageId ? 'target=true' : '',
  ].filter(Boolean);
  const suffix = ` (${meta.join(', ')})`;
  const contentBudget = Math.min(maxContentChars, maxLineChars - prefix.length - suffix.length);
  if (contentBudget < 4) return '';
  return prefix + clampSingleLine(text, contentBudget) + suffix;
}

export function buildDelegateRecentChatContext(messages, options = {}) {
  if (!Array.isArray(messages) || !messages.length) return '';
  const maxMessages = Math.max(1, Number(options.maxMessages || 30));
  const maxChars = Math.max(400, Number(options.maxChars || 8000));
  const maxContentChars = Math.max(40, Number(options.maxContentChars || 500));
  const targetMessageId = String(options.targetMessageId || '').trim();

  const heading = '已由 bridge 预读取的当前群最近消息（按时间从旧到新；优先作为本次 @宋一凡 的上下文）：';
  const maxLineChars = maxChars - heading.length - 1;
  const lines = new Map();
  let remaining = maxChars - heading.length;

  function include(index) {
    const line = formatRecentMessage(messages[index], targetMessageId, maxContentChars, maxLineChars);
    if (!line || line.length + 1 > remaining) return;
    lines.set(index, line);
    remaining -= line.length + 1;
  }

  // The poll returns newest first. Reserve room for the triggering message,
  // then add recent messages that fit without cutting their metadata.
  const targetIndex = targetMessageId ? messages.findIndex(message => messageId(message) === targetMessageId) : -1;
  if (targetIndex !== -1) include(targetIndex);
  for (let index = 0; index < messages.length && lines.size < maxMessages; index++) {
    if (index !== targetIndex) include(index);
  }
  if (!lines.size) return '';
  const chronological = [...lines].sort(([a], [b]) => b - a).map(([, line]) => line);
  return [heading, ...chronological].join('\n');
}
