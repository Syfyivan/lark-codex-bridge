/* global EventSource */
// Connects to the lark-codex-bridge pet event stream (SSE) and feeds each event
// into the shared reaction entry, tagged source:'lark'. Kodama is the bot's
// "local avatar": it only mirrors state, never decides permissions or runs Codex.
//
// Enable on the bridge side with PET_SYNC_ENABLED=1 and BRIDGE_HTTP_PORT set.
import { PET_CONFIG } from './config/pet-config.js'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'

// onEvent({ type, source, text }) — the single event handler (reaction + growth).
// onStatus(status) — connection status ('connected' | 'offline').
// opts: { bridgeUrl, token } — override via gitignored config/agent.local.js
export function connectAgentSync(onEvent, { bridgeUrl, token, onStatus } = {}) {
  const base = (bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/$/, '')
  let es

  function connect() {
    const url = new URL(`${base}/pet/events`)
    if (token) url.searchParams.set('token', token)
    es = new EventSource(url.toString())
    es.onopen = () => onStatus?.('connected')
    es.onerror = () => onStatus?.('offline') // EventSource auto-reconnects

    for (const type of Object.keys(PET_CONFIG.events)) {
      es.addEventListener(type, (ev) => {
        let payload = {}
        try {
          payload = JSON.parse(ev.data)
        } catch {
          /* keep empty payload */
        }
        onEvent({ type, source: payload.source || 'lark', text: payload.text, tokens: payload.tokens })
      })
    }
  }

  connect()
  return () => es && es.close()
}
