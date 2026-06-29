import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'

import { handleMessage, runServer, TOOLS, PROTOCOL_VERSION } from '../src/mcp/server.mjs'
import { validateSayText } from '../src/mcp/validate.mjs'
import { buildSayBody, buildStateBody, MCP_STATE_PATH, PET_STATES } from '../src/mcp/pet-client.mjs'

// A fake loopback request that records calls and returns a canned response.
function fakeRequest(response = { statusCode: 200, json: { ok: true } }) {
  const calls = []
  const request = async (opts) => {
    calls.push(opts)
    return typeof response === 'function' ? response(opts) : response
  }
  return { request, calls }
}

test('initialize returns protocol version and tools capability', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  assert.equal(res.jsonrpc, '2.0')
  assert.equal(res.id, 1)
  assert.equal(res.result.protocolVersion, PROTOCOL_VERSION)
  assert.deepEqual(res.result.capabilities, { tools: {} })
  assert.equal(res.result.serverInfo.name, 'kodama-pet')
})

test('tools/list returns the three pet tools with input schemas', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const names = res.result.tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['say', 'set_state', 'status'])
  for (const tool of res.result.tools) {
    assert.equal(typeof tool.description, 'string')
    assert.equal(tool.inputSchema.type, 'object')
  }
  assert.equal(TOOLS.length, 3)
})

test('initialized notification produces no response', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(res, null)
})

test('unknown method returns method-not-found error', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'does/not/exist' })
  assert.equal(res.error.code, -32601)
})

test('invalid request (missing jsonrpc) returns -32600', async () => {
  const res = await handleMessage({ id: 9, method: 'initialize' })
  assert.equal(res.error.code, -32600)
})

test('tools/call say posts a Codex notify body and echoes it back', async () => {
  const { request, calls } = fakeRequest({ statusCode: 200, json: { ok: true } })
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'say', arguments: { text: '测试完成啦' } } },
    { request },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/')
  assert.deepEqual(calls[0].body, {
    type: 'agent-turn-complete',
    'last-assistant-message': '测试完成啦',
    source: 'mcp',
  })
  assert.equal(res.result.isError, undefined)
  const payload = JSON.parse(res.result.content[0].text)
  assert.equal(payload.said, '测试完成啦')
})

test('tools/call say rejects URLs / code / over-length without posting', async () => {
  for (const bad of ['see http://x.com', 'use ```rust```', 'x'.repeat(141), '']) {
    const { request, calls } = fakeRequest()
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'say', arguments: { text: bad } } },
      { request },
    )
    assert.equal(res.result.isError, true)
    assert.equal(calls.length, 0, `should not POST for: ${bad.slice(0, 12)}`)
  }
})

test('tools/call say surfaces a POST failure as tool error (no crash)', async () => {
  const request = async () => {
    throw new Error('ECONNREFUSED')
  }
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'say', arguments: { text: 'hi there' } } },
    { request },
  )
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /failed to reach pet/)
})

test('tools/call set_state posts to the mcp-state endpoint', async () => {
  const { request, calls } = fakeRequest({ statusCode: 200, json: { ok: true } })
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'set_state', arguments: { state: 'working' } } },
    { request },
  )
  assert.equal(calls[0].path, MCP_STATE_PATH)
  assert.deepEqual(calls[0].body, { state: 'working', source: 'mcp' })
  assert.equal(res.result.isError, undefined)
})

test('tools/call set_state rejects unknown states', async () => {
  const { request, calls } = fakeRequest()
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'set_state', arguments: { state: 'nope' } } },
    { request },
  )
  assert.equal(res.result.isError, true)
  assert.equal(calls.length, 0)
})

test('tools/call status summarizes the healthz payload', async () => {
  const request = async (opts) => {
    assert.equal(opts.method, 'GET')
    assert.equal(opts.path, '/healthz')
    return {
      statusCode: 200,
      json: { ok: true, windowReady: true, petHidden: false, localEventCount: 3, tokenStats: { today: 10, last7: 20, total: 30 } },
    }
  }
  const res = await handleMessage(
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'status' } },
    { request },
  )
  const payload = JSON.parse(res.result.content[0].text)
  assert.equal(payload.windowReady, true)
  assert.equal(payload.localEventCount, 3)
  assert.deepEqual(payload.tokenStats, { today: 10, last7: 20, total: 30 })
})

test('runServer answers a parse error for malformed JSON lines', async () => {
  const lines = []
  const output = { write: (s) => lines.push(s) }
  // Minimal readable stub: emit two lines then end.
  const input = makeLineSource(['not json{{{', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })])
  runServer({ input, output })
  await tick()
  const responses = lines.map((l) => JSON.parse(l))
  assert.equal(responses[0].error.code, -32700)
  assert.deepEqual(responses[1].result, {})
})

test('validateSayText accepts a normal short string', () => {
  assert.deepEqual(validateSayText('  写完了  '), { ok: true, text: '写完了' })
})

test('builder helpers and state list stay in contract', () => {
  assert.deepEqual(buildSayBody('hi'), { type: 'agent-turn-complete', 'last-assistant-message': 'hi', source: 'mcp' })
  assert.deepEqual(buildStateBody('done'), { state: 'done', source: 'mcp' })
  assert.deepEqual(PET_STATES, ['thinking', 'working', 'done', 'waiting', 'failed'])
})

// --- tiny helpers for the runServer stream test (no extra deps) ---

function makeLineSource(linesArray) {
  // readline only needs a readable stream; emit the lines then end.
  return Readable.from(linesArray.map((l) => `${l}\n`))
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 50))
}
