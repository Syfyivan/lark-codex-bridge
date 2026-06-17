import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { createPomodoro } = require('../src/main/pomodoro.js')

test('focus completes -> reward + short break', () => {
  let rewards = 0
  const p = createPomodoro({ focus: 2, short: 1, longEvery: 4, onReward: () => rewards++ })
  p.start()
  assert.equal(p.state().phase, 'focus')
  p.tick()
  p.tick() // remaining 2 -> 0
  assert.equal(rewards, 1)
  assert.equal(p.state().completed, 1)
  assert.equal(p.state().phase, 'short_break')
})

test('every Nth focus triggers a long break', () => {
  const p = createPomodoro({ focus: 1, short: 1, long: 1, longEvery: 2 })
  p.start()
  p.tick() // focus#1 done -> short_break (1 % 2 != 0)
  p.tick() // short done -> focus
  p.tick() // focus#2 done -> long_break (2 % 2 == 0)
  assert.equal(p.state().phase, 'long_break')
})

test('abandon during focus gives no reward and returns to idle', () => {
  let rewards = 0
  const p = createPomodoro({ focus: 5, onReward: () => rewards++ })
  p.start()
  p.tick()
  p.abandon()
  assert.equal(rewards, 0)
  assert.equal(p.state().phase, 'idle')
})

test('pause stops the countdown', () => {
  const p = createPomodoro({ focus: 5 })
  p.start()
  const r0 = p.state().remaining
  p.pauseResume()
  p.tick()
  assert.equal(p.state().remaining, r0) // unchanged while paused
})

test('configure updates future durations and caps current remaining time', () => {
  const p = createPomodoro({ focus: 10, short: 3, long: 6, longEvery: 4 })
  p.start()
  p.tick()
  assert.equal(p.state().remaining, 9)
  p.configure({ focus: 5, short: 2, long: 4, longEvery: 2 })
  assert.equal(p.state().remaining, 5)
  assert.deepEqual(p.settings(), { focus: 5, short: 2, long: 4, longEvery: 2 })
  while (p.state().phase === 'focus') p.tick()
  assert.equal(p.state().phase, 'short_break')
  assert.equal(p.state().remaining, 2)
})
