import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapHookToEvent } from '../src/main/hook-events.js'
import { HOOK_AGENTS, HOOK_AGENTS_BY_ID } from '../src/main/agents/registry.js'

test('codex notify completion maps to a local task_done event', () => {
  const event = mapHookToEvent({ type: 'agent-turn-complete', 'last-assistant-message': '已经完成测试' })
  assert.deepEqual(event, { type: 'task_done', source: 'local', text: '已经完成测试' })
})

test('codex notify captures input-messages as the task prompt (bubble headline)', () => {
  const event = mapHookToEvent({
    type: 'agent-turn-complete',
    'last-assistant-message': '搞定了',
    'input-messages': ['继续 kodama', '读 ROADMAP'],
  })
  assert.deepEqual(event, {
    type: 'task_done',
    source: 'local',
    text: '搞定了',
    prompt: '继续 kodama 读 ROADMAP',
  })
})

test('claude subagent lifecycle maps to local progress bubbles', () => {
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'SubagentStart', subagent_name: 'verifier' }), {
    type: 'task_progress',
    source: 'local',
    text: '子 Agent verifier 开始工作',
    agent: 'verifier',
    subagent: true,
  })
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'SubagentStop', subagent_name: 'verifier' }), {
    type: 'agent_done',
    source: 'local',
    text: '子 Agent verifier 完成',
    agent: 'verifier',
    subagent: true,
  })
})

test('local agent events preserve jump context', () => {
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'SubagentStop',
    subagent_name: 'verifier',
    session_id: 'abc123',
    tty: '/dev/ttys001',
    cwd: '/Users/bytedance/code/kodama',
    transcript_path: '/Users/bytedance/.claude/projects/main.jsonl',
    agent_transcript_path: '/Users/bytedance/.claude/projects/agent.jsonl',
  }), {
    type: 'agent_done',
    source: 'local',
    text: '子 Agent verifier 完成',
    sessionId: 'abc123',
    tty: '/dev/ttys001',
    cwd: '/Users/bytedance/code/kodama',
    transcriptPath: '/Users/bytedance/.claude/projects/main.jsonl',
    agentTranscriptPath: '/Users/bytedance/.claude/projects/agent.jsonl',
    agent: 'verifier',
    subagent: true,
  })
})

test('codex notify payloads preserve local cwd and session id', () => {
  assert.deepEqual(mapHookToEvent({
    type: 'agent-turn-complete',
    'last-assistant-message': '完成了',
    session_id: 'codex-session',
    'thread-id': 'thread-123',
    'turn-id': 'turn-456',
    client: 'Codex Desktop',
    cwd: '/Users/bytedance/code/kodama',
  }), {
    type: 'task_done',
    source: 'local',
    text: '完成了',
    sessionId: 'codex-session',
    threadId: 'thread-123',
    turnId: 'turn-456',
    client: 'Codex Desktop',
    cwd: '/Users/bytedance/code/kodama',
  })
})

test('ask-user tool requests map to a waiting event', () => {
  const event = mapHookToEvent({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })
  assert.deepEqual(event, { type: 'task_waiting', source: 'local', text: 'Agent 在问你问题' })
})

test('task completion and permission requests keep agent names', () => {
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'TaskCompleted', task: { name: 'api-reviewer' } }), {
    type: 'agent_done',
    source: 'local',
    text: 'api-reviewer 完成任务',
    agent: 'api-reviewer',
    subagent: true,
  })
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'PermissionRequest', agent_name: 'executor', reason: '需要运行测试' }), {
    type: 'task_waiting',
    source: 'local',
    text: '需要运行测试',
    agent: 'executor',
  })
})

test('bash test build and git commands map to specific progress events', () => {
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  }), {
    type: 'task_progress',
    source: 'local',
    text: '正在跑测试：pnpm test',
  })
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm run build' },
  }), {
    type: 'task_progress',
    source: 'local',
    text: '构建完成：npm run build',
  })
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git status --short' },
  }), {
    type: 'task_progress',
    source: 'local',
    text: '正在执行 Git 操作：git status --short',
  })
})

test('failed bash commands map to failed build or test events', () => {
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: 'vitest run' },
    error: 'exit 1',
  }), {
    type: 'task_failed',
    source: 'local',
    text: '测试失败：vitest run',
  })
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm run build' },
    success: false,
  }), {
    type: 'task_failed',
    source: 'local',
    text: '构建失败：pnpm run build',
  })
})

test('generic failed bash commands do not mark the whole task failed', () => {
  assert.equal(mapHookToEvent({
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: 'python3 inspect_doc.py' },
    error: 'exit 1',
  }), null)
})

test('context compaction maps to progress bubbles', () => {
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'PreCompact' }), {
    type: 'task_progress',
    source: 'local',
    text: '正在压缩上下文…',
  })
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'PostCompact' }), {
    type: 'task_progress',
    source: 'local',
    text: '上下文压缩完成',
  })
})

test('compaction events still carry local jump context', () => {
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'PreCompact', session_id: 'sess-1', cwd: '/Users/bytedance/code/kodama' }), {
    type: 'task_progress',
    source: 'local',
    text: '正在压缩上下文…',
    sessionId: 'sess-1',
    cwd: '/Users/bytedance/code/kodama',
  })
})

test('permission denial maps to a waiting event and keeps agent name', () => {
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'PermissionDenied', agent_name: 'executor' }), {
    type: 'task_waiting',
    source: 'local',
    text: '权限被拒绝',
    agent: 'executor',
  })
  // snake/camel field aliases both resolve the reason text.
  assert.deepEqual(mapHookToEvent({ hook_event_name: 'PermissionDenied', reason: '无写入权限' }), {
    type: 'task_waiting',
    source: 'local',
    text: '无写入权限',
  })
})

test('hook agent registry exposes claude and codex descriptors', () => {
  const ids = HOOK_AGENTS.map(agent => agent.id).sort()
  assert.deepEqual(ids, ['claude', 'codex'])
  assert.equal(HOOK_AGENTS_BY_ID.get('claude'), HOOK_AGENTS.find(a => a.id === 'claude'))

  for (const agent of HOOK_AGENTS) {
    assert.equal(typeof agent.id, 'string')
    assert.ok(agent.label, `${agent.id} has a label`)
    const cfg = agent.hookConfig
    assert.ok(cfg, `${agent.id} has hookConfig`)
    assert.equal(typeof cfg.configFormat, 'string')
    assert.equal(typeof cfg.settingsPath, 'function')
    assert.equal(typeof cfg.allowCreate, 'boolean')
    assert.ok(Array.isArray(cfg.events) && cfg.events.length > 0, `${agent.id} has events`)
    const resolved = cfg.settingsPath('/home/test')
    assert.ok(resolved.startsWith('/home/test/'), `${agent.id} settingsPath honors home`)
  }

  // The new Claude events must be wired into the registry surface.
  const claudeEvents = HOOK_AGENTS_BY_ID.get('claude').hookConfig.events
  for (const ev of ['PreCompact', 'PostCompact', 'PermissionDenied']) {
    assert.ok(claudeEvents.includes(ev), `claude events include ${ev}`)
  }
})

test('unknown hook payloads are ignored', () => {
  assert.equal(mapHookToEvent({ hook_event_name: 'Nope' }), null)
  assert.equal(mapHookToEvent(null), null)
})
