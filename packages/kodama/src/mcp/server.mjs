import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import { validateSayText, SAY_MAX_LENGTH } from './validate.mjs'
import { petStatus, petSay, petSetState, PET_STATES } from './pet-client.mjs'

// A zero-dependency MCP stdio server (JSON-RPC 2.0 over newline-delimited stdin/
// stdout) that lets Claude Code / Cursor drive the Kodama desktop pet. It handles
// initialize, tools/list, and tools/call, and exposes three tools: status, say,
// and set_state. All pet traffic goes to 127.0.0.1:7766 with short timeouts and
// never crashes the server on failure.

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'kodama-pet', version: '0.1.5' }

const TOOLS = [
  {
    name: 'status',
    description:
      'Read the Kodama desktop pet status (window readiness, hidden state, recent event, token stats summary) from its local 127.0.0.1:7766 health endpoint.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'say',
    description: `Make the desktop pet show a speech bubble. Text is 1-${SAY_MAX_LENGTH} characters of plain language (no code blocks, URLs, or secrets).`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: `Bubble text, 1-${SAY_MAX_LENGTH} chars`, minLength: 1, maxLength: SAY_MAX_LENGTH },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_state',
    description: 'Set the desktop pet status to reflect the agent lifecycle.',
    inputSchema: {
      type: 'object',
      properties: { state: { type: 'string', enum: PET_STATES } },
      required: ['state'],
      additionalProperties: false,
    },
  },
]

// JSON-RPC error codes (subset used here).
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

function reply(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function errorReply(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolContent(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] }
}

function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// Dispatch a single tools/call. Tool-level failures (bad input, unreachable pet)
// come back as isError content rather than JSON-RPC errors, per the MCP spec.
async function callTool(params, deps) {
  const name = params && params.name
  const args = (params && params.arguments) || {}

  switch (name) {
    case 'status': {
      try {
        return toolContent(await petStatus(deps))
      } catch (err) {
        return toolError(`failed to reach pet: ${errMessage(err)}`)
      }
    }
    case 'say': {
      const checked = validateSayText(args.text)
      if (!checked.ok) return toolError(checked.error)
      try {
        const result = await petSay(checked.text, deps)
        return toolContent({ ok: true, said: checked.text, posted: result.posted })
      } catch (err) {
        return toolError(`failed to reach pet: ${errMessage(err)}`)
      }
    }
    case 'set_state': {
      if (!PET_STATES.includes(args.state)) {
        return toolError(`state must be one of: ${PET_STATES.join(', ')}`)
      }
      try {
        const result = await petSetState(args.state, deps)
        return toolContent({ ok: true, state: args.state, posted: result.posted })
      } catch (err) {
        return toolError(`failed to reach pet: ${errMessage(err)}`)
      }
    }
    default:
      return toolError(`unknown tool: ${String(name)}`)
  }
}

function errMessage(err) {
  return err && err.message ? err.message : String(err)
}

// Handle one parsed JSON-RPC message. Returns a response object to write, or null
// for notifications (no id) and fire-and-forget lifecycle messages.
export async function handleMessage(msg, deps = {}) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    const id = msg && msg.id !== undefined ? msg.id : null
    return errorReply(id, INVALID_REQUEST, 'Invalid Request')
  }

  const { id, method } = msg
  const isNotification = id === undefined

  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      case 'notifications/initialized':
      case 'initialized':
        return null // client lifecycle notification, nothing to answer
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, { tools: TOOLS })
      case 'tools/call':
        return reply(id, await callTool(msg.params || {}, deps))
      default:
        if (isNotification) return null
        return errorReply(id, METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  } catch (err) {
    if (isNotification) return null
    return errorReply(id, INTERNAL_ERROR, errMessage(err))
  }
}

function writeMessage(output, msg) {
  output.write(`${JSON.stringify(msg)}\n`)
}

// Run the stdio loop: one JSON-RPC message per line in, one per line out.
export function runServer({ input = process.stdin, output = process.stdout, deps = {} } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch {
      writeMessage(output, errorReply(null, PARSE_ERROR, 'Parse error'))
      return
    }
    // handleMessage is async; serialize nothing special — responses carry ids.
    Promise.resolve(handleMessage(msg, deps))
      .then((response) => {
        if (response) writeMessage(output, response)
      })
      .catch((err) => {
        const id = msg && msg.id !== undefined ? msg.id : null
        writeMessage(output, errorReply(id, INTERNAL_ERROR, errMessage(err)))
      })
  })
  return rl
}

export { TOOLS, SERVER_INFO, PROTOCOL_VERSION }

// Start automatically when launched as a CLI (node src/mcp/server.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runServer()
}
