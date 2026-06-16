/* global PIXI */
import { connectAgentSync } from './agent-sync.js'
import { reactToEvent } from './reactions.js'
import { initGrowth, feed as feedGrowth, feedTokens, statusText } from './growth.js'

// Live2D model is chosen by `pnpm run setup <name>` (writes ./models/current-model.js).
const FALLBACK_MODEL_URL = './models/wanko/Wanko.model3.json'

const canvas = document.getElementById('pet-canvas')
const bubble = document.getElementById('bubble')

// Active rendering backend: { getBounds(), playMotion(pref), setStatus(status) }.
let backend = null

// Import an optional gitignored local config. Returns null if the file simply
// doesn't exist; surfaces real errors (syntax/path) instead of hiding them.
async function importLocal(path) {
  try {
    return await import(path)
  } catch (e) {
    const msg = String(e?.message || e)
    if (/not found|failed to fetch|cannot find|err_module_not_found/i.test(msg)) return null
    say(`⚠️ ${path} 出错：${msg}`, 6000)
    console.error(`[kodama] local config error: ${path}`, e)
    return null
  }
}

async function init() {
  try {
    // Ask for OS notification permission up front (Electron usually grants it).
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    // A gitignored config/render.local.js opts into the PRIVATE gif backend;
    // without it we use the public Live2D backend.
    const local = await importLocal('./config/render.local.js')

    if (local?.RENDER?.backend === 'gif') {
      const { initGifBackend } = await import('./backends/gif.js')
      canvas.style.display = 'none'
      backend = initGifBackend(local.RENDER.gif || {})
    } else {
      backend = await initLive2D()
    }

    setupInteraction()
    say('你好，我是 Kodama~ 🌳', 3000)

    // One pet, two sources — both flow through the same handler (reaction + growth).
    const hooks = {
      say,
      playMotion: (g) => backend?.playMotion?.(g),
      onStatus: (s) => {
        console.log('[kodama] status:', s)
        backend?.setStatus?.(s)
      },
    }
    await initGrowth(hooks)
    const handleAgentEvent = (event) => {
      reactToEvent(event, hooks)
      feedGrowth(event.type) // P4: events feed the pet
      // Cross-source token ledger: bridge (source 'lark') events may carry tokens.
      if (event.source === 'lark' && event.tokens) window.pet.addLarkTokens?.(event.tokens)
    }

    // source 'lark' via lark-codex-bridge SSE; bridge URL/token overridable.
    const agentCfg = (await importLocal('./config/agent.local.js'))?.AGENT || {}
    connectAgentSync(handleAgentEvent, { ...agentCfg, onStatus: hooks.onStatus })
    window.pet.onAgentEvent?.(handleAgentEvent) // source 'local'

    // P4: poll local token usage and feed the pet by token delta.
    refreshTokens()
    setInterval(refreshTokens, 5 * 60 * 1000)

    // P4: pomodoro / sedentary bubbles from the main process.
    window.pet.onNotify?.(({ text, status, motion }) => {
      if (status) backend?.setStatus?.(status)
      if (motion) backend?.playMotion?.(motion)
      if (text) say(text, 3500)
    })
  } catch (err) {
    console.error('[kodama] init failed:', err)
    say('启动失败：' + (err?.message || err), 6000)
  }
}

// ---------- Live2D backend ----------
async function initLive2D() {
  const { Live2DModel } = PIXI.live2d
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })

  let modelUrl = FALLBACK_MODEL_URL
  try {
    modelUrl = (await import('./models/current-model.js')).CURRENT_MODEL
  } catch (_) {
    /* setup not run yet */
  }

  const model = await Live2DModel.from(modelUrl, { autoInteract: false })
  app.stage.addChild(model)

  const s = model.internalModel?.settings
  const motionGroups = Object.keys(s?.motions ?? s?.json?.FileReferences?.Motions ?? {})

  function layout() {
    const { originalWidth, originalHeight } = model.internalModel
    const scale = Math.min(window.innerWidth / originalWidth, window.innerHeight / originalHeight)
    model.scale.set(scale)
    model.x = (window.innerWidth - model.width) / 2
    model.y = window.innerHeight - model.height
  }
  layout()
  window.addEventListener('resize', layout)

  // Different models name groups differently (Haru: Tap, Wanko: TapBody).
  function resolveGroup(pref) {
    if (motionGroups.includes(pref)) return pref
    if (/tap|touch/i.test(pref)) {
      const t = motionGroups.find((g) => /tap|touch/i.test(g))
      if (t) return t
    }
    return motionGroups.find((g) => !/idle/i.test(g)) || motionGroups[0] || 'Idle'
  }

  return {
    getBounds: () => model.getBounds(),
    playMotion(pref) {
      try {
        model.motion(resolveGroup(pref))
      } catch (_) {
        /* ignore */
      }
    },
    setStatus() {
      /* Live2D reacts through playMotion; no per-status sprite swap */
    },
  }
}

// ---------- window interaction (backend-agnostic) ----------
function overPet(x, y) {
  if (!backend) return false
  const b = backend.getBounds()
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
}

function setupInteraction() {
  let ignoring = true
  let dragging = false
  let lastX = 0
  let lastY = 0

  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      window.pet.move(e.screenX - lastX, e.screenY - lastY)
      lastX = e.screenX
      lastY = e.screenY
      return
    }
    const over = overPet(e.clientX, e.clientY)
    if (over && ignoring) {
      ignoring = false
      window.pet.setIgnoreMouse(false)
    } else if (!over && !ignoring) {
      ignoring = true
      window.pet.setIgnoreMouse(true, { forward: true })
    }
  })

  window.addEventListener('mousedown', (e) => {
    if (!overPet(e.clientX, e.clientY)) return
    dragging = true
    lastX = e.screenX
    lastY = e.screenY
    onTap()
  })

  window.addEventListener('mouseup', () => {
    dragging = false
  })
}

function onTap() {
  backend?.playMotion('Tap')
  const lark = tokenStats.lark?.today || 0
  const larkPart = lark > 0 ? `（飞书 ${fmtTokens(lark)}）` : ''
  say(`🐾 ${statusText()} · 今日 ${fmtTokens(tokenStats.today)} tok${larkPart}`, 3000)
}

let tokenStats = { today: 0, last7: 0, total: 0, local: {}, lark: {} }

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

async function refreshTokens() {
  try {
    const s = await window.pet.tokenStats?.()
    if (s) {
      tokenStats = s
      feedTokens(s.total)
    }
  } catch (_) {
    /* main not ready */
  }
}

// ---------- bubble ----------
function positionBubble() {
  if (!backend) return
  const b = backend.getBounds()
  bubble.style.left = `${b.x + b.width / 2}px`
  bubble.style.top = `${Math.max(4, b.y - bubble.offsetHeight - 8)}px`
}

let bubbleTimer
function say(text, ms = 2500) {
  bubble.textContent = text
  bubble.classList.remove('hidden')
  positionBubble()
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms)
}

init()
