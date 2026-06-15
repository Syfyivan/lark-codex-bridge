/* global EventSource */
// Connects to the lark-codex-bridge pet event stream (SSE) and feeds each event
// into the shared reaction entry, tagged source:'lark'. Kodama is the bot's
// "local avatar": it only mirrors state, never decides permissions or runs Codex.
//
// Enable on the bridge side with PET_SYNC_ENABLED=1 and BRIDGE_HTTP_PORT set.
import { PET_CONFIG } from './config/pet-config.js'
import { reactToEvent } from './reactions.js'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'

// hooks: { say, playMotion, onStatus }
// opts: { bridgeUrl, token } — override via gitignored config/agent.local.js
export function connectAgentSync(hooks, opts = {}) {
  const bridgeUrl = (opts.bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/$/, '')
  const token = opts.token || ''
  let es

  function connect() {
    const url = new URL(`${bridgeUrl}/pet/events`)
    if (token) url.searchParams.set('token', token)
    es = new EventSource(url.toString())
    es.onopen = () => hooks.onStatus?.('connected')
    es.onerror = () => hooks.onStatus?.('offline') // EventSource auto-reconnects

    for (const type of Object.keys(PET_CONFIG.events)) {
      es.addEventListener(type, (ev) => {
        let payload = {}
        try {
          payload = JSON.parse(ev.data)
        } catch {
          /* keep empty payload */
        }
        reactToEvent({ type, source: payload.source || 'lark', text: payload.text }, hooks)
      })
    }
  }

  connect()
  return () => es && es.close()
}
