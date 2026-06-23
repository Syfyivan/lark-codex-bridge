/* global EventSource */
import { PET_CONFIG } from './config/pet-config.js'

// Renderer-side adapter for the bridge SSE contract and health probe.
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'

export function normalizeBridgeBaseUrl(value) {
  return String(value || DEFAULT_BRIDGE_URL).replace(/\/$/, '')
}

export function bridgeEventUrl(baseUrl, path, token = '') {
  const url = new URL(`${normalizeBridgeBaseUrl(baseUrl)}${path}`)
  if (token) url.searchParams.set('token', token)
  return url
}

export async function probeBridgeState(baseUrl, {
  token = '',
  fetchImpl = globalThis.fetch,
  onStatus,
} = {}) {
  try {
    const res = await fetchImpl(bridgeEventUrl(baseUrl, '/pet/state', token).toString(), { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const state = await res.json()
    const status = state?.ok ? 'connected' : 'offline'
    onStatus?.(status)
    return status
  } catch {
    onStatus?.('offline')
    return 'offline'
  }
}

export function connectBridgeEvents(onEvent, {
  bridgeUrl,
  token,
  onStatus,
  EventSourceImpl = globalThis.EventSource,
  fetchImpl = globalThis.fetch,
  eventTypes = Object.keys(PET_CONFIG.events),
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  const base = normalizeBridgeBaseUrl(bridgeUrl)
  let es
  let probeTimer
  let offlineTimer

  function setStatus(status) {
    onStatus?.(status)
  }

  function connect() {
    es = new EventSourceImpl(bridgeEventUrl(base, '/pet/events', token).toString())
    es.onopen = () => {
      clearTimeoutImpl(offlineTimer)
      setStatus('connected')
    }
    es.onerror = () => {
      clearTimeoutImpl(offlineTimer)
      offlineTimer = setTimeoutImpl(() => {
        probeBridgeState(base, { token, fetchImpl, onStatus: setStatus })
      }, 1500)
    }

    for (const type of eventTypes) {
      es.addEventListener(type, (ev) => {
        let payload = {}
        try {
          payload = JSON.parse(ev.data)
        } catch {
          payload = {}
        }
        onEvent({ ...payload, type, source: payload.source || 'lark' })
      })
    }
  }

  connect()
  probeTimer = setIntervalImpl(() => {
    probeBridgeState(base, { token, fetchImpl, onStatus: setStatus })
  }, 10000)
  probeBridgeState(base, { token, fetchImpl, onStatus: setStatus })

  return () => {
    clearIntervalImpl(probeTimer)
    clearTimeoutImpl(offlineTimer)
    es?.close()
  }
}

export function connectAgentSync(onEvent, options = {}) {
  return connectBridgeEvents(onEvent, options)
}
