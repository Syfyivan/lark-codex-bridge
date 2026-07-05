import assert from 'node:assert/strict'
import path from 'node:path'
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

test('codex internal title-generation notify is ignored', () => {
  const event = mapHookToEvent({
    type: 'agent-turn-complete',
    'last-assistant-message': '{"title":"审阅简历问题"}',
    'input-messages': [
      'Generate a concise UI title (up to 36 characters) for this task.',
      'Do NOT respond to the user, answer questions, or attempt to solve the problem.',
    ],
    cwd: '/Users/bytedance/code',
    client: 'Codex Desktop',
  })
  assert.equal(event, null)
})

test('codex internal memory maintenance notify is ignored', () => {
  const event = mapHookToEvent({
    type: 'agent-turn-complete',
    'last-assistant-message': '完成',
    'input-messages': ['update memories'],
    session_id: 'memory-session',
    'thread-id': 'memory-thread',
    client: 'Codex Desktop',
    cwd: '/Users/bytedance/.codex/memories',
  })
  assert.equal(event, null)
})

test('codex internal memory hook sessions are ignored', () => {
  assert.equal(mapHookToEvent({
    hook_event_name: 'SessionStart',
    session_id: 'memory-session',
    cwd: '/Users/bytedance/.codex/memories',
  }), null)

  assert.equal(mapHookToEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'memory-session',
    cwd: '/Users/bytedance/.codex/memories',
    prompt: '## Memory Writing Agent: Phase 2',
  }), null)

  assert.equal(mapHookToEvent({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git status --short' },
    session_id: 'memory-session',
    cwd: '/Users/bytedance/.codex/memories',
  }), null)

  assert.equal(mapHookToEvent({
    hook_event_name: 'Stop',
    session_id: 'memory-session',
    cwd: '/Users/bytedance/.codex/memories',
    last_assistant_message: 'Updated memory artifacts',
  }), null)
})

test('ordinary projects named memories are still surfaced', () => {
  const event = mapHookToEvent({
    type: 'agent-turn-complete',
    'last-assistant-message': '完成',
    session_id: 'normal-session',
    client: 'Codex Desktop',
    cwd: '/Users/bytedance/code/memories',
  })
  assert.deepEqual(event, {
    type: 'task_done',
    source: 'local',
    text: '完成',
    sessionId: 'normal-session',
    client: 'Codex Desktop',
    cwd: '/Users/bytedance/code/memories',
  })

  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'SessionStart',
    session_id: 'normal-session',
    cwd: '/Users/bytedance/code/memories',
  }), {
    type: 'task_started',
    source: 'local',
    text: '/Users/bytedance/code/memories',
    sessionId: 'normal-session',
    cwd: '/Users/bytedance/code/memories',
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

test('trae hook aliases preserve work session context', () => {
  assert.deepEqual(mapHookToEvent({
    hookEventName: 'UserPromptSubmit',
    prompt: '继续改首页',
    conversationId: 'trae-session',
    operationId: 'trae-turn',
    repoWorkingDir: '/Users/bytedance/code/project',
    agent: 'trae-work',
  }), {
    type: 'task_started',
    source: 'local',
    text: '继续改首页',
    prompt: '继续改首页',
    sessionId: 'trae-session',
    cwd: '/Users/bytedance/code/project',
    turnId: 'trae-turn',
    client: 'trae-work',
    agent: 'trae-work',
  })
})

test('trae session end keeps agent and internal work context for readable bubbles', () => {
  assert.deepEqual(mapHookToEvent({
    hookEventName: 'SessionEnd',
    conversationId: 'trae-session',
    operationId: 'trae-turn',
    repoWorkingDir: '/Users/bytedance/.trae-cn/work/6a498bdd92c14db1ad4c8bd6',
    agent: 'trae-work',
  }), {
    type: 'task_done',
    source: 'local',
    text: '',
    sessionId: 'trae-session',
    cwd: '/Users/bytedance/.trae-cn/work/6a498bdd92c14db1ad4c8bd6',
    turnId: 'trae-turn',
    client: 'trae-work',
    agent: 'trae-work',
  })
})

test('trae lifecycle payloads without hook event names are inferred conservatively', () => {
  assert.deepEqual(mapHookToEvent({
    type: 'completed',
    message: '任务完成',
    conversationId: 'trae-session',
    operationId: 'trae-turn',
    repoWorkingDir: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
  }), {
    type: 'task_done',
    source: 'local',
    text: '任务完成',
    sessionId: 'trae-session',
    cwd: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
    turnId: 'trae-turn',
  })

  assert.deepEqual(mapHookToEvent({
    event: 'task_failed',
    error: 'quota exceeded',
    conversationId: 'trae-session',
    repoWorkingDir: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
    agent: 'trae-work',
  }), {
    type: 'task_failed',
    source: 'local',
    text: 'quota exceeded',
    sessionId: 'trae-session',
    cwd: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
    client: 'trae-work',
    agent: 'trae-work',
  })
})

test('trae queue notifications are diagnostic only, not completion bubbles', () => {
  assert.equal(mapHookToEvent({
    type: 'queue',
    message: 'Too many current requests. Your queue position is 60.',
    conversationId: 'trae-session',
    repoWorkingDir: '/Users/bytedance/.trae-cn/work/6a48fd5292c14db1ad4c8657',
  }), null)
})

test('known third-party agent payloads can report lifecycle events conservatively', () => {
  assert.deepEqual(mapHookToEvent({
    client: 'Gemini CLI',
    type: 'completed',
    summary: '重构完成',
    prompt: '整理 hook 适配',
    workspacePath: '/Users/bytedance/code/kodama',
  }), {
    type: 'task_done',
    source: 'local',
    text: '重构完成',
    prompt: '整理 hook 适配',
    cwd: '/Users/bytedance/code/kodama',
    client: 'Gemini CLI',
  })

  assert.deepEqual(mapHookToEvent({
    source_app: 'Cursor',
    status: 'failed',
    error: 'lint failed',
    workspacePath: '/Users/bytedance/code/site',
  }), {
    type: 'task_failed',
    source: 'local',
    text: 'lint failed',
    cwd: '/Users/bytedance/code/site',
    client: 'Cursor',
  })

  assert.deepEqual(mapHookToEvent({
    agent_app: 'Qwen Code',
    state: 'needs_input',
    reason: '需要确认权限',
  }), {
    type: 'task_waiting',
    source: 'local',
    text: '需要确认权限',
    client: 'Qwen Code',
  })
})

test('generic lifecycle inference ignores unknown or noisy payloads', () => {
  assert.equal(mapHookToEvent({ type: 'completed', message: 'done' }), null)
  assert.equal(mapHookToEvent({ client: 'Gemini CLI', type: 'queue', message: 'queue position 3' }), null)
})

test('gemini and windsurf hook aliases map to useful local events', () => {
  assert.deepEqual(mapHookToEvent({
    hook_event_name: 'AfterAgent',
    client: 'Gemini CLI',
    summary: 'Agent loop finished',
    cwd: '/Users/bytedance/code/kodama',
  }), {
    type: 'task_done',
    source: 'local',
    text: 'Agent loop finished',
    cwd: '/Users/bytedance/code/kodama',
    client: 'Gemini CLI',
  })

  assert.deepEqual(mapHookToEvent({
    agent_action_name: 'post_run_command',
    source_app: 'Windsurf Cascade',
    tool_info: {
      command_line: 'npm run build',
      cwd: '/Users/bytedance/code/app',
    },
  }), {
    type: 'task_progress',
    source: 'local',
    text: '构建完成：npm run build',
    cwd: '/Users/bytedance/code/app',
    client: 'Windsurf Cascade',
  })
})

test('trae RunCommand payload aliases map to command progress', () => {
  assert.deepEqual(mapHookToEvent({
    hookEventName: 'PreToolUse',
    toolName: 'RunCommand',
    toolInput: { command: 'pnpm test' },
    conversationId: 'trae-session',
    repoWorkingDir: '/Users/bytedance/code/project',
  }), {
    type: 'task_progress',
    source: 'local',
    text: '正在跑测试：pnpm test',
    sessionId: 'trae-session',
    cwd: '/Users/bytedance/code/project',
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
  assert.deepEqual(ids, ['claude', 'codex', 'gemini', 'qwen', 'trae', 'trae-cli', 'trae-cn'])
  assert.equal(HOOK_AGENTS_BY_ID.get('claude'), HOOK_AGENTS.find(a => a.id === 'claude'))
  assert.equal(HOOK_AGENTS_BY_ID.get('trae-cn'), HOOK_AGENTS.find(a => a.id === 'trae-cn'))

  for (const agent of HOOK_AGENTS) {
    assert.equal(typeof agent.id, 'string')
    assert.ok(agent.label, `${agent.id} has a label`)
    const cfg = agent.hookConfig
    assert.ok(cfg, `${agent.id} has hookConfig`)
    assert.equal(typeof cfg.configFormat, 'string')
    assert.equal(typeof cfg.settingsPath, 'function')
    assert.equal(typeof cfg.allowCreate, 'boolean')
    assert.ok(Array.isArray(cfg.events) && cfg.events.length > 0, `${agent.id} has events`)
    const fakeHome = path.join(path.sep, 'home', 'test')
    const resolved = cfg.settingsPath(fakeHome)
    assert.ok(resolved.startsWith(`${fakeHome}${path.sep}`), `${agent.id} settingsPath honors home`)
  }

  // The new Claude events must be wired into the registry surface.
  const claudeEvents = HOOK_AGENTS_BY_ID.get('claude').hookConfig.events
  for (const ev of ['PreCompact', 'PostCompact', 'PermissionDenied']) {
    assert.ok(claudeEvents.includes(ev), `claude events include ${ev}`)
  }

  const traeEvents = HOOK_AGENTS_BY_ID.get('trae').hookConfig.events
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']) {
    assert.ok(traeEvents.includes(ev), `trae events include ${ev}`)
  }
  assert.equal(HOOK_AGENTS_BY_ID.get('trae-cli').hookConfig.configFormat, 'trae-cli-toml')

  assert.equal(HOOK_AGENTS_BY_ID.get('gemini').hookConfig.endpointPath, '/hooks/gemini')
  assert.ok(HOOK_AGENTS_BY_ID.get('gemini').hookConfig.events.includes('AfterAgent'))
  assert.equal(HOOK_AGENTS_BY_ID.get('qwen').hookConfig.endpointPath, '/hooks/qwen')
  assert.ok(HOOK_AGENTS_BY_ID.get('qwen').hookConfig.events.includes('Stop'))
})

test('unknown hook payloads are ignored', () => {
  assert.equal(mapHookToEvent({ hook_event_name: 'Nope' }), null)
  assert.equal(mapHookToEvent(null), null)
})
