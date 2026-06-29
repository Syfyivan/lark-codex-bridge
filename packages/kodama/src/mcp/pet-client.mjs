import http from 'node:http'

// Thin client for Kodama's local agent receiver (the 7766 HTTP server defined in
// src/main/index.js). Every call goes straight to the loopback address: Node's
// http module never consults HTTP(S)_PROXY env vars, so this is already the
// equivalent of curl --noproxy. Timeouts are short and failures reject the
// returned promise so callers can degrade gracefully instead of crashing.

export const PET_HOST = '127.0.0.1'
export const PET_PORT = 7766
export const PET_TIMEOUT_MS = 2000

// Endpoint contract the parent agent must add to the 7766 receiver so set_state
// can drive arbitrary pet statuses. Kept as an easy-to-change constant.
//   POST /pet/mcp-state  { state: 'thinking'|'working'|'done'|'waiting'|'failed' }
// See integrationNotes for the full contract.
export const MCP_STATE_PATH = '/pet/mcp-state'

// The five lifecycle states set_state accepts, ordered thinking -> failed.
export const PET_STATES = ['thinking', 'working', 'done', 'waiting', 'failed']

// Low-level loopback JSON request. Resolves { statusCode, json } or rejects on
// transport error / timeout. `httpImpl` is injectable purely for unit tests.
export function loopbackJson(
  { method, path, body, host = PET_HOST, port = PET_PORT, timeoutMs = PET_TIMEOUT_MS },
  httpImpl = http,
) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const headers = {}
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = payload.length
    }
    // Forward the optional shared secret so we pass the receiver's tokenOk() gate
    // when KODAMA_HOOK_TOKEN is configured. No-op when it is unset.
    const token = String(process.env.KODAMA_HOOK_TOKEN || '').trim()
    if (token) headers['x-kodama-token'] = token

    const req = httpImpl.request({ host, port, path, method, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let json = null
        try {
          json = data ? JSON.parse(data) : {}
        } catch {
          json = { raw: data }
        }
        resolve({ statusCode: res.statusCode, json })
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`pet request timed out after ${timeoutMs}ms`))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function pickRequest(deps) {
  return (deps && deps.request) || loopbackJson
}

function summarizeTokenStats(stats) {
  if (!stats || typeof stats !== 'object') return null
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return { today: num(stats.today), last7: num(stats.last7), total: num(stats.total) }
}

// GET /healthz -> compact status summary for the `status` tool.
export async function petStatus(deps = {}) {
  const request = pickRequest(deps)
  const { statusCode, json } = await request({ method: 'GET', path: '/healthz' })
  if (statusCode !== 200) throw new Error(`healthz returned HTTP ${statusCode}`)
  return {
    ok: Boolean(json && json.ok),
    windowReady: Boolean(json && json.windowReady),
    petHidden: Boolean(json && json.petHidden),
    localEventCount: json && Number.isFinite(Number(json.localEventCount)) ? Number(json.localEventCount) : 0,
    lastLocalEvent: (json && json.lastLocalEvent) || null,
    updateStatus: (json && json.updateStatus) || null,
    tokenStats: summarizeTokenStats(json && json.tokenStats),
  }
}

// Codex `notify` shape the receiver's mapHookToEvent() turns into a task_done
// bubble. `source: 'mcp'` tags the origin for debugging.
export function buildSayBody(text) {
  return { type: 'agent-turn-complete', 'last-assistant-message': text, source: 'mcp' }
}

// POST / with a Codex notify body so the pet shows a speech bubble.
export async function petSay(text, deps = {}) {
  const request = pickRequest(deps)
  const body = buildSayBody(text)
  const { statusCode, json } = await request({ method: 'POST', path: '/', body })
  if (statusCode !== 200) throw new Error(`say POST returned HTTP ${statusCode}`)
  return { posted: body, response: json }
}

// Body for the /pet/mcp-state endpoint contract.
export function buildStateBody(state) {
  return { state, source: 'mcp' }
}

// POST /pet/mcp-state to drive the pet status. Requires the endpoint described in
// integrationNotes; until the parent agent adds it this resolves on 2xx only.
export async function petSetState(state, deps = {}) {
  const request = pickRequest(deps)
  const body = buildStateBody(state)
  const { statusCode, json } = await request({ method: 'POST', path: MCP_STATE_PATH, body })
  if (statusCode !== 200) throw new Error(`set_state POST ${MCP_STATE_PATH} returned HTTP ${statusCode}`)
  return { posted: body, response: json }
}
