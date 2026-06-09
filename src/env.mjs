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
