const fs = require('fs')
const path = require('path')

// Main-process adapter for Kodama's current bridge HTTP contract.
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'
const DEFAULT_BRIDGE_TOKEN_FILE = '.lark-codex-bridge-http-token'

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function bridgeTokenFromDisk({
  env = process.env,
  homeDir = env.HOME || env.USERPROFILE || '',
  readFileSync = fs.readFileSync,
} = {}) {
  const envToken = String(env.KODAMA_BRIDGE_TOKEN || '').trim()
  if (envToken) return envToken
  const candidate = path.join(homeDir, DEFAULT_BRIDGE_TOKEN_FILE)
  if (!candidate) return ''
  try {
    return String(readFileSync(candidate, 'utf8') || '').trim()
  } catch {
    return ''
  }
}

function normalizeBridgeBaseUrl(value) {
  const parsed = new URL(String(value || DEFAULT_BRIDGE_URL))
  const hostname = parsed.hostname.toLowerCase()
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new Error('bridge URL must be loopback')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported bridge protocol')
  return `${parsed.protocol}//${parsed.host}`
}

async function requestBridgeJson(baseUrl, pathName, {
  method = 'GET',
  body = null,
  token = '',
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')
  if (typeof AbortControllerImpl !== 'function') throw new Error('AbortController is unavailable')
  const controller = new AbortControllerImpl()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body != null) headers['Content-Type'] = 'application/json'
    const res = await fetchImpl(`${baseUrl}${pathName}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = {}
    try {
      json = JSON.parse(text || '{}')
    } catch {
      json = { error: text || `HTTP ${res.status}` }
    }
    if (!res.ok) return { ok: false, status: res.status, error: json.error || `HTTP ${res.status}`, raw: json }
    return json
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: 'bridge request timed out' }
    return { ok: false, error: err?.message || String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function postBridgeJson(baseUrl, pathName, body, options = {}) {
  return requestBridgeJson(baseUrl, pathName, {
    ...options,
    method: 'POST',
    body,
    timeoutMs: options.timeoutMs == null ? 180000 : options.timeoutMs,
  })
}

function normalizeBridgeTaskLimit(value) {
  return clampInt(value, 1, 200, 50)
}

function normalizeBridgeTaskScope(request = {}) {
  const source = request || {}
  const scope = {}
  const taskId = String(source.taskId || source.task_id || '').trim()
  const contextKey = String(source.contextKey || source.context_key || '').trim()
  const chatId = String(source.chatId || source.chat_id || '').trim()
  const messageId = String(source.messageId || source.message_id || '').trim()
  if (taskId) scope.task_id = taskId
  if (contextKey) scope.context_key = contextKey
  if (chatId) scope.chat_id = chatId
  if (messageId) scope.message_id = messageId
  return scope
}

function bridgeTaskQueryPath(limit, scope = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  Object.entries(scope).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  return `/task-viewer/tasks.json?${params.toString()}`
}

function resolveBridgeRequest(request = {}, options = {}) {
  return {
    baseUrl: normalizeBridgeBaseUrl(request.bridgeUrl),
    token: String(request.token || '').trim()
      || bridgeTokenFromDisk({
        env: options.env,
        homeDir: options.homeDir,
        readFileSync: options.readFileSync,
      }),
  }
}

async function shareSession(request = {}, options = {}) {
  try {
    const provider = request.provider === 'claude' ? 'claude' : 'codex'
    const sessionId = String(request.sessionId || request.threadId || '').trim()
    if (!sessionId) return { ok: false, error: 'missing-session-id' }
    const { baseUrl, token } = resolveBridgeRequest(request, options)
    const result = await postBridgeJson(baseUrl, '/v1/sessions/session-shares', {
      provider,
      session_id: sessionId,
    }, {
      ...options,
      token,
    })
    if (!result?.ok) return result || { ok: false, error: 'bridge-share-failed' }
    const url = result.share?.url || result.doc?.url || result.url || ''
    if (!url) return { ok: false, error: 'bridge did not return a share URL', raw: result }
    return { ...result, url }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

async function bridgeTasks(request = {}, options = {}) {
  try {
    const { baseUrl, token } = resolveBridgeRequest(request, options)
    const limit = normalizeBridgeTaskLimit(request.limit)
    const scope = normalizeBridgeTaskScope(request)
    const result = await requestBridgeJson(baseUrl, bridgeTaskQueryPath(limit, scope), {
      ...options,
      token,
      timeoutMs: options.timeoutMs == null ? 15000 : options.timeoutMs,
    })
    if (!result?.ok) return result || { ok: false, error: 'bridge task viewer request failed' }
    const tasks = Array.isArray(result.tasks) ? result.tasks : []
    return {
      ok: true,
      bridgeUrl: baseUrl,
      updatedAt: new Date().toISOString(),
      tasks,
      scope: result.scope || scope,
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

async function shareBridgeTasks(request = {}, options = {}) {
  try {
    const { baseUrl, token } = resolveBridgeRequest(request, options)
    const limit = normalizeBridgeTaskLimit(request.limit)
    const scope = normalizeBridgeTaskScope(request)
    const result = await postBridgeJson(baseUrl, '/v1/bridge/task-viewer/share', {
      limit,
      ...scope,
    }, {
      ...options,
      token,
    })
    if (!result?.ok) return result || { ok: false, error: 'bridge task viewer share failed' }
    const url = result.url || result.share?.url || result.doc?.url || ''
    return { ...result, url }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

module.exports = {
  DEFAULT_BRIDGE_URL,
  bridgeTokenFromDisk,
  normalizeBridgeBaseUrl,
  requestBridgeJson,
  postBridgeJson,
  normalizeBridgeTaskLimit,
  normalizeBridgeTaskScope,
  bridgeTaskQueryPath,
  shareSession,
  bridgeTasks,
  shareBridgeTasks,
}
