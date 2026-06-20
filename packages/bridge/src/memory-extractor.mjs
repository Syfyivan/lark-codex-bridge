export function extractMemoryCandidates(text, input = {}) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const candidates = [];
  for (const line of raw.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    if (/^(?:决定|decision|结论)[:：]/iu.test(line)) {
      candidates.push(candidate('decision', line.replace(/^(?:决定|decision|结论)[:：]\s*/iu, ''), input));
      continue;
    }
    if (/^(?:风险|risk)[:：]/iu.test(line)) {
      candidates.push(candidate('risk', line.replace(/^(?:风险|risk)[:：]\s*/iu, ''), input));
      continue;
    }
    if (/^(?:待办|todo|pending)[:：]/iu.test(line)) {
      candidates.push(candidate('pending', line.replace(/^(?:待办|todo|pending)[:：]\s*/iu, ''), input));
      continue;
    }
    if (/^(?:问题|question|open question)[:：]/iu.test(line)) {
      candidates.push(candidate('question', line.replace(/^(?:问题|question|open question)[:：]\s*/iu, ''), input));
    }
  }
  return candidates.filter(item => item.text);
}

function candidate(type, text, input) {
  return {
    type,
    text: String(text || '').trim(),
    source: input.source || 'extractor',
    confidence: input.confidence || 'medium',
  };
}
