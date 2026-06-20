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

// Native OS notification (popup + sound) for important events — the in-window
// bubble is easy to miss. Guarded so node tests (no `window`) don't throw.
function notify(title, body) {
  if (typeof window === 'undefined' || !window.Notification) return
  try {
    if (Notification.permission === 'granted') new Notification(title, { body })
  } catch {
    /* ignore */
  }
}

let lastSoundAt = 0
function playCue(type) {
  if (typeof window === 'undefined') return
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return
  const now = Date.now()
  if (now - lastSoundAt < 900) return
  lastSoundAt = now
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const frequency = {
      task_waiting: 740,
      task_failed: 220,
      agent_done: 660,
      task_done: 880,
      pomodoro_completed: 820,
    }[type] || 520
    osc.type = type === 'task_failed' ? 'sawtooth' : 'sine'
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
    osc.addEventListener('ended', () => ctx.close().catch(() => {}), { once: true })
  } catch {
    /* audio is best-effort */
  }
}

// event: { type, source, text }
// hooks: { say(text, ms), playMotion(group), onStatus(status) }
export function reactToEvent(event, hooks, options = {}) {
  const def = PET_CONFIG.events[event.type]
  if (!def) return

  const src = PET_CONFIG.sources[event.source] || PET_CONFIG.sources.lark
  const text = interpolate(def.bubble, {
    icon: src.icon,
    label: src.label,
    text: event.text || '',
  })

  if (def.motion) hooks.playMotion?.(def.motion)
  hooks.onStatus?.(def.status)
  if (text) {
    hooks.say?.(text, def.ms || 4000, event)
    if (def.notify && options.notifications !== false) notify('Kodama 🌳', text)
    if (def.notify && options.sound !== false) playCue(event.type)
  }
}
