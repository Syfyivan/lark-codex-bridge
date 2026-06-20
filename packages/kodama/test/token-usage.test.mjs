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

test('summarizeByDay rolls a day map into today/last7/total (used for the lark ledger)', () => {
  const byDay = { '2026-06-15': 100, '2026-06-12': 30, '2026-06-01': 999 }
  const s = summarizeByDay(byDay, new Date('2026-06-15T12:00:00Z'))
  assert.equal(s.today, 100)
  assert.equal(s.last7, 130) // 06-15 + 06-12 within 7 days; 06-01 excluded
  assert.equal(s.total, 1129)
})
