// Reads local AI coding-agent token usage from on-disk JSONL session logs and
// aggregates by day. Sources:
//   Claude Code: ~/.claude/projects/**/*.jsonl  (assistant lines carry message.usage)
//   Codex:       ~/.codex/sessions/**/*.jsonl   (best-effort: cumulative usage field)
//
// NOTE: JSONL counts are approximate and can diverge from official metering
// (cache tokens, missing fields). Good enough for "feed the pet + rough daily
// totals"; not an accounting-grade number. This is the LOCAL half of the
// cross-source ledger — Feishu-bridge usage merges in separately (source-tagged).
const fs = require('fs')
const path = require('path')
const os = require('os')

function listJsonl(root) {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(root, e.name)
    if (e.isDirectory()) out.push(...listJsonl(p))
    else if (e.isFile() && p.endsWith('.jsonl')) out.push(p)
  }
  return out
}

function eachLine(file, fn) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      fn(JSON.parse(line))
    } catch {
      /* skip malformed line */
    }
  }
}

// Extract a token count from a usage value. Numbers are used directly; objects
// prefer an explicit total, else input + output.
function tokenCount(u) {
  if (typeof u === 'number') return u
  if (!u) return 0
  return u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0)
}

function addClaude(byDay, file, seen) {
  eachLine(file, (obj) => {
    const u = obj?.message?.usage
    if (!u) return
    // The same assistant message can be replayed across resume/branch/sidechain
    // jsonl files; dedupe on message.id + requestId (mirrors ccusage). Only
    // dedupe when message.id exists — older logs omit it, and dropping those
    // would undercount.
    const id = obj?.message?.id
    if (id) {
      const requestId = obj?.requestId || obj?.request_id || ''
      const key = `${id}|${requestId}`
      if (seen.has(key)) return
      seen.add(key)
    }
    // cache_creation may be flat (cache_creation_input_tokens) or nested under
    // usage.cache_creation as ephemeral 5m/1h buckets; count both.
    const nestedCacheCreation =
      (u.cache_creation?.ephemeral_5m_input_tokens || 0) +
      (u.cache_creation?.ephemeral_1h_input_tokens || 0)
    const t =
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      nestedCacheCreation +
      (u.cache_read_input_tokens || 0)
    const day = String(obj.timestamp || '').slice(0, 10)
    if (day && t) byDay[day] = (byDay[day] || 0) + t
  })
}

function addCodex(byDay, file) {
  // Codex reports cumulative usage per session. Attribute per-turn deltas to the
  // day each turn landed on (better for multi-day sessions) instead of dumping
  // the whole session total onto the last day. Field names vary across versions.
  let prevTotal = 0
  eachLine(file, (obj) => {
    const day = String(obj?.timestamp || obj?.ts || '').slice(0, 10)
    if (!day) return
    // Prefer an explicit per-turn delta when present.
    const delta = obj?.info?.last_token_usage
    let t = 0
    if (delta) {
      t = tokenCount(delta)
    } else {
      // Otherwise diff the running cumulative total against the previous row.
      const cum = obj?.info?.total_token_usage || obj?.total_token_usage || obj?.token_usage || obj?.usage
      if (cum) {
        const total = tokenCount(cum)
        t = Math.max(0, total - prevTotal)
        prevTotal = total
      }
    }
    if (t) byDay[day] = (byDay[day] || 0) + t
  })
}

function usageByDay({ claudeRoot, codexRoot } = {}) {
  const cRoot = claudeRoot || path.join(os.homedir(), '.claude', 'projects')
  const xRoot = codexRoot || path.join(os.homedir(), '.codex', 'sessions')
  const byDay = {}
  // Shared across all Claude files so a replayed message dedupes globally.
  const seen = new Set()
  for (const f of listJsonl(cRoot)) addClaude(byDay, f, seen)
  for (const f of listJsonl(xRoot)) addCodex(byDay, f)
  return byDay
}

function dayString(d) {
  return d.toISOString().slice(0, 10)
}

// Roll a {day -> tokens} map up into today / last-7-day / total. Reused for
// both the local JSONL ledger and the Feishu (lark) event ledger.
function summarizeByDay(byDay, now = new Date()) {
  const total = Object.values(byDay).reduce((a, b) => a + b, 0)
  let last7 = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    last7 += byDay[dayString(d)] || 0
  }
  return { today: byDay[dayString(now)] || 0, last7, total }
}

function summarize({ now = new Date(), ...roots } = {}) {
  const byDay = usageByDay(roots)
  return { ...summarizeByDay(byDay, now), byDay }
}

module.exports = { usageByDay, summarize, summarizeByDay }
