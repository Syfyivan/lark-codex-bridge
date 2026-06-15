/* global PIXI */
import { connectAgentSync } from './agent-sync.js'
import { reactToEvent } from './reactions.js'

// A cute Cubism 4 sample model (Haru). Swapped for a local model in P1.
const MODEL_URL =
  'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json'

const { Live2DModel } = PIXI.live2d

const canvas = document.getElementById('pet-canvas')
const bubble = document.getElementById('bubble')

const app = new PIXI.Application({
  view: canvas,
  resizeTo: window,
  backgroundAlpha: 0, // transparent stage
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
})

let model

async function init() {
  try {
    // autoInteract:false — we drive hit-testing/click-through ourselves below.
    model = await Live2DModel.from(MODEL_URL, { autoInteract: false })
    app.stage.addChild(model)
    layout()
    window.addEventListener('resize', layout)
    setupInteraction()
    say('你好，我是 Kodama~ 🌳', 3000)

    // One pet, two sources — both flow through the same reaction entry.
    const hooks = {
      say,
      playMotion,
      onStatus: (s) => console.log('[kodama] status:', s),
    }
    // source 'lark': the Feishu bot via lark-codex-bridge (SSE). No-op visually
    // until the bridge runs with PET_SYNC_ENABLED=1.
    connectAgentSync(hooks)
    // source 'local': Claude Code / Codex hooks posted to the local receiver
    // in the main process, forwarded here over IPC.
    window.pet.onAgentEvent?.((event) => reactToEvent(event, hooks))
  } catch (err) {
    console.error('[kodama] model load failed:', err)
    say('模型加载失败，检查网络 / CDN', 6000)
  }
}

function layout() {
  if (!model) return
  const { originalWidth, originalHeight } = model.internalModel
  const scale = Math.min(window.innerWidth / originalWidth, window.innerHeight / originalHeight)
  model.scale.set(scale)
  model.x = (window.innerWidth - model.width) / 2
  model.y = window.innerHeight - model.height // stand on the bottom edge
}

function setupInteraction() {
  let ignoring = true // window currently click-through?
  let dragging = false
  let lastX = 0
  let lastY = 0

  const overModel = (x, y) => {
    const b = model.getBounds()
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
  }

  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      window.pet.move(e.screenX - lastX, e.screenY - lastY)
      lastX = e.screenX
      lastY = e.screenY
      return
    }
    const over = overModel(e.clientX, e.clientY)
    if (over && ignoring) {
      ignoring = false
      window.pet.setIgnoreMouse(false)
    } else if (!over && !ignoring) {
      ignoring = true
      window.pet.setIgnoreMouse(true, { forward: true })
    }
  })

  window.addEventListener('mousedown', (e) => {
    if (!overModel(e.clientX, e.clientY)) return
    dragging = true
    lastX = e.screenX
    lastY = e.screenY
    onTap()
  })

  window.addEventListener('mouseup', () => {
    dragging = false
  })
}

function playMotion(group) {
  if (!model) return
  try {
    model.motion(group)
  } catch (_) {
    /* group may not exist on this model */
  }
}

function onTap() {
  // Best-effort tap reaction; idle/blink/breath play automatically.
  try {
    model.motion('TapBody')
  } catch (_) {
    /* model may not define this group */
  }
  say('嗯？要开始干活了吗 🐾', 1800)
}

let bubbleTimer
function say(text, ms = 2500) {
  bubble.textContent = text
  bubble.classList.remove('hidden')
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms)
}

init()
