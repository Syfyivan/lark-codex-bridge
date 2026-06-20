export function extractCodebaseMrUrls(text) {
  const matches = String(text || '').match(
    /https?:\/\/code(?:-[A-Za-z0-9-]+)?\.byted\.org\/(?:[A-Za-z0-9_.~-]+\/){2,}merge_requests\/\d+(?:[?#][^\s<>"'，。；、）)\]]*)?/gi,
  );
  return [...new Set(matches || [])];
}

export function hasReviewKeyword(text, reviewKeywords = []) {
  const rawText = String(text || '');
  const normalized = rawText.toLowerCase();
  return reviewKeywords.some(rawKeyword => {
    const keyword = String(rawKeyword || '').trim();
    if (!keyword) return false;
    if (/^[A-Za-z0-9 ]+$/.test(keyword)) {
      const escaped = escapeRegExp(keyword).replace(/\s+/g, '\\s+');
      return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(rawText);
    }
    return normalized.includes(keyword.toLowerCase());
  });
}

export function isAiPolishedHumanRelayText(text) {
  const source = String(text || '').replace(/\s+/g, ' ');
  return /本条消息来自.{1,40}本人发出[，,、\s]*(?:只是)?经过\s*ai\s*润色/iu.test(source);
}

export function hasApproveShorthand(text) {
  const source = stripUrls(String(text || '')).replace(/[()（）【】]/g, ' ');
  return /(?:^|[\s,，。；;：:、~～])(?:可以\s*)?(?:继续\s*)?[aA](?:\s*(?:了|一下|下))?(?=$|[\s,，。；;：:、~～])/u.test(source);
}

export function shouldTriggerReviewAutomation(input = {}) {
  const {
    rawText = '',
    keywordText = rawText,
    reviewKeywords = [],
    allowAiPolishedApproveShorthand = true,
  } = input;
  if (!extractCodebaseMrUrls(rawText).length) return false;
  if (hasReviewKeyword(keywordText, reviewKeywords)) return true;
  return Boolean(
    allowAiPolishedApproveShorthand &&
      isAiPolishedHumanRelayText(rawText) &&
      hasApproveShorthand(keywordText),
  );
}

export function canDirectReviewAutomation(input = {}) {
  const {
    requesterIsOwner = false,
    senderIsKnownBot = false,
    rawText = '',
  } = input;
  return Boolean(requesterIsOwner || (senderIsKnownBot && isAiPolishedHumanRelayText(rawText)));
}

function stripUrls(text) {
  return text.replace(/https?:\/\/\S+/gi, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
