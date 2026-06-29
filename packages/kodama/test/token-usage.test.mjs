import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { usageByDay, summarize, summarizeByDay } = require('../src/main/token-usage.js')

function writeClaudeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kodama-claude-'))
  const proj = join(root, 'projY')
  mkdirSync(proj, { recursive: true })
  const lines = [
    { timestamp: '2026-06-15T01:00:00Z', message: { usage: { input_tokens: 100, output_tokens: 50 } } },
    { timestamp: '2026-06-15T02:00:00Z', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 35 } } },
    { timestamp: '2026-06-14T10:00:00Z', message: { usage: { input_tokens: 200, output_tokens: 0 } } },
    { type: 'noise-without-usage' },
  ]
  writeFileSync(join(proj, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return root
}

test('claude JSONL usage aggregates by day (input+output+cache)', () => {
  const claudeRoot = writeClaudeFixture()
  const byDay = usageByDay({ claudeRoot, codexRoot: '/nonexistent' })
  assert.equal(byDay['2026-06-15'], 100 + 50 + 10 + 5 + 35) // 200
  assert.equal(byDay['2026-06-14'], 200)
})

test('summarize computes today/last7/total', () => {
  const claudeRoot = writeClaudeFixture()
  const now = new Date('2026-06-15T12:00:00Z')
  const s = summarize({ claudeRoot, codexRoot: '/nonexistent', now })
  assert.equal(s.today, 200)
  assert.equal(s.last7, 400) // 06-15 + 06-14 both within 7 days
  assert.equal(s.total, 400)
})

test('missing dirs yield empty totals, no throw', () => {
  const s = summarize({ claudeRoot: '/nope', codexRoot: '/nope', now: new Date('2026-06-15T00:00:00Z') })
  assert.equal(s.total, 0)
})

test('claude dedupes a replayed message across files (message.id + requestId)', () => {
  const root = mkdtempSync(join(tmpdir(), 'kodama-claude-dedup-'))
  const proj = join(root, 'projY')
  mkdirSync(proj, { recursive: true })
  // Same message.id + requestId appears in two files (resume replay).
  const dup = {
    timestamp: '2026-06-15T01:00:00Z',
    requestId: 'req_1',
    message: { id: 'msg_1', usage: { input_tokens: 100, output_tokens: 50 } },
  }
  writeFileSync(join(proj, 'a.jsonl'), JSON.stringify(dup) + '\n')
  writeFileSync(join(proj, 'b.jsonl'), JSON.stringify(dup) + '\n')
  const byDay = usageByDay({ claudeRoot: root, codexRoot: '/nonexistent' })
  assert.equal(byDay['2026-06-15'], 150) // counted once, not 300
})

test('codex attributes cumulative deltas to each turn day', () => {
  const root = mkdtempSync(join(tmpdir(), 'kodama-codex-'))
  const sess = join(root, 'sessX')
  mkdirSync(sess, { recursive: true })
  const lines = [
    { timestamp: '2026-06-14T10:00:00Z', total_token_usage: { total_tokens: 100 } },
    { timestamp: '2026-06-15T10:00:00Z', total_token_usage: { total_tokens: 300 } },
    { timestamp: '2026-06-15T11:00:00Z', total_token_usage: { total_tokens: 300 } },
  ]
  writeFileSync(join(sess, 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const byDay = usageByDay({ claudeRoot: '/nonexistent', codexRoot: root })
  assert.equal(byDay['2026-06-14'], 100) // first turn delta
  assert.equal(byDay['2026-06-15'], 200) // 300 - 100, then 0
  assert.equal(byDay['2026-06-14'] + byDay['2026-06-15'], 300) // sum == last cumulative
})

test('summarizeByDay rolls a day map into today/last7/total (used for the lark ledger)', () => {
  const byDay = { '2026-06-15': 100, '2026-06-12': 30, '2026-06-01': 999 }
  const s = summarizeByDay(byDay, new Date('2026-06-15T12:00:00Z'))
  assert.equal(s.today, 100)
  assert.equal(s.last7, 130) // 06-15 + 06-12 within 7 days; 06-01 excluded
  assert.equal(s.total, 1129)
})
