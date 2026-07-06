function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export function shortLabel(text, max = 32) {
  const normalized = compact(text)
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function pathBaseName(value) {
  return normalizePath(value).split('/').pop() || ''
}

export function isOpaqueInternalName(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^[0-9a-f]{16,}$/i.test(text)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true
  return /^[a-z0-9]{20,}$/i.test(text) && !/[._-]/.test(text)
}

export function eventPath(event) {
  return firstString(
    event?.cwd,
    event?.projectDir,
    event?.project_dir,
    event?.workspacePath,
    event?.workspace_path,
  )
}

export function isTraeInternalPath(value) {
  const normalized = normalizePath(value)
  return /(^|\/)\.trae(?:-cn)?\/work\/[^/]+$/i.test(normalized)
    || /(^|\/)TRAE SOLO(?: CN)?\/work\/[^/]+$/i.test(normalized)
}

export function eventWorkId(event) {
  const path = eventPath(event)
  if (!isTraeInternalPath(path)) return ''
  const base = pathBaseName(path)
  return isOpaqueInternalName(base) ? base : ''
}

export function normalizeAgentLabel(value) {
  const raw = compact(value)
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower.includes('trae')) {
    if (lower.includes('cli')) return 'Trae CLI'
    if (lower.includes('cn')) return 'Trae CN'
    return 'Trae Work'
  }
  if (lower.includes('coco')) return 'CoCo'
  if (lower.includes('claude')) return 'Claude Code'
  if (lower.includes('codex')) return 'Codex'
  if (lower.includes('cursor')) return 'Cursor'
  if (lower.includes('windsurf') || lower.includes('cascade')) return 'Windsurf'
  if (lower.includes('gemini')) return 'Gemini CLI'
  if (lower.includes('qwen')) return 'Qwen Code'
  if (lower.includes('opencode') || lower.includes('open code')) return 'OpenCode'
  if (lower.includes('goose')) return 'Goose'
  if (/(^|\W)amp(?:\s*code)?(\W|$)/i.test(raw)) return 'Amp'
  if (lower.includes('aider')) return 'Aider'
  if (/(^|\W)zed(\W|$)/i.test(raw)) return 'Zed'
  if (lower.includes('roo')) return 'Roo Code'
  if (lower.includes('cline')) return 'Cline'
  if (lower.includes('continue')) return 'Continue'
  if (lower.includes('copilot')) return 'GitHub Copilot'
  if (lower.includes('devin')) return 'Devin'
  if (lower.includes('antigravity')) return 'Antigravity'
  if (/(^|\W)kiro(\W|$)/i.test(raw)) return 'Kiro'
  if (lower === 'memories' || lower === 'memory') return 'Memory'
  return shortLabel(raw, 24)
}

export function eventAppLabel(event) {
  const explicit = normalizeAgentLabel(firstString(
    event?.kodamaAgent,
    event?.kodama_agent,
    event?.agentApp,
    event?.agent_app,
    event?.appName,
    event?.app_name,
    event?.app,
    event?.sourceApp,
    event?.source_app,
    event?.client,
    event?.originator,
  ))
  if (explicit) return explicit
  const agent = normalizeAgentLabel(event?.agent)
  if (agent) return agent
  if (isTraeInternalPath(eventPath(event))) return 'Trae Work'
  return ''
}

export function eventAgentLabel(event) {
  return normalizeAgentLabel(firstString(
    event?.agent,
    event?.agentName,
    event?.agent_name,
    event?.role,
  ))
}

export function eventProjectLabel(event) {
  const explicit = eventExplicitProjectLabel(event)
  if (explicit) return explicit

  return eventWorkdirLabel(event)
}

export function eventExplicitProjectLabel(event) {
  const explicit = firstString(
    event?.projectName,
    event?.project_name,
    event?.repoName,
    event?.repo_name,
    event?.workspaceName,
    event?.workspace_name,
  )
  return explicit && !isOpaqueInternalName(explicit) ? shortLabel(explicit, 28) : ''
}

export function eventWorkdirLabel(event) {
  const path = eventPath(event)
  const base = pathBaseName(path)
  if (!base || isTraeInternalPath(path) || isOpaqueInternalName(base)) return ''
  return shortLabel(base, 28)
}

export function eventTaskLabel(event) {
  const project = eventProjectLabel(event)
  if (project) return project

  const prompt = firstString(event?.prompt, event?.title)
  if (prompt && !isOpaqueInternalName(prompt)) return shortLabel(prompt, 28)

  return ''
}

export function eventBubbleContext(event, max = 34) {
  const app = eventAppLabel(event)
  const task = eventTaskLabel(event)
  if (app && task && app !== task) return shortLabel(`${app} / ${task}`, max)
  return shortLabel(task || app, max)
}

export function eventSessionTitle(event, max = 48) {
  const title = firstString(
    event?.sessionTitle,
    event?.session_title,
    event?.summaryTitle,
    event?.summary_title,
    event?.aiTitle,
    event?.ai_title,
    event?.title,
    event?.prompt,
  )
  return title && !isOpaqueInternalName(title) ? shortLabel(title, max) : ''
}

export function eventCurrentText(event, fallback = '', max = 96) {
  const text = firstString(
    event?.statusText,
    event?.status_text,
    event?.progressText,
    event?.progress_text,
    event?.resultText,
    event?.result_text,
    event?.text,
    event?.message,
    event?.summary,
    fallback,
  )
  return text && !isOpaqueInternalName(text) ? shortLabel(text, max) : ''
}

export function eventSessionCacheKeys(event) {
  if (!event) return []
  const keys = []
  const threadId = firstString(event.threadId, event.thread_id, event['thread-id'])
  const sessionId = firstString(event.sessionId, event.session_id, event.session)
  const transcriptPath = firstString(event.transcriptPath, event.transcript_path)
  const agentTranscriptPath = firstString(event.agentTranscriptPath, event.agent_transcript_path)
  const chatId = firstString(event.chatId, event.chat_id)
  const messageId = firstString(event.messageId, event.message_id)
  const path = eventPath(event)

  if (threadId) keys.push(`thread:${threadId}`)
  if (sessionId) keys.push(`session:${sessionId}`)
  if (transcriptPath) keys.push(`transcript:${normalizePath(transcriptPath)}`)
  if (agentTranscriptPath) keys.push(`agent-transcript:${normalizePath(agentTranscriptPath)}`)
  if (chatId) keys.push(`chat:${chatId}:${messageId}`)
  if (path) keys.push(`cwd:${event.source || 'local'}:${normalizePath(path)}`)
  return keys
}

export function eventLarkReplyMergeKey(event) {
  if (String(event?.type || '') !== 'lark_reply_sent') return ''
  const messageId = firstString(event?.messageId, event?.message_id)
  if (!messageId) return ''
  const chatId = firstString(event?.chatId, event?.chat_id)
  return `lark-reply:${chatId}:${messageId}`
}

export function bridgeTaskShareRequestForEvent(event, options = {}) {
  if (!event) return null
  const type = String(event.type || '')
  if (!new Set(['task_started', 'task_progress', 'task_waiting', 'task_done', 'task_failed', 'lark_reply_sent']).has(type)) {
    return null
  }
  const taskId = firstString(event.taskId, event.task_id)
  const contextKey = firstString(event.contextKey, event.context_key)
  const chatId = firstString(event.chatId, event.chat_id)
  const messageId = firstString(event.messageId, event.message_id)
  const bridgeLike = event.source === 'lark' || Boolean(taskId || contextKey || chatId || messageId)
  if (!bridgeLike || (!taskId && !contextKey && !chatId && !messageId)) return null

  const request = {
    bridgeUrl: options.bridgeUrl || '',
    token: options.token || '',
    limit: taskId ? 1 : 20,
  }
  if (taskId) request.taskId = taskId
  else {
    if (contextKey) request.contextKey = contextKey
    if (chatId) request.chatId = chatId
    if (messageId) request.messageId = messageId
  }
  return request
}

export function eventActorLabel(event) {
  if (!event) return ''
  const type = String(event.type || '')
  const text = [
    event.prompt,
    event.title,
    event.text,
    event.client,
    event.originator,
    event.app,
    event.sourceApp,
    event.source_app,
  ].map(value => String(value || '')).join(' ')
  const fromBridgePrompt = /通过飞书机器人被调用|飞书机器人/.test(text)
  const hasLarkContext = Boolean(firstString(event.chatId, event.chat_id, event.messageId, event.message_id))
  if (event.source === 'local') {
    if (fromBridgePrompt || hasLarkContext) return '飞书机器人 Agent'
    return '本机 Agent'
  }
  if (event.source === 'lark') {
    if (type === 'lark_message_received') return '飞书用户请求'
    return '飞书机器人'
  }
  return ''
}

export function isCodexTranscriptPath(value) {
  return /(^|\/)\.codex\/sessions\//.test(String(value || ''))
}

export function isCodexInternalMemoryPath(value) {
  return /(^|\/)\.codex\/memories(\/|$)/.test(String(value || '').replace(/\\/g, '/'))
}

export function isClaudeTranscriptPath(value) {
  return /(^|\/)\.claude\/projects\//.test(String(value || ''))
}

export function inferSessionIdFromTranscriptPath(value) {
  const file = String(value || '').split('/').pop() || ''
  const uuid = file.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid?.[0] || ''
}

function eventClient(event) {
  return firstString(
    event?.client,
    event?.originator,
    event?.sourceApp,
    event?.source_app,
    event?.app,
    event?.appName,
    event?.app_name,
    event?.agentApp,
    event?.agent_app,
    event?.kodamaAgent,
    event?.kodama_agent,
  )
}

function isCodexDesktopEvent(event) {
  if (event?.codexDesktop === true || event?.codex_desktop === true) return true
  return /\bcodex\s+(desktop|app)\b/i.test(eventClient(event))
}

export function sessionRequestForEvent(event, options = {}) {
  if (!event || event.source !== 'local') return null
  const transcriptPath = event.transcriptPath || event.transcript_path || ''
  const agentTranscriptPath = event.agentTranscriptPath || event.agent_transcript_path || ''
  const sessionId = event.sessionId || event.session_id || inferSessionIdFromTranscriptPath(transcriptPath)
  const threadId = event.threadId || event.thread_id || event['thread-id'] || ''
  const client = eventClient(event).toLowerCase()
  const cwd = eventPath(event)

  if (isCodexInternalMemoryPath(cwd) || isCodexInternalMemoryPath(transcriptPath) || isCodexInternalMemoryPath(agentTranscriptPath)) {
    return null
  }
  if (client.includes('trae') || client.includes('coco')) return null

  const codexTranscript = isCodexTranscriptPath(transcriptPath) || isCodexTranscriptPath(agentTranscriptPath)
  const codexThreadOpenable = Boolean(threadId && isCodexDesktopEvent(event))
  const claude = isClaudeTranscriptPath(transcriptPath) || isClaudeTranscriptPath(agentTranscriptPath) || client.includes('claude')
  const provider = claude ? 'claude' : codexTranscript || codexThreadOpenable ? 'codex' : ''
  const id = provider === 'codex' ? (threadId || sessionId) : sessionId
  if (!provider || !id) return null

  return {
    provider,
    sessionId: id,
    threadId,
    transcriptPath,
    agentTranscriptPath,
    cwd,
    canOpenCodexThread: provider === 'codex' && codexThreadOpenable,
    bridgeUrl: options.bridgeUrl || '',
    token: options.token || '',
  }
}

export function targetForEvent(event, options = {}) {
  if (!event) return null
  const url = event.url || event.link || event.deepLink || event.deep_link || ''
  if (url) return { kind: 'url', url, label: '打开链接' }

  const chatId = event.chatId || event.chat_id || ''
  if (chatId) {
    const messageId = event.messageId || event.message_id || ''
    return {
      kind: 'lark',
      chatId,
      messageId,
      label: messageId ? `飞书消息 ${messageId}` : `飞书会话 ${chatId}`,
    }
  }

  const session = sessionRequestForEvent(event, options)
  if (!session) return null
  if (session.provider === 'codex') {
    if (session.canOpenCodexThread) {
      return {
        kind: 'codex-thread',
        threadId: session.threadId || session.sessionId,
        turnId: event.turnId || event.turn_id || event['turn-id'] || '',
        url: `codex://threads/${encodeURIComponent(session.threadId || session.sessionId)}`,
        label: '打开 Codex 会话',
        fallbackPath: session.transcriptPath,
      }
    }
    if (session.transcriptPath) {
      return {
        kind: 'local-path',
        path: session.transcriptPath,
        label: '打开 Codex 记录',
      }
    }
    return null
  }
  if (session.provider === 'claude') {
    return {
      kind: 'terminal-session',
      sessionId: session.sessionId,
      tty: event.tty || '',
      cwd: session.cwd,
      label: '打开 Claude Code 终端',
      fallbackPath: session.transcriptPath,
    }
  }
  return null
}
