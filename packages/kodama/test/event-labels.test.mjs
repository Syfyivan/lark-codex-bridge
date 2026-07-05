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

test('common coding agents get readable app labels', () => {
  const cases = [
    ['Cursor Agent', 'Cursor'],
    ['Windsurf Cascade', 'Windsurf'],
    ['Gemini CLI', 'Gemini CLI'],
    ['Qwen Code', 'Qwen Code'],
    ['opencode', 'OpenCode'],
    ['goose', 'Goose'],
    ['Amp Code', 'Amp'],
    ['aider', 'Aider'],
    ['Zed Agent', 'Zed'],
    ['Roo Code', 'Roo Code'],
    ['Cline', 'Cline'],
    ['GitHub Copilot', 'GitHub Copilot'],
    ['Devin', 'Devin'],
  ]

  for (const [client, expected] of cases) {
    assert.equal(eventAppLabel({ source: 'local', client }), expected)
  }
})

test('third-party agent bubbles include app and project when available', () => {
  const event = {
    source: 'local',
    type: 'task_done',
    client: 'Gemini CLI',
    workspacePath: '/Users/bytedance/code/agent-demo',
  }
  assert.equal(eventBubbleContext(event), 'Gemini CLI / agent-demo')
})
