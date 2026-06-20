/* global EventSource */
// Connects to the lark-codex-bridge pet event stream (SSE) and feeds each event
// into the shared reaction entry, tagged source:'lark'. Kodama is the bot's
// "local avatar": it only mirrors state, never decides permissions or runs Codex.
//
// Enable on the bridge side with PET_SYNC_ENABLED=1 and BRIDGE_HTTP_PORT set.
import { PET_CONFIG } from './config/pet-config.js'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'

// onEvent({ type, source, text, ...context }) — the single event handler.
// onStatus(status) — connection status ('connected' | 'offline').
// opts: { bridgeUrl, token } — override via gitignored config/agent.local.js
export function connectAgentSync(onEvent, { bridgeUrl, token, onStatus } = {}) {
  const base = (bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/$/, '')
  let es
  let probeTimer
  let offlineTimer

  function eventUrl(path) {
    const url = new URL(`${base}${path}`)
    if (token) url.searchParams.set('token', token)
    return url
  }

  function setStatus(status) {
    onStatus?.(status)
  }

  async function probeState() {
    try {
      const res = await fetch(eventUrl('/pet/state').toString(), { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const state = await res.json()
      setStatus(state?.ok ? 'connected' : 'offline')
    } catch {
      setStatus('offline')
    }
  }

  function connect() {
    es = new EventSource(eventUrl('/pet/events').toString())
    es.onopen = () => {
      clearTimeout(offlineTimer)
      setStatus('connected')
    }
    es.onerror = () => {
      // EventSource may briefly report error while the browser reconnects.
      // Confirm against /pet/state before showing "offline" in the panel.
      clearTimeout(offlineTimer)
      offlineTimer = setTimeout(probeState, 1500)
    }

    for (const type of Object.keys(PET_CONFIG.events)) {
      es.addEventListener(type, (ev) => {
        let payload = {}
        try {
          payload = JSON.parse(ev.data)
        } catch {
          /* keep empty payload */
        }
        onEvent({ ...payload, type, source: payload.source || 'lark' })
      })
    }
  }

  connect()
  probeTimer = setInterval(probeState, 10000)
  probeState()
  return () => {
    clearInterval(probeTimer)
    clearTimeout(offlineTimer)
    es && es.close()
  }
}
