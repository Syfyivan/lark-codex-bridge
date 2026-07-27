function parseJsonObject(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const embedded = start >= 0 && end > start ? raw.slice(start, end + 1) : '';
  const candidates = [fenced, raw, embedded].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next supported representation.
    }
  }
  return null;
}

function normalizedList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean).join('\n');
  }
  return String(value || '').trim();
}

export function parseDelegateDraftResult(output) {
  const raw = String(output || '').trim();
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    throw new Error('delegate draft must be a structured JSON object');
  }

  const replyText = String(parsed.reply_text || '').trim();
  if (!replyText) {
    throw new Error('delegate draft JSON must include a non-empty reply_text');
  }

  return {
    operationPlan: normalizedList(parsed.operation_plan),
    replyText,
    evidence: normalizedList(parsed.evidence),
    confidence: String(parsed.confidence || '').trim(),
    raw,
  };
}
