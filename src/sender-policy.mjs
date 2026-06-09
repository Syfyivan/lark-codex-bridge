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
    loopRespondToBotSenders = false,
    loopMaxTurns = 3,
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

  if (trace && trace.turn >= Math.min(trace.maxTurns || loopMaxTurns, loopMaxTurns)) {
    return 'max_turns_reached';
  }

  if (isKnownBotSender({ senderType, senderId, loopBotSenderIds }) && !loopRespondToBotSenders) {
    const delegateMentionFromBot =
      delegateAllowBotSenders && delegateMentionEnabled && hasActionableText && mentionsDelegate;
    const botMentionFromBot = hasActionableText && mentionsBot;
    if (!delegateMentionFromBot && !botMentionFromBot) return 'bot_sender_ignored';
  }

  return '';
}
