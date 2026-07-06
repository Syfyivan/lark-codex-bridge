export function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function envFlagValue(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  return !['', '0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

export function envFlag(env, name, defaultValue = false) {
  const value = env[name];
  if (value === undefined) return defaultValue;
  return envFlagValue(value, defaultValue);
}

export function firstNonBlank(...values) {
  return values.find(value => String(value ?? '').trim() !== '');
}

export function optionalTimeoutMs(value, defaultValue = 0) {
  const rawValue = firstNonBlank(value);
  if (rawValue === undefined) return defaultValue;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

export function cappedTimeoutMs(timeoutMs, capMs) {
  const timeout = Number(timeoutMs);
  const cap = Number(capMs);
  if (!Number.isFinite(cap) || cap <= 0) return Number.isFinite(timeout) && timeout > 0 ? timeout : 0;
  if (!Number.isFinite(timeout) || timeout <= 0) return cap;
  return Math.min(timeout, cap);
}

export function parseReactionRules(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('REACTION_ON_RECEIVE_RULES must be a JSON array');
  }

  return parsed
    .map((rule, index) => {
      if (!rule || typeof rule !== 'object') return null;
      const emoji = String(rule.emoji || rule.emoji_type || '').trim();
      if (!emoji) return null;

      const contains = Array.isArray(rule.contains)
        ? rule.contains
        : rule.contains
          ? [rule.contains]
          : [];
      const containsText = contains
        .map(item => String(item || '').trim())
        .filter(Boolean);
      const pattern = String(rule.pattern || rule.regex || '').trim();

      if (!containsText.length && !pattern) return null;
      return {
        index,
        emoji,
        contains: containsText,
        pattern,
        flags: String(rule.flags || 'i'),
        caseSensitive: envFlagValue(rule.case_sensitive ?? rule.caseSensitive, false),
      };
    })
    .filter(Boolean);
}
