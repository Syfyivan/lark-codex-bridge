import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  eventAppLabel,
  eventBubbleContext,
  eventProjectLabel,
  eventWorkId,
} from '../src/renderer/event-labels.js'

test('trae internal work directories do not become bubble project names', () => {
  const event = {
    source: 'local',
    type: 'task_done',
    client: 'trae-work',
    agent: 'trae-work',
    cwd: '/Users/bytedance/.trae-cn/work/6a498bdd92c14db1ad4c8bd6',
  }
  assert.equal(eventAppLabel(event), 'Trae Work')
  assert.equal(eventProjectLabel(event), '')
  assert.equal(eventBubbleContext(event), 'Trae Work')
  assert.equal(eventWorkId(event), '6a498bdd92c14db1ad4c8bd6')
})

test('trae internal work bubbles use prompt when available', () => {
  const event = {
    source: 'local',
    type: 'task_done',
    client: 'trae-work',
    prompt: '完成这道 CTF 趣味竞赛题',
    cwd: '/Users/bytedance/.trae-cn/work/6a498bdd92c14db1ad4c8bd6',
  }
  assert.equal(eventBubbleContext(event), 'Trae Work / 完成这道 CTF 趣味竞赛题')
})

test('normal local agent events include both app and project', () => {
  const event = {
    source: 'local',
    type: 'task_done',
    client: 'Codex Desktop',
    cwd: '/Users/bytedance/code/kodama',
  }
  assert.equal(eventBubbleContext(event), 'Codex / kodama')
})
