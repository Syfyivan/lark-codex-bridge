const fs = require('fs')
const os = require('os')
const path = require('path')

const TRAE_LOG_TAIL_BYTES = 8 * 1024 * 1024
const TRAE_LOG_FILE_LIMIT = 8
const contextCache = new Map()

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function clampText(value, max = 160) {
  return compact(value).slice(0, max)
}

function firstString(...values) {
  for (const value of values) {
    const text = compact(value)
    if (text) return text
  }
  return ''
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function queryText(value) {
  if (!Array.isArray(value)) return ''
  const textParts = []
  const urlParts = []
  for (const item of value) {
    if (typeof item === 'string') {
      textParts.push(item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const data = objectValue(item.data)
    const type = String(item.type || '').toLowerCase()
    if (!type || type === 'text') {
      const text = firstString(data.content, data.text, item.content, item.text)
      if (text) textParts.push(text)
      continue
    }
    if (type === 'web_page') {
      const url = firstString(data.url, item.url)
      if (url) urlParts.push(shortUrl(url))
    }
  }

  const text = compact(textParts.join(' '))
  if (text.length >= 8 || !urlParts.length) return text
  return compact([text, ...urlParts].filter(Boolean).join(' '))
}

function shortUrl(value) {
  try {
    const url = new URL(String(value))
    return `${url.hostname}${url.pathname}${url.search}`
  } catch {
    return clampText(value, 80)
  }
}

function payloadPrompt(data) {
  const userMessage = objectValue(data?.userMessage)
  const snakeUserMessage = objectValue(data?.user_message)
  const nestedMessage = objectValue(data?.message)
  const nestedUserMessage = objectValue(nestedMessage.userMessage || nestedMessage.user_message)
  return clampText(firstString(
    data?.prompt,
    data?.user_prompt,
    data?.userPrompt,
    queryText(data?.query),
    queryText(userMessage.query),
    queryText(snakeUserMessage.query),
    queryText(nestedMessage.query),
    queryText(nestedUserMessage.query),
  ))
}

function payloadTitle(data) {
  const task = objectValue(data?.task)
  return clampText(firstString(
    data?.title,
    data?.task_title,
    data?.taskTitle,
    data?.session_title,
    data?.sessionTitle,
    data?.summary_title,
    data?.summaryTitle,
    task.title,
  ))
}

function payloadSummary(data) {
  const result = objectValue(data?.result)
  const message = genericEventText(data?.message) ? '' : data?.message
  return clampText(firstString(
    data?.summary,
    data?.result_summary,
    data?.resultSummary,
    data?.last_assistant_message,
    data?.lastAssistantMessage,
    result.summary,
    result.text,
    message,
  ))
}

function sessionIdFor(event, data) {
  return firstString(
    event?.sessionId,
    event?.session_id,
    data?.sessionId,
    data?.session_id,
    data?.conversationId,
    data?.conversation_id,
    data?.session,
  )
}

function eventPath(event, data) {
  return firstString(
    event?.cwd,
    event?.projectDir,
    event?.project_dir,
    event?.workspacePath,
    event?.workspace_path,
    data?.repoWorkingDir,
    data?.repo_working_dir,
    data?.cwd,
    data?.workspace,
  )
}

function isTraePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/')
  return /(^|\/)\.trae(?:-cn)?(\/|$)/i.test(normalized)
    || /(^|\/)TRAE SOLO(?: CN)?(\/|$)/i.test(normalized)
}

function isTraeLike(event, data) {
  const source = [
    event?.client,
    event?.agent,
    event?.app,
    event?.appName,
    data?.client,
    data?.originator,
    data?.source_app,
    data?.sourceApp,
    data?.app,
    data?.appName,
    data?.agent,
  ].map(value => String(value || '').toLowerCase()).join(' ')
  if (/(^|\W)(trae|coco)(\W|$)/i.test(source)) return true
  if (isTraePath(eventPath(event, data))) return true
  return Boolean((data?.conversationId || data?.conversation_id) && (data?.repoWorkingDir || data?.repo_working_dir))
}

function genericEventText(value) {
  const text = compact(value).replace(/[🎉。.!！]+$/g, '').trim().toLowerCase()
  return !text
    || ['任务完成', '完成', 'done', 'success', 'succeeded', 'finished', 'complete', 'completed', '搞定啦', 'trae work 搞定啦'].includes(text)
}

function contextFromPayload(data) {
  return {
    title: payloadTitle(data),
    prompt: payloadPrompt(data),
    summary: payloadSummary(data),
  }
}

function enrichTraeEvent(event, data = {}, deps = {}) {
  if (!event || !isTraeLike(event, data)) return event
  const inline = contextFromPayload(data)
  const sessionId = sessionIdFor(event, data)
  const logContext = (deps.findLogContext || lookupTraeLogContext)(sessionId, deps) || {}
  const title = firstString(event.title, inline.title, logContext.title)
  const prompt = firstString(event.prompt, inline.prompt, logContext.prompt)
  const summary = firstString(inline.summary, logContext.summary)

  const next = { ...event }
  if (title && !next.title) next.title = title
  if (prompt && !next.prompt) next.prompt = prompt

  const readable = firstString(summary, title, prompt)
  if (summary && (!next.text || genericEventText(next.text))) {
    next.text = summary
  } else if (event.type === 'task_done' && genericEventText(next.text) && readable) {
    next.text = `任务完成：${clampText(readable, 96)}`
  }

  if (!next.client) next.client = 'trae-work'
  return next
}

function lookupTraeLogContext(sessionId, deps = {}) {
  if (!sessionId) return {}
  const now = Date.now()
  const cached = contextCache.get(sessionId)
  if (cached && now - cached.at < 5 * 60 * 1000) return cached.value

  let value = {}
  const files = deps.logFiles || findTraeRendererLogs(deps.homeDir || os.homedir())
  for (const file of files) {
    const text = readTail(file, deps.maxLogBytes || TRAE_LOG_TAIL_BYTES)
    if (!text) continue
    value = { ...value, ...parseTraeRendererContextFromText(text, sessionId) }
    if (value.title && value.prompt) break
  }
  contextCache.set(sessionId, { at: now, value })
  return value
}

function findTraeRendererLogs(homeDir = os.homedir()) {
  const appNames = ['TRAE SOLO CN', 'Trae CN', 'TRAE CN']
  const files = []
  for (const appName of appNames) {
    collectRendererLogs(path.join(homeDir, 'Library', 'Application Support', appName, 'logs'), files, 0)
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, TRAE_LOG_FILE_LIMIT)
    .map(entry => entry.file)
}

function collectRendererLogs(dir, out, depth) {
  if (depth > 4) return
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectRendererLogs(file, out, depth + 1)
      continue
    }
    if (!/^renderer(?:\.\d+)?\.log$/i.test(entry.name)) continue
    try {
      const stat = fs.statSync(file)
      out.push({ file, mtimeMs: stat.mtimeMs })
    } catch {
      /* ignore unreadable files */
    }
  }
}

function readTail(file, maxBytes) {
  let fd
  try {
    const stat = fs.statSync(file)
    const length = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(length)
    fd = fs.openSync(file, 'r')
    fs.readSync(fd, buffer, 0, length, stat.size - length)
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
  }
}

function parseTraeRendererContextFromText(text, sessionId) {
  const session = String(sessionId || '')
  if (!session) return {}
  const context = {}
  const pendingPrompts = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const renameMarker = `Session renamed: ${session} `
    const renameIndex = line.indexOf(renameMarker)
    if (renameIndex >= 0) {
      context.title = clampText(line.slice(renameIndex + renameMarker.length), 120)
      continue
    }

    const inputMarker = '[MessageInput] Creating session and sending message '
    const inputIndex = line.indexOf(inputMarker)
    if (inputIndex >= 0) {
      const raw = line.slice(inputIndex + inputMarker.length)
      const json = extractFirstJsonObject(raw)
      if (json) {
        try {
          const parsed = JSON.parse(json)
          const prompt = payloadPrompt(parsed)
          if (prompt) pendingPrompts.push(prompt)
        } catch {
          /* not a parseable Trae message payload */
        }
      }
    }

    const successMatch = line.match(/createSessionAndSendMessage succeeded,\s*sessionId:\s*([0-9a-f]+)/i)
    if (successMatch && pendingPrompts.length) {
      const prompt = pendingPrompts.pop()
      if (successMatch[1] === session && prompt) context.prompt = prompt
      continue
    }
  }
  return context
}

function extractFirstJsonObject(text) {
  const source = String(text || '')
  const start = source.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

module.exports = {
  enrichTraeEvent,
  parseTraeRendererContextFromText,
  extractFirstJsonObject,
  contextFromPayload,
  findTraeRendererLogs,
}
