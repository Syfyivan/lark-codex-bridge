/* global PIXI */
import { connectAgentSync } from './agent-sync.js'
import { reactToEvent } from './reactions.js'

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

    // One pet, two sources — both flow through the same reaction entry.
    const hooks = {
      say,
      playMotion: (g) => backend?.playMotion?.(g),
      onStatus: (s) => {
        console.log('[kodama] status:', s)
        backend?.setStatus?.(s)
      },
    }
    // source 'lark' via lark-codex-bridge SSE; bridge URL/token overridable.
    const agentCfg = (await importLocal('./config/agent.local.js'))?.AGENT || {}
    connectAgentSync(hooks, agentCfg)
    window.pet.onAgentEvent?.((event) => reactToEvent(event, hooks)) // source 'local'
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
  say('嗯？要开始干活了吗 🐾', 1800)
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
