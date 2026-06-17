function clampText(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function toolName(data) {
  return clampText(data.tool_name || data.toolName || data.tool?.name || data.tool_input?.name || data.toolInput?.name || '')
}

function commandText(data) {
  const input = data?.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {}
  const camel = data?.toolInput && typeof data.toolInput === 'object' ? data.toolInput : {}
  const raw = firstString(
    input.command,
    input.cmd,
    input.script,
    input.args && Array.isArray(input.args) ? input.args.join(' ') : '',
    camel.command,
    camel.cmd,
    data?.command,
    data?.cmd,
  )
  return clampText(raw, 160)
}

function agentName(data) {
  return clampText(
    data.agent_name
      || data.agentName
      || data.subagent_name
      || data.subagentName
      || data.teammate_name
      || data.teammateName
      || data.task?.agent
      || data.task?.name
      || data.task?.title
      || data.name
      || data.role
      || '',
  )
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function commandCategory(command) {
  const text = String(command || '')
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ')
  if (/(^|[;&|()\s])git(\s|$)/i.test(normalized)) return 'git'
  if (/(^|[;&|()\s])(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|unit|vitest|jest|coverage)\b/i.test(normalized)) return 'test'
  if (/(^|[;&|()\s])(?:go|cargo|swift)\s+test\b/i.test(normalized)) return 'test'
  if (/(^|[;&|()\s])(?:pytest|vitest|jest|mocha|xcodebuild\s+test)\b/i.test(normalized)) return 'test'
  if (/(^|[;&|()\s])(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:build|compile|typecheck|lint)\b/i.test(normalized)) return 'build'
  if (/(^|[;&|()\s])(?:go|cargo)\s+build\b/i.test(normalized)) return 'build'
  if (/(^|[;&|()\s])(?:tsc|vite\s+build|webpack|rollup|next\s+build)\b/i.test(normalized)) return 'build'
  return ''
}

function commandSummary(command) {
  const text = clampText(command, 72)
  return text ? `：${text}` : ''
}

function commandEvent(data, { done = false, failed = false } = {}) {
  const name = toolName(data)
  const command = commandText(data)
  const category = commandCategory(command)
  if (!category && !/^(Bash|Shell|Terminal|Git)$/i.test(name)) return null
  if (category === 'test') {
    return withLocalContext({
      type: failed ? 'task_failed' : 'task_progress',
      source: 'local',
      text: failed ? `测试失败${commandSummary(command)}` : done ? `测试完成${commandSummary(command)}` : `正在跑测试${commandSummary(command)}`,
    }, data)
  }
  if (category === 'build') {
    return withLocalContext({
      type: failed ? 'task_failed' : 'task_progress',
      source: 'local',
      text: failed ? `构建失败${commandSummary(command)}` : done ? `构建完成${commandSummary(command)}` : `正在构建${commandSummary(command)}`,
    }, data)
  }
  if (category === 'git' || /^Git$/i.test(name)) {
    return withLocalContext({
      type: failed ? 'task_failed' : 'task_progress',
      source: 'local',
      text: failed ? `Git 操作失败${commandSummary(command)}` : done ? `Git 操作完成${commandSummary(command)}` : `正在执行 Git 操作${commandSummary(command)}`,
    }, data)
  }
  return null
}

function localContext(data) {
  const task = data?.task && typeof data.task === 'object' ? data.task : {}
  const toolInput = data?.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {}
  const context = {}
  const sessionId = firstString(data?.session_id, data?.sessionId, data?.session)
  const cwd = firstString(
    data?.cwd,
    data?.current_dir,
    data?.currentDir,
    data?.project_dir,
    data?.projectDir,
    data?.workspace,
    data?.workspace_path,
    task.cwd,
    task.project_dir,
    task.projectDir,
    toolInput.cwd,
  )
  const transcriptPath = firstString(data?.transcript_path, data?.transcriptPath)
  const agentTranscriptPath = firstString(data?.agent_transcript_path, data?.agentTranscriptPath)
  const agentId = firstString(data?.agent_id, data?.agentId, task.agent_id, task.agentId)
  const threadId = firstString(data?.['thread-id'], data?.thread_id, data?.threadId)
  const turnId = firstString(data?.['turn-id'], data?.turn_id, data?.turnId)
  const client = firstString(data?.client, data?.originator, data?.source_app, data?.sourceApp)
  const tty = firstString(data?.tty, data?.terminal_tty, data?.terminalTty)
  if (sessionId) context.sessionId = sessionId
  if (cwd) context.cwd = cwd
  if (transcriptPath) context.transcriptPath = transcriptPath
  if (agentTranscriptPath) context.agentTranscriptPath = agentTranscriptPath
  if (agentId) context.agentId = agentId
  if (threadId) context.threadId = threadId
  if (turnId) context.turnId = turnId
  if (client) context.client = client
  if (tty) context.tty = tty
  return context
}

function withLocalContext(event, data) {
  const context = localContext(data)
  return Object.keys(context).length ? { ...event, ...context } : event
}

function withAgent(event, data) {
  const agent = agentName(data)
  const withContext = withLocalContext(event, data)
  return agent ? { ...withContext, agent } : withContext
}

function codexNotifyToEvent(data) {
  if (data.type === 'agent-turn-complete') {
    return withLocalContext({ type: 'task_done', source: 'local', text: clampText(data['last-assistant-message']) }, data)
  }
  if (/permission|approval|confirm|ask/i.test(String(data.type || ''))) {
    return withLocalContext({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || '需要你确认') }, data)
  }
  return null
}

function mapHookToEvent(data) {
  if (!data || typeof data !== 'object') return null

  // Codex `notify` payloads use `type` (no hook_event_name).
  if (!data.hook_event_name && data.type) return codexNotifyToEvent(data)

  switch (data.hook_event_name) {
    case 'SessionStart':
    case 'UserPromptSubmit':
      return withLocalContext({ type: 'task_started', source: 'local', text: clampText(data.prompt || data.cwd || '') }, data)
    case 'PermissionRequest':
      return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || 'Agent 需要你确认') }, data)
    case 'PreToolUse': {
      const name = toolName(data)
      if (/AskUserQuestion/i.test(name)) {
        return withAgent({ type: 'task_waiting', source: 'local', text: 'Agent 在问你问题' }, data)
      }
      const command = commandEvent(data)
      if (command) return command
      return withLocalContext({ type: 'task_progress', source: 'local', text: name ? `正在用工具：${name}` : '正在调用工具' }, data)
    }
    case 'PostToolUse': {
      const name = toolName(data)
      const command = commandEvent(data, { done: true, failed: data.error || data.success === false })
      if (command) return command
      return withLocalContext({ type: 'task_progress', source: 'local', text: name ? `工具完成：${name}` : '工具调用完成' }, data)
    }
    case 'SubagentStart':
      return withAgent({ type: 'task_progress', source: 'local', text: agentName(data) ? `子 Agent ${agentName(data)} 开始工作` : '子 Agent 开始工作' }, data)
    case 'SubagentStop':
      return withAgent({ type: 'agent_done', source: 'local', text: agentName(data) ? `子 Agent ${agentName(data)} 完成` : '子 Agent 完成' }, data)
    case 'TeammateIdle':
      return withAgent({ type: 'task_waiting', source: 'local', text: agentName(data) ? `${agentName(data)} 等你输入` : 'Agent Team 等你输入' }, data)
    case 'TaskCreated':
      return withAgent({ type: 'task_progress', source: 'local', text: agentName(data) ? `${agentName(data)} 开始任务` : 'Agent Team 新任务创建' }, data)
    case 'TaskCompleted':
      return withAgent({ type: 'agent_done', source: 'local', text: agentName(data) ? `${agentName(data)} 完成任务` : 'Agent Team 任务完成' }, data)
    case 'Stop':
    case 'SessionEnd':
      return withLocalContext({ type: 'task_done', source: 'local', text: '' }, data)
    case 'PostToolUseFailure':
      return commandEvent(data, { failed: true }) || withLocalContext({ type: 'task_failed', source: 'local', text: clampText(data.error || data.message || '本地 Agent 失败') }, data)
    case 'StopFailure':
      return withLocalContext({ type: 'task_failed', source: 'local', text: clampText(data.error || data.message || '本地 Agent 失败') }, data)
    case 'Notification':
      if (data.notification_type === 'idle_prompt') return withLocalContext({ type: 'task_done', source: 'local', text: '' }, data)
      return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.notification_type || '需要你确认') }, data)
    default:
      return null
  }
}

module.exports = { mapHookToEvent }
