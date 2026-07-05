function clampText(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function toolName(data) {
  return clampText(data.tool_name || data.toolName || data.tool_id || data.toolId || data.tool?.name || data.tool_input?.name || data.toolInput?.name || '')
}

function commandText(data) {
  const input = data?.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {}
  const camel = data?.toolInput && typeof data.toolInput === 'object' ? data.toolInput : {}
  const toolInfo = data?.tool_info && typeof data.tool_info === 'object' ? data.tool_info : {}
  const camelToolInfo = data?.toolInfo && typeof data.toolInfo === 'object' ? data.toolInfo : {}
  const raw = firstString(
    input.command,
    input.cmd,
    input.script,
    input.args && Array.isArray(input.args) ? input.args.join(' ') : '',
    camel.command,
    camel.cmd,
    toolInfo.command_line,
    toolInfo.commandLine,
    camelToolInfo.command_line,
    camelToolInfo.commandLine,
    data?.command,
    data?.cmd,
  )
  return clampText(raw, 160)
}

function agentName(data) {
  return clampText(
    data.agent_name
      || data.agentName
      || data.agent
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

function queryText(value) {
  if (!Array.isArray(value)) return ''
  return value.map((item) => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return ''
    if (item.type && String(item.type).toLowerCase() !== 'text') return ''
    const data = item.data && typeof item.data === 'object' ? item.data : {}
    return firstString(data.content, data.text, item.content, item.text)
  }).filter(Boolean).join(' ')
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
  const camelToolInput = data?.toolInput && typeof data.toolInput === 'object' ? data.toolInput : {}
  const toolInfo = data?.tool_info && typeof data.tool_info === 'object' ? data.tool_info : {}
  const camelToolInfo = data?.toolInfo && typeof data.toolInfo === 'object' ? data.toolInfo : {}
  const context = {}
  const sessionId = firstString(data?.session_id, data?.sessionId, data?.session, data?.conversation_id, data?.conversationId)
  const cwd = firstString(
    data?.cwd,
    data?.current_dir,
    data?.currentDir,
    data?.project_dir,
    data?.projectDir,
    data?.repo_working_dir,
    data?.repoWorkingDir,
    data?.workspace,
    data?.workspace_path,
    data?.workspacePath,
    data?.root,
    data?.root_dir,
    data?.rootDir,
    task.cwd,
    task.project_dir,
    task.projectDir,
    toolInput.cwd,
    camelToolInput.cwd,
    toolInfo.cwd,
    camelToolInfo.cwd,
  )
  const transcriptPath = firstString(data?.transcript_path, data?.transcriptPath)
  const agentTranscriptPath = firstString(data?.agent_transcript_path, data?.agentTranscriptPath)
  const agentId = firstString(data?.agent_id, data?.agentId, task.agent_id, task.agentId)
  const threadId = firstString(data?.['thread-id'], data?.thread_id, data?.threadId)
  const turnId = firstString(data?.['turn-id'], data?.turn_id, data?.turnId, data?.operation_id, data?.operationId)
  const client = firstString(data?.kodama_agent, data?.kodamaAgent, data?.agent_app, data?.agentApp, data?.client, data?.originator, data?.source_app, data?.sourceApp, data?.app, data?.appName, data?.agent)
  const tty = firstString(data?.tty, data?.terminal_tty, data?.terminalTty)
  const userMessage = data?.userMessage && typeof data.userMessage === 'object' ? data.userMessage : {}
  const snakeUserMessage = data?.user_message && typeof data.user_message === 'object' ? data.user_message : {}
  const query = typeof data?.query === 'string' ? data.query : queryText(data?.query)
  const prompt = firstString(
    data?.prompt,
    data?.user_prompt,
    data?.userPrompt,
    query,
    data?.input,
    data?.instruction,
    queryText(userMessage.query),
    queryText(snakeUserMessage.query),
  )
  const title = firstString(data?.title, data?.task_title, data?.taskTitle, data?.session_title, data?.sessionTitle, data?.summary_title, data?.summaryTitle, task.title)
  const projectName = firstString(
    data?.project_name,
    data?.projectName,
    data?.repo_name,
    data?.repoName,
    data?.workspace_name,
    data?.workspaceName,
    task.project_name,
    task.projectName,
  )
  if (prompt) context.prompt = clampText(prompt, 80)
  if (title) context.title = clampText(title, 80)
  if (projectName) context.projectName = clampText(projectName, 80)
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

function hookEventName(data) {
  return firstString(
    data?.hook_event_name,
    data?.hookEventName,
    data?.event_name,
    data?.eventName,
    data?.hook_event,
    data?.hookEvent,
    data?.event_type,
    data?.eventType,
    data?.event,
    data?.agent_action_name,
    data?.agentActionName,
  )
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

function withSubagent(event, data) {
  return { ...withAgent(event, data), subagent: true }
}

// Codex notify carries the turn's user input as `input-messages` (array or string).
// It's the closest thing to a task title, so we surface it for the bubble headline.
function codexInputText(data) {
  const raw = data['input-messages'] || data.input_messages || data.inputMessages
  if (Array.isArray(raw)) return raw.filter(Boolean).join(' ')
  return String(raw || '')
}

function codexInputPrompt(data) {
  return clampText(codexInputText(data), 80)
}

function hasOnlyTitleJson(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const keys = Object.keys(parsed)
    return keys.length === 1 && keys[0] === 'title' && typeof parsed.title === 'string'
  } catch {
    return false
  }
}

function isCodexTitleGenerationNotify(data) {
  const input = codexInputText(data)
  return /Generate a concise UI title/i.test(input)
    && /Do NOT respond to the user/i.test(input)
    && hasOnlyTitleJson(data['last-assistant-message'])
}

function isCodexInternalMemoryPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/')
  return /(^|\/)\.codex\/memories(\/|$)/.test(normalized)
}

function isCodexInternalMemoryEvent(data) {
  const context = localContext(data)
  return isCodexInternalMemoryPath(context.cwd)
    || isCodexInternalMemoryPath(context.transcriptPath)
    || isCodexInternalMemoryPath(context.agentTranscriptPath)
}

function codexNotifyToEvent(data) {
  if (isCodexInternalMemoryEvent(data)) return null
  if (data.type === 'agent-turn-complete') {
    if (isCodexTitleGenerationNotify(data)) return null
    const event = withLocalContext({ type: 'task_done', source: 'local', text: clampText(data['last-assistant-message']) }, data)
    const prompt = codexInputPrompt(data)
    return prompt ? { ...event, prompt } : event
  }
  if (/permission|approval|confirm|ask/i.test(String(data.type || ''))) {
    return withLocalContext({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || '需要你确认') }, data)
  }
  return null
}

function normalizedToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

const KNOWN_AGENT_SOURCES = [
  { label: 'Trae Work', pattern: /(^|\W)(trae|coco)(\W|$)/i },
  { label: 'Claude Code', pattern: /(^|\W)claude(?:\s*code)?(\W|$)/i },
  { label: 'Codex', pattern: /(^|\W)codex(\W|$)/i },
  { label: 'Cursor', pattern: /(^|\W)cursor(\W|$)/i },
  { label: 'Windsurf', pattern: /(^|\W)(windsurf|cascade)(\W|$)/i },
  { label: 'Gemini CLI', pattern: /(^|\W)gemini(?:\s*cli)?(\W|$)/i },
  { label: 'Qwen Code', pattern: /(^|\W)qwen(?:\s*code)?(\W|$)/i },
  { label: 'OpenCode', pattern: /(^|\W)(opencode|open\s*code)(\W|$)/i },
  { label: 'Goose', pattern: /(^|\W)goose(\W|$)/i },
  { label: 'Amp', pattern: /(^|\W)amp(?:\s*code)?(\W|$)/i },
  { label: 'Aider', pattern: /(^|\W)aider(\W|$)/i },
  { label: 'Zed', pattern: /(^|\W)zed(\W|$)/i },
  { label: 'Roo Code', pattern: /(^|\W)roo(?:\s*code)?(\W|$)/i },
  { label: 'Cline', pattern: /(^|\W)cline(\W|$)/i },
  { label: 'Continue', pattern: /(^|\W)continue(\W|$)/i },
  { label: 'GitHub Copilot', pattern: /(^|\W)(github\s*)?copilot(\W|$)/i },
  { label: 'Devin', pattern: /(^|\W)devin(\W|$)/i },
  { label: 'Antigravity', pattern: /(^|\W)antigravity(\W|$)/i },
  { label: 'Kiro', pattern: /(^|\W)kiro(\W|$)/i },
]

function knownAgentLabel(data) {
  const context = localContext(data)
  const source = [
    data?.kodama_agent,
    data?.kodamaAgent,
    data?.agent_app,
    data?.agentApp,
    data?.client,
    data?.originator,
    data?.source_app,
    data?.sourceApp,
    data?.app,
    data?.appName,
    data?.agent,
    context.client,
  ].map(value => String(value || '')).join(' ')
  return KNOWN_AGENT_SOURCES.find(item => item.pattern.test(source))?.label || ''
}

function isKnownAgentPayload(data) {
  return Boolean(knownAgentLabel(data))
}

function lifecycleTokens(data) {
  return [
    data?.hook_event,
    data?.hookEvent,
    data?.event_name,
    data?.eventName,
    data?.event_type,
    data?.eventType,
    data?.event,
    data?.type,
    data?.status,
    data?.state,
    data?.phase,
    data?.result,
    data?.notification_type,
    data?.notificationType,
    data?.message_type,
    data?.messageType,
  ].map(normalizedToken).filter(Boolean)
}

function eventSummaryText(data, fallback = '') {
  return firstString(
    data?.summary,
    data?.result_summary,
    data?.resultSummary,
    data?.last_assistant_message,
    data?.lastAssistantMessage,
    data?.message,
    data?.reason,
    data?.title,
    data?.summary_title,
    data?.summaryTitle,
    localContext(data).prompt,
    fallback,
  )
}

function isTraeLikePayload(data) {
  const context = localContext(data)
  const source = [
    data?.client,
    data?.originator,
    data?.source_app,
    data?.sourceApp,
    data?.app,
    data?.appName,
    data?.agent,
    context.client,
  ].map(value => String(value || '').toLowerCase()).join(' ')
  if (/(^|\W)(trae|coco)(\W|$)/i.test(source)) return true

  const cwd = String(context.cwd || '').replace(/\\/g, '/')
  if (/(^|\/)\.trae(?:-cn)?(\/|$)/i.test(cwd)) return true
  if (/(^|\/)TRAE SOLO(?: CN)?(\/|$)/i.test(cwd)) return true

  // Trae Work uses conversationId/operationId/repoWorkingDir aliases even when
  // the desktop hook omits a formal hook event name.
  return Boolean((data?.conversationId || data?.conversation_id) && (data?.repoWorkingDir || data?.repo_working_dir || data?.operationId || data?.operation_id))
}

function inferredTraeLifecycleEvent(data) {
  if (!isTraeLikePayload(data)) return null
  const tokens = lifecycleTokens(data)

  const has = (values) => tokens.some(token => values.includes(token))
  if (has([
    'done',
    'complete',
    'completed',
    'finish',
    'finished',
    'success',
    'succeeded',
    'taskdone',
    'taskcompleted',
    'sessionend',
    'sessionended',
    'stop',
    'idleprompt',
  ])) {
    return withAgent({ type: 'task_done', source: 'local', text: clampText(data.message || data.reason || '') }, data)
  }
  if (has([
    'fail',
    'failed',
    'failure',
    'error',
    'errored',
    'taskfailed',
    'sessionfailed',
    'stopfailure',
  ])) {
    return withAgent({ type: 'task_failed', source: 'local', text: clampText(data.error || data.message || data.reason || 'Trae Work 失败') }, data)
  }
  if (tokens.some(token => /permission|approval|confirm|ask/.test(token))) {
    return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || 'Trae Work 需要你确认') }, data)
  }

  // Trae emits queue/status notifications while a model request is waiting.
  // They are not task completion and can be noisy, so keep them diagnostic-only.
  return null
}

function inferredGenericLifecycleEvent(data) {
  if (!isKnownAgentPayload(data)) return null
  const tokens = lifecycleTokens(data)
  const has = (values) => tokens.some(token => values.includes(token))

  if (has(['queue', 'queued', 'ratequeued', 'throttled'])) return null

  if (has([
    'done',
    'complete',
    'completed',
    'finish',
    'finished',
    'success',
    'succeeded',
    'taskdone',
    'taskcompleted',
    'sessionend',
    'sessionended',
    'stop',
    'idleprompt',
    'afteragent',
  ])) {
    return withAgent({ type: 'task_done', source: 'local', text: clampText(eventSummaryText(data, '任务完成')) }, data)
  }
  if (has([
    'fail',
    'failed',
    'failure',
    'error',
    'errored',
    'taskfailed',
    'sessionfailed',
    'stopfailure',
  ])) {
    return withAgent({ type: 'task_failed', source: 'local', text: clampText(data.error || eventSummaryText(data, 'Agent 失败')) }, data)
  }
  if (tokens.some(token => /permission|approval|confirm|ask|waiting|needsinput|inputrequired/.test(token))) {
    return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || 'Agent 需要你确认') }, data)
  }
  if (has([
    'start',
    'started',
    'begin',
    'began',
    'sessionstart',
    'userpromptsubmit',
    'beforeagent',
    'taskcreated',
  ])) {
    return withAgent({ type: 'task_started', source: 'local', text: clampText(localContext(data).prompt || data.message || data.reason || localContext(data).cwd || '') }, data)
  }
  if (has(['progress', 'running', 'inprogress', 'working'])) {
    return withAgent({ type: 'task_progress', source: 'local', text: clampText(eventSummaryText(data, 'Agent 工作中')) }, data)
  }
  return null
}

function mapHookToEvent(data) {
  if (!data || typeof data !== 'object') return null
  if (isCodexInternalMemoryEvent(data)) return null

  // Codex `notify` payloads use `type` (no hook_event_name).
  const eventName = hookEventName(data)
  if (!eventName && data.type === 'agent-turn-complete') {
    const codex = codexNotifyToEvent(data)
    if (codex) return codex
    return null
  }
  if (!eventName) {
    const inferredTrae = inferredTraeLifecycleEvent(data)
    if (inferredTrae) return inferredTrae
    const inferredGeneric = inferredGenericLifecycleEvent(data)
    if (inferredGeneric) return inferredGeneric
  }
  if (!eventName && data.type) return codexNotifyToEvent(data)

  switch (eventName) {
    case 'SessionStart':
    case 'UserPromptSubmit':
      return withAgent({ type: 'task_started', source: 'local', text: clampText(data.prompt || data.userPrompt || data.user_prompt || localContext(data).cwd || '') }, data)
    case 'PermissionRequest':
      return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || 'Agent 需要你确认') }, data)
    case 'PermissionDenied':
    case 'PermissionDenial':
      return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.message || data.reason || '权限被拒绝') }, data)
    case 'PreCompact':
      return withLocalContext({ type: 'task_progress', source: 'local', text: '正在压缩上下文…' }, data)
    case 'PreCompress':
      return withLocalContext({ type: 'task_progress', source: 'local', text: '正在压缩上下文…' }, data)
    case 'PostCompact':
      return withLocalContext({ type: 'task_progress', source: 'local', text: '上下文压缩完成' }, data)
    case 'PreToolUse': {
      const name = toolName(data)
      if (/AskUserQuestion/i.test(name)) {
        return withAgent({ type: 'task_waiting', source: 'local', text: 'Agent 在问你问题' }, data)
      }
      const command = commandEvent(data)
      if (command) return command
      // Only surface notable commands (test/build/git). Generic per-tool calls
      // would flood the pet, so they produce no event.
      return null
    }
    case 'BeforeTool': {
      const command = commandEvent(data)
      if (command) return command
      return null
    }
    case 'pre_run_command': {
      const command = commandEvent(data)
      if (command) return command
      return null
    }
    case 'PostToolUse': {
      const command = commandEvent(data, { done: true, failed: data.error || data.success === false })
      if (command) return command
      return null
    }
    case 'AfterTool': {
      const command = commandEvent(data, { done: true, failed: data.error || data.success === false })
      if (command) return command
      return null
    }
    case 'post_run_command': {
      const command = commandEvent(data, { done: true, failed: data.error || data.success === false })
      if (command) return command
      return null
    }
    case 'SubagentStart':
      return withSubagent({ type: 'task_progress', source: 'local', text: agentName(data) ? `子 Agent ${agentName(data)} 开始工作` : '子 Agent 开始工作' }, data)
    case 'SubagentStop':
      return withSubagent({ type: 'agent_done', source: 'local', text: agentName(data) ? `子 Agent ${agentName(data)} 完成` : '子 Agent 完成' }, data)
    case 'TeammateIdle':
      return withSubagent({ type: 'task_waiting', source: 'local', text: agentName(data) ? `${agentName(data)} 等你输入` : 'Agent Team 等你输入' }, data)
    case 'TaskCreated':
      return withSubagent({ type: 'task_progress', source: 'local', text: agentName(data) ? `${agentName(data)} 开始任务` : 'Agent Team 新任务创建' }, data)
    case 'TaskCompleted':
      return withSubagent({ type: 'agent_done', source: 'local', text: agentName(data) ? `${agentName(data)} 完成任务` : 'Agent Team 任务完成' }, data)
    case 'BeforeAgent':
      return withAgent({ type: 'task_started', source: 'local', text: clampText(localContext(data).prompt || data.message || data.reason || localContext(data).cwd || '') }, data)
    case 'AfterAgent':
      return withAgent({ type: 'task_done', source: 'local', text: clampText(eventSummaryText(data, '任务完成')) }, data)
    case 'Stop':
    case 'SessionEnd':
      return withAgent({ type: 'task_done', source: 'local', text: '' }, data)
    case 'PostToolUseFailure':
      return commandEvent(data, { failed: true })
    case 'StopFailure':
      return withLocalContext({ type: 'task_failed', source: 'local', text: clampText(data.error || data.message || '本地 Agent 失败') }, data)
    case 'Notification':
      if (data.notification_type === 'idle_prompt') return withAgent({ type: 'task_done', source: 'local', text: '' }, data)
      return withAgent({ type: 'task_waiting', source: 'local', text: clampText(data.notification_type || '需要你确认') }, data)
    default:
      return inferredTraeLifecycleEvent(data) || inferredGenericLifecycleEvent(data)
  }
}

module.exports = { mapHookToEvent }
