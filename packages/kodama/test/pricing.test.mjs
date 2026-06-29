import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { costFor, normalizeModel } = require('../src/main/pricing.js')
const { summarize } = require('../src/main/token-usage.js')

const M = 1_000_000

test('costFor prices input + output per million for a known model', () => {
  // opus-4-8: $5 input, $25 output per 1M
  assert.equal(costFor('claude-opus-4-8', { input: M, output: M }), 30)
  assert.equal(costFor('claude-opus-4-8', { input: M }), 5)
  assert.equal(costFor('claude-opus-4-8', { output: M }), 25)
})

test('costFor prices cache tokens (write premium + read discount)', () => {
  // Claude: cacheWrite ≈ 1.25x input, cacheRead ≈ 0.1x input
  assert.equal(costFor('claude-opus-4-8', { cacheCreate: M }), 6.25)
  assert.equal(costFor('claude-opus-4-8', { cacheRead: M }), 0.5)
})

test('costFor normalizes provider prefix, :tag suffix, and date alias', () => {
  const base = costFor('claude-opus-4-8', { input: M })
  assert.equal(costFor('anthropic/claude-opus-4-8', { input: M }), base)
  assert.equal(costFor('claude-opus-4-8:thinking', { input: M }), base)
  // dated sonnet alias resolves to the sonnet family ($15 output / 1M)
  assert.equal(costFor('claude-sonnet-4-5-20250929', { output: M }), 15)
})

test('normalizeModel strips prefix/tag/date', () => {
  assert.equal(normalizeModel('OpenAI/GPT-5-Codex'), 'gpt-5-codex')
  assert.equal(normalizeModel('claude-opus-4-8:1m'), 'claude-opus-4-8')
  assert.equal(normalizeModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5')
})

test('costFor prices gpt-5.x (Codex) family', () => {
  // gpt-5: $1.25 input, $10 output per 1M
  assert.equal(costFor('gpt-5', { input: M, output: M }), 11.25)
  // mini / nano fall to their tiers via the family heuristic
  assert.equal(costFor('gpt-5-mini', { output: M }), 2)
  assert.equal(costFor('gpt-5-nano', { input: M }), 0.05)
})

test('unknown model falls back to a nonzero approximate', () => {
  assert.ok(costFor('some-future-model', { input: M }) > 0)
})

function writeClaudeCostFixture() {
  const root = mkdtempSync(join(tmpdir(), 'kodama-cost-'))
  const proj = join(root, 'projZ')
  mkdirSync(proj, { recursive: true })
  const lines = [
    // opus: 1M input + 1M output = $5 + $25 = $30
    {
      timestamp: '2026-06-15T01:00:00Z',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: M, output_tokens: M } },
    },
    // sonnet: 1M input + 1M cache_read = $3 + 0.1*$3 = $3.30
    {
      timestamp: '2026-06-15T02:00:00Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: M, output_tokens: 0, cache_read_input_tokens: M },
      },
    },
  ]
  writeFileSync(join(proj, 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return root
}

test('summarize adds a cost field roughly matching the hand-computed total', () => {
  const claudeRoot = writeClaudeCostFixture()
  const now = new Date('2026-06-15T12:00:00Z')
  const s = summarize({ claudeRoot, codexRoot: '/nonexistent', now })
  // existing token shape is preserved
  assert.equal(s.total, M + M + M + M) // 4M tokens
  assert.ok(s.byDay)
  // new cost field: 30 + 3.30 = 33.30
  assert.ok(Math.abs(s.cost.total - 33.3) < 1e-6, `got ${s.cost.total}`)
  assert.ok(Math.abs(s.cost.today - 33.3) < 1e-6)
  assert.ok(Math.abs(s.cost.last7 - 33.3) < 1e-6)
})
