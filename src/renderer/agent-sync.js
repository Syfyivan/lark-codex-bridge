/* global EventSource */
// Connects to the lark-codex-bridge pet event stream (SSE) and feeds each event
// into the shared reaction entry, tagged source:'lark'. Kodama is the bot's
// "local avatar": it only mirrors state, never decides permissions or runs Codex.
//
// Enable on the bridge side with PET_SYNC_ENABLED=1 and BRIDGE_HTTP_PORT set.
import { PET_CONFIG } from './config/pet-config.js'
import { reactToEvent } from './reactions.js'

const BRIDGE_PORT = 8787
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`

// hooks: { say, playMotion, onStatus }
export function connectAgentSync(hooks) {
  let es

  function connect() {
    es = new EventSource(`${BRIDGE_URL}/pet/events`)
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
