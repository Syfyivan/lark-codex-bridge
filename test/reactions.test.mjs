import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PET_CONFIG } from '../src/renderer/config/pet-config.js'
import { reactToEvent } from '../src/renderer/reactions.js'

function collect(event) {
  const out = { says: [], status: [], motions: [] }
  reactToEvent(event, {
    say: (t) => out.says.push(t),
    onStatus: (s) => out.status.push(s),
    playMotion: (m) => out.motions.push(m),
  })
  return out
}

test('lark task_done renders a 💬-prefixed bubble with the summary', () => {
  const out = collect({ type: 'task_done', source: 'lark', text: '改完了' })
  assert.equal(out.says.length, 1)
  assert.match(out.says[0], /💬/)
  assert.match(out.says[0], /改完了/)
  assert.deepEqual(out.status, ['done'])
})

test('local source uses the 💻 prefix', () => {
  const out = collect({ type: 'task_done', source: 'local', text: '' })
  assert.match(out.says[0], /💻/)
})

test('unknown event type is ignored', () => {
  const out = collect({ type: 'nope', source: 'lark' })
  assert.equal(out.says.length, 0)
  assert.equal(out.status.length, 0)
})

test('every configured event has a bubble template', () => {
  for (const [type, def] of Object.entries(PET_CONFIG.events)) {
    assert.ok(typeof def.bubble === 'string' && def.bubble.length, `${type} missing bubble`)
  }
})
