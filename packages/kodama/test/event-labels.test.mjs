import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bridgeTaskShareRequestForEvent,
  eventActorLabel,
  eventAppLabel,
  eventBubbleContext,
  eventCurrentText,
  eventExplicitProjectLabel,
  eventLarkReplyMergeKey,
  eventProjectLabel,
  eventSessionCacheKeys,
  eventSessionTitle,
  eventWorkdirLabel,
  sessionRequestForEvent,
  targetForEvent,
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

test('local agent command progress is robot-labeled without fake Codex link', () => {
  const event = {
    source: 'local',
    type: 'task_progress',
    text: '正在执行 Git 操作：git status --short',
    sessionId: 'cli-session',
    cwd: '/Users/bytedance/code.byted.org',
  }
  assert.equal(eventActorLabel(event), '本机 Agent')
  assert.equal(eventExplicitProjectLabel(event), '')
  assert.equal(eventWorkdirLabel(event), 'code.byted.org')
  assert.equal(eventProjectLabel(event), 'code.byted.org')
  assert.equal(sessionRequestForEvent(event), null)
  assert.equal(targetForEvent(event), null)
  assert.equal(bridgeTaskShareRequestForEvent(event), null)
})

test('bridge-invoked local agent progress is labeled as Feishu bot work', () => {
  const event = {
    source: 'local',
    type: 'task_progress',
    prompt: '你是通过飞书机器人被调用的 Codex，请用中文回答。',
    cwd: '/Users/bytedance/code/lark-codex-bridge',
  }
  assert.equal(eventActorLabel(event), '飞书机器人 Agent')
})

test('Codex transcript without desktop thread opens the local record only', () => {
  const transcriptPath = '/Users/bytedance/.codex/sessions/2026/07/06/rollout-019f0000-1111-2222-3333-444444444444.jsonl'
  const event = {
    source: 'local',
    type: 'task_done',
    text: '完成',
    transcriptPath,
    cwd: '/Users/bytedance/code/kodama',
  }
  assert.equal(sessionRequestForEvent(event)?.provider, 'codex')
  assert.deepEqual(targetForEvent(event), {
    kind: 'local-path',
    path: transcriptPath,
    label: '打开 Codex 记录',
  })
})

test('Codex Desktop thread remains explicitly openable', () => {
  const event = {
    source: 'local',
    type: 'task_done',
    text: '完成',
    client: 'Codex Desktop',
    threadId: 'thread-123',
    turnId: 'turn-456',
    cwd: '/Users/bytedance/code/kodama',
  }
  assert.equal(sessionRequestForEvent(event)?.canOpenCodexThread, true)
  assert.deepEqual(targetForEvent(event), {
    kind: 'codex-thread',
    threadId: 'thread-123',
    turnId: 'turn-456',
    url: 'codex://threads/thread-123',
    label: '打开 Codex 会话',
    fallbackPath: '',
  })
})

test('session title is extracted from explicit title before prompt', () => {
  assert.equal(eventSessionTitle({
    source: 'local',
    type: 'task_progress',
    title: '修复 BuyTogether 登录状态',
    prompt: '很长的原始 prompt',
  }), '修复 BuyTogether 登录状态')
})

test('session title does not fall back to raw user prompt dumps', () => {
  assert.equal(eventSessionTitle({
    source: 'local',
    type: 'task_started',
    prompt: '实现家庭采购商品合并逻辑',
  }), '')
  assert.equal(eventSessionTitle({
    source: 'local',
    type: 'task_progress',
    title: '# Files mentioned by the user: ## codex-clipboard-f55351e3.png',
  }), '')
})

test('session cache keys connect command progress to earlier prompt events', () => {
  const first = {
    source: 'local',
    type: 'task_started',
    prompt: '实现家庭采购商品合并逻辑',
    sessionId: 'sess-1',
    threadId: 'thread-1',
    transcriptPath: '/Users/bytedance/.codex/sessions/2026/07/06/rollout-019f0000-1111-2222-3333-444444444444.jsonl',
    cwd: '/Users/bytedance/code/buy-together',
  }
  const progress = {
    source: 'local',
    type: 'task_progress',
    text: 'Git 操作完成：git status --short',
    sessionId: 'sess-1',
    threadId: 'thread-1',
    cwd: '/Users/bytedance/code/buy-together',
  }
  assert.equal(eventSessionTitle(first), '')
  assert.equal(eventSessionTitle(progress), '')
  assert.ok(eventSessionCacheKeys(first).includes('thread:thread-1'))
  assert.ok(eventSessionCacheKeys(progress).includes('thread:thread-1'))
  assert.ok(eventSessionCacheKeys(first).some(key => key.startsWith('cwd:local:')))
  assert.ok(eventSessionCacheKeys(progress).some(key => key.startsWith('cwd:local:')))
})

test('current hover text prefers latest progress over initial prompt', () => {
  const event = {
    source: 'local',
    type: 'task_progress',
    prompt: '先让菌子给一个表情回复，然后开始review，同时你再给我解答现在的问题。',
    text: 'Git 操作完成：git diff -- packages/bridge/lark-codex-bridge.mjs',
    cwd: '/Users/bytedance/code/lark-codex-bridge',
  }

  assert.equal(
    eventCurrentText(event),
    'Git 操作完成：git diff -- packages/bridge/lark-codex-bridge.mjs',
  )
  assert.doesNotMatch(eventCurrentText(event), /先让菌子/)
})

test('lark reply merge key replaces repeated replies without merging progress', () => {
  const base = {
    source: 'lark',
    chatId: 'oc_chat',
    messageId: 'om_message',
  }
  assert.equal(
    eventLarkReplyMergeKey({ ...base, type: 'lark_reply_sent', text: '仍在处理' }),
    'lark-reply:oc_chat:om_message',
  )
  assert.equal(
    eventLarkReplyMergeKey({ ...base, type: 'lark_reply_sent', text: '正在整理结果' }),
    'lark-reply:oc_chat:om_message',
  )
  assert.equal(
    eventLarkReplyMergeKey({ ...base, type: 'task_progress', text: '正在运行验证' }),
    '',
  )
  assert.equal(
    eventLarkReplyMergeKey({ source: 'lark', type: 'lark_reply_sent', chatId: 'oc_chat' }),
    '',
  )
})

test('bridge task bubbles can share robot process by task or message scope', () => {
  assert.deepEqual(
    bridgeTaskShareRequestForEvent({
      source: 'lark',
      type: 'task_progress',
      taskId: 'task-123',
      contextKey: 'thread:oc_chat:om_message',
      chatId: 'oc_chat',
      messageId: 'om_message',
      text: '仍在处理',
    }, {
      bridgeUrl: 'http://127.0.0.1:8787',
      token: 'bridge-token',
    }),
    {
      bridgeUrl: 'http://127.0.0.1:8787',
      token: 'bridge-token',
      limit: 1,
      taskId: 'task-123',
    },
  )

  assert.deepEqual(
    bridgeTaskShareRequestForEvent({
      source: 'lark',
      type: 'lark_reply_sent',
      contextKey: 'thread:oc_chat:om_message',
      chatId: 'oc_chat',
      messageId: 'om_message',
      text: '仍在处理',
    }),
    {
      bridgeUrl: '',
      token: '',
      limit: 20,
      contextKey: 'thread:oc_chat:om_message',
      chatId: 'oc_chat',
      messageId: 'om_message',
    },
  )

  assert.equal(
    bridgeTaskShareRequestForEvent({
      source: 'lark',
      type: 'lark_message_received',
      chatId: 'oc_chat',
      messageId: 'om_message',
    }),
    null,
  )
})
