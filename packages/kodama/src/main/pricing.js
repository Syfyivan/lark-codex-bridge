// Approximate $/token price table for AI coding-agent models, used to turn the
// local JSONL token counts (see token-usage.js) into a rough dollar figure.
//
// IMPORTANT: this is a hand-maintained SNAPSHOT (≈ 2026-06) of public list
// pricing and WILL drift as vendors change prices or ship new models. It is
// good enough for "what did the pet roughly cost me today"; it is not billing.
// Prices are USD per 1,000,000 tokens, split by token kind:
//   input        prompt tokens billed at full rate
//   output       completion tokens
//   cacheWrite   prompt-cache writes (Claude charges a ~1.25x write premium)
//   cacheRead    prompt-cache reads (Claude ~0.1x; OpenAI's discounted cached input)
//
// Numbers are per-1M; costFor() divides by 1e6.

const PER_MILLION = 1e6

// Claude bills cache writes at ~1.25x input and cache reads at ~0.1x input.
function claude(input, output) {
  return { input, output, cacheWrite: input * 1.25, cacheRead: input * 0.1 }
}

// OpenAI has no cache-write premium; cached input is just a discounted read.
function openai(input, output, cachedRead) {
  return { input, output, cacheWrite: input, cacheRead: cachedRead }
}

// Canonical table. Keys are already-normalized model ids (see normalizeModel).
// Fuzzy family fallbacks below cover ids/aliases not listed explicitly.
const PRICING = {
  // Anthropic — Claude
  'claude-fable-5': claude(10, 50),
  'claude-mythos-5': claude(10, 50),
  'claude-opus-4-8': claude(5, 25),
  'claude-opus-4-7': claude(5, 25),
  'claude-opus-4-6': claude(5, 25),
  'claude-opus-4-5': claude(5, 25),
  'claude-opus-4-1': claude(15, 75),
  'claude-opus-4-0': claude(15, 75),
  'claude-sonnet-4-6': claude(3, 15),
  'claude-sonnet-4-5': claude(3, 15),
  'claude-sonnet-4-0': claude(3, 15),
  'claude-haiku-4-5': claude(1, 5),
  // older Claude 3.x (still seen in old logs)
  'claude-3-opus': claude(15, 75),
  'claude-3-5-sonnet': claude(3, 15),
  'claude-3-7-sonnet': claude(3, 15),
  'claude-3-5-haiku': claude(0.8, 4),
  'claude-3-haiku': claude(0.25, 1.25),

  // OpenAI — Codex / gpt-5.x family
  'gpt-5': openai(1.25, 10, 0.125),
  'gpt-5-codex': openai(1.25, 10, 0.125),
  'gpt-5.1': openai(1.25, 10, 0.125),
  'gpt-5.1-codex': openai(1.25, 10, 0.125),
  'gpt-5-mini': openai(0.25, 2, 0.025),
  'gpt-5-nano': openai(0.05, 0.4, 0.005),
}

// When a model id can't be resolved, fall back to mid-tier Claude pricing so the
// dollar figure is approximate-but-nonzero rather than silently lost.
const DEFAULT_RATES = claude(5, 25)

// Normalize a raw model string to a canonical id: lowercase, drop a provider
// prefix ("anthropic/…", "openai/…"), drop a ":tag" suffix (ollama-style), and
// drop a trailing date alias ("-20250929" / "@20250929") or "-latest".
function normalizeModel(model) {
  if (!model || typeof model !== 'string') return ''
  let m = model.toLowerCase().trim()
  if (m.includes('/')) m = m.slice(m.lastIndexOf('/') + 1)
  if (m.includes(':')) m = m.slice(0, m.indexOf(':'))
  m = m.replace(/[-@]\d{6,8}$/, '')
  m = m.replace(/-latest$/, '')
  return m
}

// Resolve normalized id → rate object. Direct hit first, then family heuristics
// so unseen point-releases still price sensibly.
function ratesFor(model) {
  const m = normalizeModel(model)
  if (!m) return DEFAULT_RATES
  if (PRICING[m]) return PRICING[m]

  // Claude family
  if (/claude|opus|sonnet|haiku|fable|mythos/.test(m)) {
    if (/fable|mythos/.test(m)) return claude(10, 50)
    if (m.includes('opus')) {
      if (/opus-?4|4-?opus/.test(m)) return claude(5, 25)
      if (/opus-?3|3-?opus/.test(m)) return claude(15, 75)
      return claude(5, 25)
    }
    if (m.includes('sonnet')) return claude(3, 15)
    if (m.includes('haiku')) {
      if (/haiku-?4|4-?haiku/.test(m)) return claude(1, 5)
      if (/haiku-?3-?5|3-?5-?haiku/.test(m)) return claude(0.8, 4)
      if (/haiku-?3|3-?haiku/.test(m)) return claude(0.25, 1.25)
      return claude(1, 5)
    }
  }

  // OpenAI / Codex family
  if (/gpt|codex|^o\d/.test(m)) {
    if (m.includes('nano')) return openai(0.05, 0.4, 0.005)
    if (m.includes('mini')) return openai(0.25, 2, 0.025)
    return openai(1.25, 10, 0.125)
  }

  return DEFAULT_RATES
}

// costFor(model, usage) → USD (number). usage counts are raw token totals; any
// missing kind is treated as 0. cacheCreate maps to the cache-write rate.
function costFor(model, { input = 0, output = 0, cacheCreate = 0, cacheRead = 0 } = {}) {
  const r = ratesFor(model)
  return (
    (input * r.input +
      output * r.output +
      cacheCreate * r.cacheWrite +
      cacheRead * r.cacheRead) /
    PER_MILLION
  )
}

module.exports = { costFor, ratesFor, normalizeModel, PRICING }
