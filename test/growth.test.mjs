import assert from 'node:assert/strict'
import { test } from 'node:test'

// growth.js talks to window.pet; stub it before importing.
let saved = null
globalThis.window = {
  pet: {
    getState: async () => null,
    saveState: (s) => {
      saved = s
    },
  },
}

const { initGrowth, feed, feedTokens, statusText, getState } = await import('../src/renderer/growth.js')

test('task_done events accrue exp and eventually level up', async () => {
  await initGrowth({ say() {}, playMotion() {} })
  assert.equal(getState().level, 1)
  // 5 * 8 exp = 40, first level needs 20 -> should reach Lv.2+
  for (let i = 0; i < 5; i++) feed('task_done')
  assert.ok(getState().level >= 2, `expected level >= 2, got ${getState().level}`)
  assert.match(statusText(), /Lv\.\d+ · 🍖\d+/)
  assert.ok(saved && saved.level === getState().level, 'state should be persisted')
})

test('unknown event type feeds nothing', async () => {
  await initGrowth({ say() {}, playMotion() {} })
  const before = getState().exp
  feed('definitely-not-an-event')
  assert.equal(getState().exp, before)
})

test('feedTokens only sets a baseline on first call (no feed)', () => {
  const before = getState().food
  feedTokens(10000) // first call -> baseline
  assert.equal(getState().food, before)
  assert.equal(getState().lastTokens, 10000)
})

test('feedTokens feeds the delta afterwards (2000 tok = 1 food)', () => {
  const before = getState().food
  feedTokens(10000 + 4000) // +4000 tokens => +2 food
  assert.equal(getState().food, before + 2)
})
