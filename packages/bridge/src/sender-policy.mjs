export function isKnownBotSender({ senderType = '', senderId = '', loopBotSenderIds = [] }) {
  return (
    senderType === 'bot' ||
    senderType === 'app' ||
    String(senderId || '').startsWith('cli_') ||
    loopBotSenderIds.includes(senderId)
  );
}

export function shouldSkipSenderPolicy(input) {
  const {
    senderId = '',
    senderType = '',
    trace = null,
    botOpenId = '',
    loopIgnoreSenderIds = [],
    loopAllowSenderIds = [],
    loopBotSenderIds = [],
    loopBotAllowSenderIds = [],
    loopRespondToBotSenders = false,
    loopRequireTraceFromBotSenders = false,
    loopHardMaxTurns = 0,
    loopTraceTtlMs = 0,
    nowMs = Date.now(),
    delegateAllowBotSenders = true,
    delegateMentionEnabled = false,
    hasActionableText = false,
    mentionsDelegate = false,
    mentionsBot = false,
  } = input || {};

  if (botOpenId && senderId === botOpenId) return 'self_sender';
  if (senderId && loopIgnoreSenderIds.includes(senderId)) return 'ignored_sender';
  if (loopAllowSenderIds.length && !loopAllowSenderIds.includes(senderId)) {
    return 'sender_not_allowed';
  }

  const senderIsKnownBot = isKnownBotSender({ senderType, senderId, loopBotSenderIds });
  if (senderIsKnownBot && trace) {
    const hardMaxTurns = Math.max(0, Number(trace.hardMaxTurns || loopHardMaxTurns || 0));
    if (hardMaxTurns > 0 && Number(trace.turn || 0) >= hardMaxTurns) {
      return 'max_turns_reached';
    }

    const startedAt = Number(trace.startedAt || 0);
    const ttlMs = Math.max(0, Number(trace.ttlMs || loopTraceTtlMs || 0));
    if (startedAt > 0 && ttlMs > 0 && Number(nowMs || Date.now()) - startedAt > ttlMs) {
      return 'trace_expired';
    }
  }

  if (senderIsKnownBot) {
    if (loopBotAllowSenderIds.length && !loopBotAllowSenderIds.includes(senderId)) {
      return 'bot_sender_not_allowed';
    }
    if (loopRequireTraceFromBotSenders && !trace) {
      return 'bot_sender_missing_trace';
    }
  }

  if (senderIsKnownBot && !loopRespondToBotSenders) {
    const delegateMentionFromBot =
      delegateAllowBotSenders && delegateMentionEnabled && hasActionableText && mentionsDelegate;
    const botMentionFromBot = hasActionableText && mentionsBot;
    if (!delegateMentionFromBot && !botMentionFromBot) return 'bot_sender_ignored';
  }

  return '';
}
