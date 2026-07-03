const APPROVAL_CARD_TITLES = [
  '有人 @ 你，已拟好回复',
  '需要你确认本机操作',
];

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isDeletedLarkMessage(message = {}) {
  return Boolean(
    message.deleted ||
      message.is_deleted ||
      message.isDeleted ||
      message.delete_time ||
      message.deleteTime
  );
}

export function isInteractiveMessageType(messageType = '') {
  const type = String(messageType || '').toLowerCase();
  return type === 'interactive' || type === 'card';
}

export function isBridgeApprovalCardText(text = '') {
  const source = normalizedText(text);
  if (!source) return false;

  if (
    APPROVAL_CARD_TITLES.some(title =>
      source.includes(`<card title="${title}"`) ||
        source.includes(`title="${title}"`) ||
        source.includes(title),
    )
  ) {
    const hasApprovalId =
      /请求\s*ID\*{0,2}\s*[：:]\s*[A-Za-z0-9_-]{4,}/u.test(source) ||
      /approval_id["'\s:]+[A-Za-z0-9_-]{4,}/u.test(source);
    const hasApprovalAction =
      source.includes('同意执行') ||
      source.includes('取消执行') ||
      source.includes('同意发送') ||
      source.includes('取消发送') ||
      source.includes('bridge_action');
    if (hasApprovalId && hasApprovalAction) return true;
  }

  return (
    source.includes('确认前不会启动 Codex 执行') &&
    /同意执行\s+op-[A-Za-z0-9_-]+/u.test(source) &&
    /取消执行\s+op-[A-Za-z0-9_-]+/u.test(source)
  );
}

export function isBridgeSelfSender({ senderId = '', botOpenId = '', botAppId = '' } = {}) {
  const id = String(senderId || '');
  return Boolean(id && ((botOpenId && id === botOpenId) || (botAppId && id === botAppId)));
}

export function shouldSkipBridgeGeneratedMessage({
  rawText = '',
  messageType = '',
  deleted = false,
  senderId = '',
  botOpenId = '',
  botAppId = '',
} = {}) {
  if (deleted) return 'deleted_message';
  if (isBridgeApprovalCardText(rawText)) return 'bridge_approval_card';
  if (isBridgeSelfSender({ senderId, botOpenId, botAppId }) && isInteractiveMessageType(messageType)) {
    return 'self_interactive_message';
  }
  return '';
}
