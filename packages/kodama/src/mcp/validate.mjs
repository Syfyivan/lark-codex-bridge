// Guard rails for the `say` tool. The pet bubble is a tiny speech balloon, not a
// log sink, so we keep its text short and free of code, links, and secrets.

const CODE_FENCE_RE = /```|~~~/
const URL_RE = /\b(?:https?|ftp|file|ws|wss):\/\/\S+/i
// Common credential shapes we never want surfaced in a screenshot-able bubble.
const SECRET_RE = new RegExp(
  [
    'sk-[A-Za-z0-9]{12,}', // OpenAI-style keys
    'AKIA[0-9A-Z]{12,}', // AWS access key id
    'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub tokens
    'xox[baprs]-[A-Za-z0-9-]{10,}', // Slack tokens
    'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}', // JWT
    '(?:password|passwd|secret|api[_-]?key|token)\\s*[:=]\\s*\\S{6,}', // key=value secrets
  ].join('|'),
  'i',
)

export const SAY_MAX_LENGTH = 140

// Returns { ok: true, text } on success or { ok: false, error } on rejection.
export function validateSayText(input) {
  if (typeof input !== 'string') return { ok: false, error: 'text must be a string' }
  const text = input.trim()
  if (text.length < 1) return { ok: false, error: 'text must be at least 1 character' }
  if (text.length > SAY_MAX_LENGTH) {
    return { ok: false, error: `text must be at most ${SAY_MAX_LENGTH} characters` }
  }
  if (CODE_FENCE_RE.test(text)) return { ok: false, error: 'text must not contain code blocks' }
  if (URL_RE.test(text)) return { ok: false, error: 'text must not contain URLs' }
  if (SECRET_RE.test(text)) return { ok: false, error: 'text must not contain secrets' }
  return { ok: true, text }
}
