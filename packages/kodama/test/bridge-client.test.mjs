import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bridgeTaskQueryPath,
  bridgeTasks,
  bridgeTokenFromDisk,
  normalizeBridgeBaseUrl,
  normalizeBridgeTaskScope,
  shareBridgeTasks,
  shareSession,
} from '../src/main/bridge-client.js'

test('normalizeBridgeBaseUrl keeps loopback hosts and rejects remote hosts', () => {
  assert.equal(normalizeBridgeBaseUrl('http://127.0.0.1:8787/pet/events'), 'http://127.0.0.1:8787')
  assert.equal(normalizeBridgeBaseUrl('https://localhost:443/task-viewer'), 'https://localhost')
  assert.throws(() => normalizeBridgeBaseUrl('http://192.168.1.8:8787'), /loopback/)
  assert.throws(() => normalizeBridgeBaseUrl('ftp://127.0.0.1:8787'), /unsupported/)
})

test('bridgeTokenFromDisk prefers env override and otherwise reads the bridge token file', () => {
  assert.equal(bridgeTokenFromDisk({
    env: { KODAMA_BRIDGE_TOKEN: 'env-token', HOME: '/Users/test' },
    readFileSync: () => {
      throw new Error('should not read file when env token is set')
    },
  }), 'env-token')

  const fileReads = []
  assert.equal(bridgeTokenFromDisk({
    env: { HOME: '/Users/test' },
    readFileSync: (file, encoding) => {
      fileReads.push([file, encoding])
      return 'disk-token\n'
    },
  }), 'disk-token')
  assert.deepEqual(fileReads, [['/Users/test/.lark-codex-bridge-http-token', 'utf8']])
})

test('shareSession sends the current share endpoint and resolves the share URL', async () => {
  const calls = []
  const result = await shareSession({
    provider: 'claude',
    sessionId: 'session-123',
    bridgeUrl: 'http://127.0.0.1:8787',
  }, {
    homeDir: '/Users/test',
    readFileSync: () => 'secret-token\n',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, share: { url: 'https://example.com/share' } }),
      }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/v1/sessions/session-shares')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    provider: 'claude',
    session_id: 'session-123',
  })
  assert.equal(result.url, 'https://example.com/share')
})

test('bridge task helpers normalize scope and current task viewer endpoints', async () => {
  assert.deepEqual(normalizeBridgeTaskScope({
    taskId: 'task-1',
    context_key: 'ctx-1',
    chatId: 'chat-1',
    message_id: 'msg-1',
  }), {
    task_id: 'task-1',
    context_key: 'ctx-1',
    chat_id: 'chat-1',
    message_id: 'msg-1',
  })
  assert.equal(
    bridgeTaskQueryPath(200, {
      task_id: 'task-1',
      chat_id: 'chat-1',
    }),
    '/task-viewer/tasks.json?limit=200&task_id=task-1&chat_id=chat-1',
  )

  const readCalls = []
  const listResult = await bridgeTasks({
    bridgeUrl: 'http://localhost:8787/',
    limit: 500,
    taskId: 'task-1',
    token: 'inline-token',
  }, {
    fetchImpl: async (url, init) => {
      readCalls.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          tasks: [{ id: 'task-1', status: 'running' }],
          scope: { task_id: 'task-1' },
        }),
      }
    },
  })

  assert.equal(readCalls[0].url, 'http://localhost:8787/task-viewer/tasks.json?limit=200&task_id=task-1')
  assert.equal(readCalls[0].init.headers.Authorization, 'Bearer inline-token')
  assert.equal(listResult.bridgeUrl, 'http://localhost:8787')
  assert.equal(listResult.tasks.length, 1)

  const shareCalls = []
  const shareResult = await shareBridgeTasks({
    bridgeUrl: 'http://127.0.0.1:8787',
    limit: 3,
    chatId: 'chat-1',
    messageId: 'msg-1',
    token: 'bridge-token',
  }, {
    fetchImpl: async (url, init) => {
      shareCalls.push({ url, init })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, url: 'https://example.com/tasks/share-1' }),
      }
    },
  })

  assert.equal(shareCalls[0].url, 'http://127.0.0.1:8787/v1/bridge/task-viewer/share')
  assert.deepEqual(JSON.parse(shareCalls[0].init.body), {
    limit: 3,
    chat_id: 'chat-1',
    message_id: 'msg-1',
  })
  assert.equal(shareResult.url, 'https://example.com/tasks/share-1')
})
