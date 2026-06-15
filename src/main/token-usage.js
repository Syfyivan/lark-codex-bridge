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

function addClaude(byDay, file) {
  eachLine(file, (obj) => {
    const u = obj?.message?.usage
    if (!u) return
    const t =
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0)
    const day = String(obj.timestamp || '').slice(0, 10)
    if (day && t) byDay[day] = (byDay[day] || 0) + t
  })
}

function addCodex(byDay, file) {
  // Codex reports cumulative usage per session; attribute the session's last
  // seen total to its last seen day. Field names vary across versions.
  let last = 0
  let day = ''
  eachLine(file, (obj) => {
    const u = obj?.info?.total_token_usage || obj?.total_token_usage || obj?.token_usage || obj?.usage
    if (u) {
      const t =
        typeof u === 'number' ? u : (u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0))
      if (t) last = t
    }
    const ts = obj?.timestamp || obj?.ts
    if (ts) day = String(ts).slice(0, 10)
  })
  if (last && day) byDay[day] = (byDay[day] || 0) + last
}

function usageByDay({ claudeRoot, codexRoot } = {}) {
  const cRoot = claudeRoot || path.join(os.homedir(), '.claude', 'projects')
  const xRoot = codexRoot || path.join(os.homedir(), '.codex', 'sessions')
  const byDay = {}
  for (const f of listJsonl(cRoot)) addClaude(byDay, f)
  for (const f of listJsonl(xRoot)) addCodex(byDay, f)
  return byDay
}

function dayString(d) {
  return d.toISOString().slice(0, 10)
}

function summarize({ now = new Date(), ...roots } = {}) {
  const byDay = usageByDay(roots)
  const total = Object.values(byDay).reduce((a, b) => a + b, 0)
  let last7 = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    last7 += byDay[dayString(d)] || 0
  }
  return { today: byDay[dayString(now)] || 0, last7, total, byDay }
}

module.exports = { usageByDay, summarize }
