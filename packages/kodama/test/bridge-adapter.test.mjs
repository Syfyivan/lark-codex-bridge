import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bridgeEventUrl,
  connectBridgeEvents,
  probeBridgeState,
} from '../src/renderer/bridge-adapter.js'

test('bridgeEventUrl appends token to the current loopback event endpoints', () => {
  assert.equal(
    bridgeEventUrl('http://127.0.0.1:8787/', '/pet/events', 'secret').toString(),
    'http://127.0.0.1:8787/pet/events?token=secret',
  )
  assert.equal(
    bridgeEventUrl('http://127.0.0.1:8787', '/pet/state').toString(),
    'http://127.0.0.1:8787/pet/state',
  )
})

test('probeBridgeState maps the bridge state endpoint to connected/offline', async () => {
  const statuses = []
  const connected = await probeBridgeState('http://127.0.0.1:8787', {
    token: 'secret',
    onStatus: status => statuses.push(status),
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:8787/pet/state?token=secret')
      assert.deepEqual(init, { cache: 'no-store' })
      return {
        ok: true,
        json: async () => ({ ok: true }),
      }
    },
  })
  const offline = await probeBridgeState('http://127.0.0.1:8787', {
    onStatus: status => statuses.push(status),
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })

  assert.equal(connected, 'connected')
  assert.equal(offline, 'offline')
  assert.deepEqual(statuses, ['connected', 'offline'])
})

test('connectBridgeEvents wires the SSE stream and current event payload mapping', async () => {
  const events = []
  const statuses = []
  const fetchCalls = []
  const intervals = []
  const timeouts = []
  const sources = []

  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.listeners = new Map()
      this.closed = false
      sources.push(this)
    }

    addEventListener(type, handler) {
      this.listeners.set(type, handler)
    }

    emit(type, payload) {
      this.listeners.get(type)?.({ data: JSON.stringify(payload) })
    }

    close() {
      this.closed = true
    }
  }

  const cleanup = connectBridgeEvents(
    event => events.push(event),
    {
      bridgeUrl: 'http://127.0.0.1:8787/',
      token: 'secret',
      onStatus: status => statuses.push(status),
      EventSourceImpl: FakeEventSource,
      fetchImpl: async (url) => {
        fetchCalls.push(url)
        return {
          ok: true,
          json: async () => ({ ok: true }),
        }
      },
      setIntervalImpl: (fn, ms) => {
        intervals.push({ fn, ms })
        return intervals.length
      },
      clearIntervalImpl: () => {},
      setTimeoutImpl: (fn, ms) => {
        timeouts.push({ fn, ms })
        return timeouts.length
      },
      clearTimeoutImpl: () => {},
    },
  )

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sources.length, 1)
  assert.equal(sources[0].url, 'http://127.0.0.1:8787/pet/events?token=secret')
  assert.deepEqual(fetchCalls, ['http://127.0.0.1:8787/pet/state?token=secret'])

  sources[0].onopen()
  sources[0].emit('task_done', { text: '搞定了' })
  sources[0].emit('task_progress', { text: '继续', source: 'bridge' })
  assert.deepEqual(events, [
    { type: 'task_done', source: 'lark', text: '搞定了' },
    { type: 'task_progress', source: 'bridge', text: '继续' },
  ])
  assert.equal(statuses.at(-1), 'connected')

  sources[0].onerror()
  assert.equal(timeouts[0].ms, 1500)
  await timeouts[0].fn()
  assert.equal(statuses.at(-1), 'connected')
  assert.equal(intervals[0].ms, 10000)

  cleanup()
  assert.equal(sources[0].closed, true)
})
