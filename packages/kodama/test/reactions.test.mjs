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

test('lark_message_received is silent because Feishu already notifies mentions', () => {
  const out = collect({ type: 'lark_message_received', source: 'lark', text: '有人喊我' })
  assert.deepEqual(out.says, [])
  assert.deepEqual(out.status, [])
  assert.deepEqual(out.motions, [])
})

test('lark_reply_sent defaults to the bot own reply copy', () => {
  const out = collect({ type: 'lark_reply_sent', source: 'lark', text: '执行失败' })
  assert.equal(out.says.length, 1)
  assert.match(out.says[0], /菌子回复：执行失败/)
  assert.doesNotMatch(out.says[0], /替你/)
  assert.doesNotMatch(out.says[0], /回了飞书/)
  assert.deepEqual(out.status, ['replying'])
})

test('delegated lark_reply_sent keeps the user proxy copy', () => {
  const out = collect({ type: 'lark_reply_sent', source: 'lark', text: '我稍后处理', delegated: true })
  assert.equal(out.says.length, 1)
  assert.match(out.says[0], /我刚替你回复：我稍后处理/)
  assert.doesNotMatch(out.says[0], /回了飞书/)
  assert.deepEqual(out.status, ['replying'])
})

test('local source uses the 💻 prefix', () => {
  const out = collect({ type: 'task_done', source: 'local', text: '' })
  assert.match(out.says[0], /💻/)
})

test('local Trae bubbles name the app instead of the internal work id', () => {
  const out = collect({
    type: 'task_done',
    source: 'local',
    text: '',
    client: 'trae-work',
    cwd: '/Users/bytedance/.trae-cn/work/6a498bdd92c14db1ad4c8bd6',
  })
  assert.match(out.says[0], /Trae Work/)
  assert.doesNotMatch(out.says[0], /6a498bdd/)
})

test('local Trae bubbles include enriched task context', () => {
  const out = collect({
    type: 'task_done',
    source: 'local',
    text: '任务完成：完成CTF挑战题',
    client: 'trae-work',
    title: '完成CTF挑战题',
    cwd: '/Users/bytedance/.trae-cn/work/6a498bdd92c14db1ad4c8bd6',
  })
  assert.match(out.says[0], /Trae Work/)
  assert.match(out.says[0], /完成CTF挑战题/)
  assert.doesNotMatch(out.says[0], /6a498bdd/)
})

test('agent_done renders the completed agent text', () => {
  const out = collect({ type: 'agent_done', source: 'local', text: 'verifier 完成任务' })
  assert.match(out.says[0], /verifier 完成任务/)
  assert.deepEqual(out.status, ['done'])
})

test('unknown event type is ignored', () => {
  const out = collect({ type: 'nope', source: 'lark' })
  assert.equal(out.says.length, 0)
  assert.equal(out.status.length, 0)
})

test('every configured event has a bubble template', () => {
  for (const [type, def] of Object.entries(PET_CONFIG.events)) {
    if (def.silent) {
      assert.equal(def.bubble || '', '', `${type} silent events should not define a visible bubble`)
    } else {
      assert.ok(typeof def.bubble === 'string' && def.bubble.length, `${type} missing bubble`)
    }
  }
})
