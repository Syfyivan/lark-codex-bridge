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

const { initGrowth, feed, statusText, getState } = await import('../src/renderer/growth.js')

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
