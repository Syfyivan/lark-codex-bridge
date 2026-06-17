import assert from 'node:assert/strict'
import { test } from 'node:test'

// growth.js talks to window.pet; stub it before importing.
let loadedState = null
let saved = null
globalThis.window = {
  pet: {
    getState: async () => loadedState,
    saveState: (s) => {
      saved = s
    },
  },
}

const { initGrowth, feed, feedTokens, statusText, getState, equipAccessory } = await import('../src/renderer/growth.js')

function setLoadedState(state) {
  loadedState = state
  saved = null
}

test('task_done events accrue exp and eventually level up', async () => {
  setLoadedState(null)
  await initGrowth({ say() {}, playMotion() {} })
  assert.equal(getState().level, 1)
  // 5 * 8 exp = 40, first level needs 20 -> should reach Lv.2+
  for (let i = 0; i < 5; i++) feed('task_done')
  assert.ok(getState().level >= 2, `expected level >= 2, got ${getState().level}`)
  assert.match(statusText(), /Lv\.\d+ · 🍖\d+/)
  assert.ok(saved && saved.level === getState().level, 'state should be persisted')
})

test('unknown event type feeds nothing', async () => {
  setLoadedState(null)
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

test('old growth state is migrated with level-based accessory unlocks', async () => {
  setLoadedState({ level: 3, exp: 0, food: 0, totalFed: 0 })
  await initGrowth({ say() {}, playMotion() {} })
  assert.deepEqual(getState().unlockedAccessories, ['sprout', 'round_glasses', 'agent_badge'])
  assert.deepEqual(getState().equippedAccessories, {})
  assert.deepEqual(saved.unlockedAccessories, ['sprout', 'round_glasses', 'agent_badge'])
})

test('equipping an unlocked accessory persists by slot', async () => {
  setLoadedState({ level: 2, exp: 0, food: 0, totalFed: 0 })
  await initGrowth({ say() {}, playMotion() {} })
  const result = equipAccessory({ id: 'round_glasses' })
  assert.equal(result.ok, true)
  assert.equal(getState().equippedAccessories.face, 'round_glasses')
  assert.equal(saved.equippedAccessories.face, 'round_glasses')
})

test('locked accessories cannot be equipped', async () => {
  setLoadedState({ level: 1, exp: 0, food: 0, totalFed: 0 })
  await initGrowth({ say() {}, playMotion() {} })
  const result = equipAccessory({ id: 'focus_halo' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /Lv\.5/)
  assert.equal(getState().equippedAccessories.aura, undefined)
})
