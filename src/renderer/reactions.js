// Unified reaction entry: every agent event (from any source) flows through
// here and becomes a pet reaction (status + motion + bubble). Both the Feishu
// bridge stream (source:'lark') and local Claude Code hooks (source:'local')
// call reactToEvent — one pet, source-tagged.
import { PET_CONFIG } from './config/pet-config.js'

function interpolate(tpl, vars) {
  return tpl
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
    .replace(/\s+/g, ' ')
    .trim()
}

// Keep the currently-shown bubble from being stomped by a less important one.
let activeUntil = 0
let activePriority = 0

// event: { type, source, text }
// hooks: { say(text, ms), playMotion(group), onStatus(status) }
export function reactToEvent(event, hooks) {
  const def = PET_CONFIG.events[event.type]
  if (!def) return

  const now = Date.now()
  const priority = def.priority || 1
  if (now < activeUntil && priority < activePriority) return

  const src = PET_CONFIG.sources[event.source] || PET_CONFIG.sources.lark
  const text = interpolate(def.bubble, {
    icon: src.icon,
    label: src.label,
    text: event.text || '',
  })

  if (def.motion) hooks.playMotion?.(def.motion)
  hooks.onStatus?.(def.status)
  if (text) {
    hooks.say?.(text, def.ms || 4000)
    activeUntil = now + (def.ms || 4000)
    activePriority = priority
  }
}
