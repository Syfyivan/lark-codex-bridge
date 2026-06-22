import assert from 'node:assert/strict'
import { test } from 'node:test'

// gif.js's module top-level only defines constants/functions (no `document`), so
// importing it in node is safe as long as we don't call initGifBackend.
const { pickStageFile } = await import('../src/renderer/backends/gif.js')

const SLIME = [
  { file: 'green.png', minLevel: 1 },
  { file: 'blue.png', minLevel: 5 },
  { file: 'yellow.png', minLevel: 15 },
  { file: 'red.png', minLevel: 30 },
  { file: 'purple.png', minLevel: 60 },
]

test('picks the highest stage whose minLevel <= level', () => {
  assert.equal(pickStageFile(SLIME, 1), 'green.png')
  assert.equal(pickStageFile(SLIME, 4), 'green.png')
  assert.equal(pickStageFile(SLIME, 5), 'blue.png')
  assert.equal(pickStageFile(SLIME, 29), 'yellow.png')
  assert.equal(pickStageFile(SLIME, 60), 'purple.png')
  assert.equal(pickStageFile(SLIME, 582), 'purple.png') // high level → final form
})

test('below every threshold falls back to the lowest-minLevel stage', () => {
  const stages = [
    { file: 'b.png', minLevel: 10 },
    { file: 'a.png', minLevel: 5 },
  ]
  assert.equal(pickStageFile(stages, 1), 'a.png') // 1 < 5 → lowest, not array[0]
})

test('order-independent: unsorted stages still pick correctly', () => {
  const shuffled = [
    { file: 'purple.png', minLevel: 60 },
    { file: 'green.png', minLevel: 1 },
    { file: 'red.png', minLevel: 30 },
    { file: 'blue.png', minLevel: 5 },
    { file: 'yellow.png', minLevel: 15 },
  ]
  assert.equal(pickStageFile(shuffled, 20), 'yellow.png')
  assert.equal(pickStageFile(shuffled, 1000), 'purple.png')
})

test('skips entries without a file; empty list yields empty string', () => {
  assert.equal(pickStageFile([{ minLevel: 1 }, { file: 'x.png', minLevel: 2 }], 5), 'x.png')
  assert.equal(pickStageFile([], 5), '')
})

test('missing minLevel defaults to 1', () => {
  assert.equal(pickStageFile([{ file: 'only.png' }], 1), 'only.png')
})
