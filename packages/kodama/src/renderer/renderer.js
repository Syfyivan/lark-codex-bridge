/* global PIXI */
import { connectAgentSync } from './agent-sync.js'
import { reactToEvent } from './reactions.js'
import { PET_CONFIG } from './config/pet-config.js'
import { initAccessoryLayer } from './accessories.js'
import { ACCESSORIES, ACCESSORY_SLOTS } from './config/accessories.js'
import { initGrowth, feed as feedGrowth, feedManually, growthScale, feedTokens, statusText, getState as getGrowthState, equipAccessory, configureAccessories } from './growth.js'

// Live2D model is chosen by `pnpm run setup <name>` (writes ./models/current-model.js).
const FALLBACK_MODEL_URL = './models/wanko/Wanko.model3.json'

const canvas = document.getElementById('pet-canvas')
const bubble = document.getElementById('bubble')
const eventPanel = document.getElementById('event-panel')
const panelStatus = document.getElementById('panel-status')
const waitingEvents = document.getElementById('waiting-events')
const doneEvents = document.getElementById('done-events')
const sessionEvents = document.getElementById('session-events')
const recentEvents = document.getElementById('recent-events')
const configEvents = document.getElementById('config-events')
const panelTabs = document.getElementById('panel-tabs')
const panelHeader = document.querySelector('.panel-header')
const panelClose = document.getElementById('event-panel-close')
const bridgeTasksOpen = document.getElementById('bridge-tasks-open')
const manageOpen = document.getElementById('manage-open')
const bridgeTasksRefresh = document.getElementById('bridge-tasks-refresh')
const bridgeTasksShare = document.getElementById('bridge-tasks-share')
const bridgeTasksWindow = document.getElementById('bridge-tasks-window')
const bridgeTasksSummary = document.getElementById('bridge-tasks-summary')
const bridgeTasksList = document.getElementById('bridge-tasks-list')
const metricWaiting = document.getElementById('metric-waiting')
const metricDone = document.getElementById('metric-done')
const metricTotal = document.getElementById('metric-total')
const settingPetScale = document.getElementById('setting-pet-scale')
const settingPetScaleValue = document.getElementById('setting-pet-scale-value')
const settingPetOpacity = document.getElementById('setting-pet-opacity')
const settingPetOpacityValue = document.getElementById('setting-pet-opacity-value')
const settingHitboxScale = document.getElementById('setting-hitbox-scale')
const settingHitboxScaleValue = document.getElementById('setting-hitbox-scale-value')
const settingTriggerMode = document.getElementById('setting-trigger-mode')
const settingEdgeMode = document.getElementById('setting-edge-mode')
const settingPettingEnabled = document.getElementById('setting-petting-enabled')
const settingWanderEnabled = document.getElementById('setting-wander-enabled')
const settingDndMode = document.getElementById('setting-dnd-mode')
const settingSoundEnabled = document.getElementById('setting-sound-enabled')
const settingNotificationsEnabled = document.getElementById('setting-notifications-enabled')
const settingFocusMinutes = document.getElementById('setting-focus-minutes')
const settingShortBreakMinutes = document.getElementById('setting-short-break-minutes')
const settingLongBreakMinutes = document.getElementById('setting-long-break-minutes')
const settingSedentaryMinutes = document.getElementById('setting-sedentary-minutes')
const settingLongBreakEvery = document.getElementById('setting-long-break-every')
const settingLongBreakEveryValue = document.getElementById('setting-long-break-every-value')
const settingBubbleCorner = document.getElementById('setting-bubble-corner')
const settingPanelCorner = document.getElementById('setting-panel-corner')
const settingBubbleAnchor = document.getElementById('setting-bubble-anchor')
const settingBubbleAnchorValue = document.getElementById('setting-bubble-anchor-value')
const settingBubbleGap = document.getElementById('setting-bubble-gap')
const settingBubbleGapValue = document.getElementById('setting-bubble-gap-value')
const settingExportConfig = document.getElementById('setting-export-config')
const settingImportConfig = document.getElementById('setting-import-config')
const settingHidePet = document.getElementById('setting-hide-pet')
const bubbleHoverTip = document.createElement('div')
bubbleHoverTip.id = 'bubble-hover-tip'
bubbleHoverTip.className = 'hidden'
document.body.appendChild(bubbleHoverTip)

// Active rendering backend: { getBounds(), playMotion(pref), setStatus(status) }.
let backend = null
let accessoryLayer = null
let panelVisible = false
let agentSyncStatus = 'offline'
let activeAgentConfig = { bridgeUrl: 'http://127.0.0.1:8787' }
let activeAccessorySlots = ACCESSORY_SLOTS
let activeAccessories = ACCESSORIES
let activeBubbleEvent = null
let activePanelTab = 'settings'
let eventSeq = 0
let bubbleSeq = 0
const eventLog = []
const bubbleLog = []
const sessionPreviewCache = new Map()
const MAX_EVENT_LOG = 40
const MAX_BUBBLES = 4
const PANEL_TABS = new Set(['settings', 'waiting', 'done', 'sessions', 'bridge', 'recent', 'config'])
const FLOATING_PADDING = 8
const BUBBLE_WIDTH = 260
const PANEL_WIDTH = 310
let bridgeTasksState = {
  loading: false,
  loaded: false,
  error: '',
  tasks: [],
  updatedAt: '',
}
const UI_SETTINGS_VERSION = 3
const CORNERS = new Set(['auto', 'near', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])
const DEFAULT_UI_SETTINGS = {
  version: UI_SETTINGS_VERSION,
  petScale: 0.72,
  petOpacity: 0.82,
  hitboxScale: 0.35,
  triggerMode: 'right',
  edgeMode: 'half',
  pettingEnabled: true,
  wanderEnabled: false,
  dndMode: false,
  soundEnabled: true,
  notificationsEnabled: true,
  bubbleCorner: 'near',
  panelCorner: 'near',
  bubbleAnchor: 58,
  bubbleGap: 4,
  petX: null, // pet position inside the full-workarea overlay (null = auto bottom-right)
  petY: null,
  ttsEnabled: false, // speak important events via macOS `say`
}
let uiSettings = loadUiSettings()
let pomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sedentaryMinutes: 45,
}
let activeHoverBubbleId = ''
let wanderTimer = null
let floatingLayoutFrame = 0

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeUiSettings(source = {}) {
  return {
    version: UI_SETTINGS_VERSION,
    petScale: clampNumber(source.petScale, 0.4, 1.25, DEFAULT_UI_SETTINGS.petScale),
    petOpacity: clampNumber(source.petOpacity, 0.25, 1, DEFAULT_UI_SETTINGS.petOpacity),
    hitboxScale: clampNumber(source.hitboxScale, 0.25, 1, DEFAULT_UI_SETTINGS.hitboxScale),
    triggerMode: source.triggerMode === 'left' ? 'left' : 'right',
    edgeMode: source.edgeMode === 'inside' ? 'inside' : DEFAULT_UI_SETTINGS.edgeMode,
    pettingEnabled: source.pettingEnabled !== false,
    wanderEnabled: source.wanderEnabled === true,
    dndMode: source.dndMode === true,
    soundEnabled: source.soundEnabled !== false,
    notificationsEnabled: source.notificationsEnabled !== false,
    bubbleCorner: CORNERS.has(source.bubbleCorner) ? source.bubbleCorner : DEFAULT_UI_SETTINGS.bubbleCorner,
    panelCorner: CORNERS.has(source.panelCorner)
      ? source.panelCorner
      : DEFAULT_UI_SETTINGS.panelCorner,
    bubbleAnchor: clampNumber(source.bubbleAnchor, 35, 80, DEFAULT_UI_SETTINGS.bubbleAnchor),
    bubbleGap: clampNumber(source.bubbleGap, 0, 48, DEFAULT_UI_SETTINGS.bubbleGap),
    petX: Number.isFinite(source.petX) ? source.petX : null,
    petY: Number.isFinite(source.petY) ? source.petY : null,
    ttsEnabled: source.ttsEnabled === true,
  }
}

function loadUiSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('kodama-ui-settings') || '{}')
    // Older settings used a 100% pet and full transparent model bounds. Reset
    // once so running installs pick up the compact, low-misclick defaults.
    const source = raw.version === UI_SETTINGS_VERSION ? raw : {}
    return normalizeUiSettings(source)
  } catch {
    return { ...DEFAULT_UI_SETTINGS }
  }
}

function saveUiSettings() {
  localStorage.setItem('kodama-ui-settings', JSON.stringify(uiSettings))
}

let savePetPosTimer = 0
function scheduleSavePetPos() {
  if (savePetPosTimer) return
  savePetPosTimer = setTimeout(() => {
    savePetPosTimer = 0
    saveUiSettings()
  }, 400)
}

function applyUiSettings() {
  document.documentElement.style.setProperty('--pet-scale', String(uiSettings.petScale))
  document.documentElement.style.setProperty('--pet-opacity', String(uiSettings.petOpacity))
  backend?.applySettings?.()
  syncAccessories()
  window.pet.updateUiMenuState?.({
    dndMode: uiSettings.dndMode,
    soundEnabled: uiSettings.soundEnabled,
    notificationsEnabled: uiSettings.notificationsEnabled,
  })
  positionBubble()
  positionPanel()
  configureWander()
  syncSettingControls()
  window.pet.reportUiSettings?.(uiSettings) // keep the management window in sync
}

function setDndMode(enabled, announce = true) {
  uiSettings.dndMode = enabled === true
  saveUiSettings()
  applyUiSettings()
  if (announce) {
    say(uiSettings.dndMode ? '已进入勿扰模式，事件会静默记录' : '已退出勿扰模式', 2600)
  }
}

function setBooleanSetting(key, value) {
  uiSettings[key] = value === true
  saveUiSettings()
  applyUiSettings()
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizePomodoroSettings(next = {}) {
  return {
    focusMinutes: clampInt(next.focusMinutes, 1, 180, pomodoroSettings.focusMinutes),
    shortBreakMinutes: clampInt(next.shortBreakMinutes, 1, 60, pomodoroSettings.shortBreakMinutes),
    longBreakMinutes: clampInt(next.longBreakMinutes, 1, 120, pomodoroSettings.longBreakMinutes),
    longBreakEvery: clampInt(next.longBreakEvery, 1, 12, pomodoroSettings.longBreakEvery),
    sedentaryMinutes: clampInt(next.sedentaryMinutes, 0, 240, pomodoroSettings.sedentaryMinutes),
  }
}

async function loadPomodoroSettings() {
  try {
    const settings = await window.pet.getPomodoroSettings?.()
    if (settings) pomodoroSettings = normalizePomodoroSettings(settings)
  } catch {
    /* defaults are usable */
  }
  syncSettingControls()
}

function updatePomodoroSettings(patch) {
  pomodoroSettings = normalizePomodoroSettings({ ...pomodoroSettings, ...patch })
  window.pet.updatePomodoroSettings?.(pomodoroSettings)
  syncSettingControls()
}

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

async function loadAccessoryPack() {
  const local = await importLocal('./config/accessories.local.js')
  const overrides = new Map(Array.isArray(local?.ACCESSORIES) ? local.ACCESSORIES.map(item => [item.id, item]) : [])
  activeAccessorySlots = Array.isArray(local?.ACCESSORY_SLOTS) && local.ACCESSORY_SLOTS.length
    ? local.ACCESSORY_SLOTS
    : ACCESSORY_SLOTS
  activeAccessories = ACCESSORIES.map(item => overrides.has(item.id) ? { ...item, ...overrides.get(item.id) } : item)
  for (const [id, item] of overrides) {
    if (!activeAccessories.some(acc => acc.id === id)) activeAccessories.push(item)
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

    await loadAccessoryPack()
    configureAccessories({ accessories: activeAccessories, slots: activeAccessorySlots })
    setupInteraction()
    // Tray "size" presets push a pet scale into the renderer (the overlay window
    // itself is fixed to the work area now).
    window.pet.onSetScale?.((scale) => {
      uiSettings.petScale = clampNumber(scale, 0.4, 1.25, uiSettings.petScale)
      saveUiSettings()
      applyUiSettings()
    })
    // 管理窗口的「摸摸」按钮
    window.pet.onDoPet?.(() => {
      backend?.playMotion('Tap')
      say('摸摸~ 🐾', 1600)
    })
    // 管理窗口的「投喂」按钮:食物→经验,升级可能变大 → 重排
    window.pet.onDoFeed?.(() => {
      feedManually()
      syncAccessories()
      backend?.applySettings?.()
    })
    // Settings changed from the management window arrive as a patch.
    window.pet.onApplyUiPatch?.((patch) => {
      if (!patch || typeof patch !== 'object') return
      uiSettings = normalizeUiSettings({ ...uiSettings, ...patch })
      saveUiSettings()
      applyUiSettings()
    })
    accessoryLayer = initAccessoryLayer(() => backend?.getBounds?.(), { accessories: activeAccessories })
    applyUiSettings()
    loadPomodoroSettings()
    say('你好，我是 Kodama~ 🌳', 3000)

    // One pet, two sources — both flow through the same handler (reaction + growth).
    const hooks = {
      say,
      playMotion: (g) => backend?.playMotion?.(g),
      onStatus: (s) => {
        agentSyncStatus = s
        console.log('[kodama] status:', s)
        backend?.setStatus?.(s)
        syncEventPanel()
      },
      onChange: syncAccessories,
    }
    await initGrowth(hooks)
    syncAccessories()
    const handleAgentEvent = (event) => {
      recordAgentEvent(event)
      if (!uiSettings.dndMode) {
        reactToEvent(event, hooks, {
          sound: uiSettings.soundEnabled,
          notifications: uiSettings.notificationsEnabled,
        })
        speakEvent(event) // optional macOS TTS for important events
      }
      feedGrowth(event.type) // P4: events feed the pet
      // Cross-source token ledger: bridge (source 'lark') events may carry tokens.
      if (event.source === 'lark' && event.tokens) window.pet.addLarkTokens?.(event.tokens)
    }

    // source 'lark' via lark-codex-bridge SSE; bridge URL/token overridable.
    const agentCfg = (await importLocal('./config/agent.local.js'))?.AGENT || {}
    activeAgentConfig = { bridgeUrl: agentCfg.bridgeUrl || 'http://127.0.0.1:8787', token: agentCfg.token || '' }
    connectAgentSync(handleAgentEvent, { ...agentCfg, onStatus: hooks.onStatus })
    window.pet.onAgentEvent?.(handleAgentEvent) // source 'local'
    window.pet.onTogglePanel?.(() => togglePanel())
    window.pet.onSetDndMode?.((enabled) => setDndMode(enabled === true))
    setupEventPanel()
    window.pet.onEquipAccessory?.((request) => {
      const result = equipAccessory(request)
      if (!result.ok) {
        say(`🔒 ${result.reason}`, 2600)
        return
      }
      syncAccessories()
      if (result.action === 'equip') say(`已佩戴 ${result.accessory.label}`, 2200)
      if (result.action === 'unequip') say('已摘下配饰', 1800)
    })

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

function syncAccessories() {
  const state = getGrowthState()
  accessoryLayer?.setEquipped(state.equippedAccessories || {})
  window.pet.updateAccessoryMenu?.({
    slots: activeAccessorySlots,
    accessories: activeAccessories.map(({ id, slot, label, unlockLevel }) => ({ id, slot, label, unlockLevel })),
    unlocked: state.unlockedAccessories || [],
    equipped: state.equippedAccessories || {},
  })
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
    // The window now spans the whole work area, so scale against a nominal pet
    // box (not the window) and place the model at the persisted petX/petY.
    const PET_BOX_W = 280
    const PET_BOX_H = 400
    const baseScale = Math.min(PET_BOX_W / originalWidth, PET_BOX_H / originalHeight)
    // 等级越高桌宠越大(幼崽→成年),再乘用户的大小偏好。
    const scale = baseScale * uiSettings.petScale * growthScale()
    model.alpha = uiSettings.petOpacity
    model.scale.set(scale)
    const pw = model.width
    const ph = model.height
    const margin = 24
    const autoX = window.innerWidth - pw - margin
    const autoY = window.innerHeight - ph - margin
    // Honor edge mode. Live2D models carry a lot of transparent padding, so
    // clamping fully-inside leaves a big visible gap. 'half' lets the pet hang
    // partway off-screen so its visible body can truly hug/reach the edge.
    const minVisible = uiSettings.edgeMode === 'half' ? 0.42 : 1
    const overflowX = pw * (1 - minVisible)
    const overflowY = ph * (1 - minVisible)
    const px = clampPoint(Number.isFinite(uiSettings.petX) ? uiSettings.petX : autoX, -overflowX, window.innerWidth - pw + overflowX)
    const py = clampPoint(Number.isFinite(uiSettings.petY) ? uiSettings.petY : autoY, -overflowY, window.innerHeight - ph + overflowY)
    model.x = px
    model.y = py
    uiSettings.petX = px
    uiSettings.petY = py
    positionBubble()
    positionPanel()
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
    applySettings: layout,
  }
}

// ---------- window interaction (backend-agnostic) ----------
function clampPoint(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function petBounds() {
  if (!backend?.getBounds) return null
  const b = backend.getBounds()
  if (!b || b.width <= 0 || b.height <= 0) return null
  return b
}

function interactivePetBounds() {
  const b = petBounds()
  if (!b) return null
  const width = b.width * uiSettings.hitboxScale
  const height = b.height * uiSettings.hitboxScale
  const centerX = b.x + b.width / 2
  const centerY = b.y + b.height * 0.66
  return {
    x: clampPoint(centerX - width / 2, b.x, b.x + b.width - width),
    y: clampPoint(centerY - height / 2, b.y, b.y + b.height - height),
    width,
    height,
  }
}

function dragVisibleBounds() {
  const floating = floatingVisibleBounds()
  if (floating) return floating
  const b = petBounds()
  if (!b) return null
  return {
    ...b,
    minVisibleRatio: uiSettings.edgeMode === 'half' ? 0.42 : 1,
  }
}

function overPet(x, y) {
  const b = interactivePetBounds()
  if (!b) return false
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
}

function overElement(el, x, y) {
  if (!el || el.classList.contains('hidden')) return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

function overInteractiveSurface(x, y) {
  return panelVisible || overElement(bubble, x, y) || overPet(x, y)
}

function setupInteraction() {
  let ignoring = true
  let dragging = false
  let lastX = 0
  let lastY = 0
  let suppressOutsidePanelClick = false

  function startDrag(e, { tap = false } = {}) {
    dragging = true
    lastX = e.screenX
    lastY = e.screenY
    if (tap) onTap()
  }

  function targetInsidePanel(target) {
    return Boolean(eventPanel && target?.nodeType && eventPanel.contains(target))
  }

  window.addEventListener('mousedown', (e) => {
    if (!panelVisible || targetInsidePanel(e.target)) return
    suppressOutsidePanelClick = true
    e.preventDefault()
    e.stopPropagation()
    togglePanel(false)
  }, true)

  window.addEventListener('click', (e) => {
    if (!suppressOutsidePanelClick) return
    suppressOutsidePanelClick = false
    e.preventDefault()
    e.stopPropagation()
  }, true)

  window.addEventListener('blur', () => {
    if (panelVisible) togglePanel(false)
  })

  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      // Move the pet *within* the full-workarea overlay; layout() re-clamps so
      // it can hug any edge, and repositions the bubble adaptively.
      const baseX = Number.isFinite(uiSettings.petX) ? uiSettings.petX : 0
      const baseY = Number.isFinite(uiSettings.petY) ? uiSettings.petY : 0
      uiSettings.petX = baseX + (e.screenX - lastX)
      uiSettings.petY = baseY + (e.screenY - lastY)
      lastX = e.screenX
      lastY = e.screenY
      backend?.applySettings?.()
      scheduleSavePetPos()
      return
    }
    const over = overInteractiveSurface(e.clientX, e.clientY)
    if (over && ignoring) {
      ignoring = false
      window.pet.setIgnoreMouse(false)
    } else if (!over && !ignoring) {
      ignoring = true
      window.pet.setIgnoreMouse(true, { forward: true })
    }
  })

  window.addEventListener('mousedown', (e) => {
    if (panelVisible || e.button !== 0 || overElement(bubble, e.clientX, e.clientY)) return
    if (!overPet(e.clientX, e.clientY)) return
    // 左键直接按在桌宠身上即可拖动(抓住就拖,符合直觉);静止点击不会移动它,
    // 左键触发模式下静止点击=摸摸。右键仍打开面板。
    startDrag(e, { tap: uiSettings.triggerMode === 'left' })
  })

  window.addEventListener('mouseup', () => {
    if (dragging) saveUiSettings()
    dragging = false
  })

  window.addEventListener('contextmenu', (e) => {
    if (!overInteractiveSurface(e.clientX, e.clientY)) return
    e.preventDefault()
    togglePanel(true)
  })

  window.addEventListener('dblclick', (e) => {
    if (!uiSettings.pettingEnabled || panelVisible || !overPet(e.clientX, e.clientY)) return
    e.preventDefault()
    backend?.playMotion('Tap')
    say('摸摸~', 1600)
  })

  bubble.addEventListener('click', (e) => {
    e.stopPropagation()
    if (e.target.closest?.('[data-dismiss-all-bubbles]')) {
      bubbleLog.length = 0
      hideBubbleHover()
      renderBubbles()
      return
    }
    const dismiss = e.target.closest?.('[data-dismiss-bubble]')
    if (dismiss) {
      hideBubbleHover()
      removeBubble(dismiss.dataset.dismissBubble)
      return
    }
    const share = e.target.closest?.('[data-share-bubble]')
    if (share) {
      hideBubbleHover()
      shareBubbleSession(share.dataset.shareBubble)
      return
    }
    const card = e.target.closest?.('[data-bubble-id]')
    const item = bubbleLog.find(record => record.id === card?.dataset.bubbleId)
    if (item) {
      const target = targetForEvent(item.event)
      if (target) openTarget(target)
      return
    }
    openBubbleTarget(activeBubbleEvent)
  })

  bubble.addEventListener('mousemove', (e) => {
    const card = e.target.closest?.('[data-bubble-id]')
    if (!card) {
      hideBubbleHover()
      return
    }
    const item = bubbleLog.find(record => record.id === card.dataset.bubbleId)
    if (!item) {
      hideBubbleHover()
      return
    }
    showBubbleHover(item, e, card)
  })

  bubble.addEventListener('mouseleave', hideBubbleHover)

  panelHeader?.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest?.('button')) return
    e.preventDefault()
    startDrag(e)
  })
}

function onTap() {
  backend?.playMotion('Tap')
  const lark = tokenStats.lark?.today || 0
  const larkPart = lark > 0 ? `（飞书 ${fmtTokens(lark)}）` : ''
  say(`🐾 ${statusText()} · 今日 ${fmtTokens(tokenStats.today)} tok${larkPart}`, 3000)
}

function configureWander() {
  if (wanderTimer) {
    clearInterval(wanderTimer)
    wanderTimer = null
  }
  if (!uiSettings.wanderEnabled) return
  wanderTimer = setInterval(() => {
    if (panelVisible || document.hidden) return
    const b = petBounds()
    if (!b) return
    const dx = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.round(Math.random() * 20))
    const dy = Math.round((Math.random() - 0.5) * 10)
    window.pet.move(dx, dy, dragVisibleBounds())
    scheduleFloatingLayout()
    backend?.playMotion?.('Idle')
  }, 18000)
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
function visibleRectFor(el, fallbackWidth = 240, fallbackHeight = 64) {
  const rect = el?.getBoundingClientRect?.()
  return {
    width: Math.ceil(rect?.width || el?.offsetWidth || fallbackWidth),
    height: Math.ceil(Math.max(el?.scrollHeight || 0, rect?.height || el?.offsetHeight || 0, fallbackHeight)),
  }
}

function viewportVisibleArea() {
  const screenLeft = Number.isFinite(window.screen?.availLeft) ? window.screen.availLeft : 0
  const screenTop = Number.isFinite(window.screen?.availTop) ? window.screen.availTop : 0
  const screenWidth = Number.isFinite(window.screen?.availWidth) ? window.screen.availWidth : window.screen?.width || window.innerWidth
  const screenHeight = Number.isFinite(window.screen?.availHeight) ? window.screen.availHeight : window.screen?.height || window.innerHeight
  const winX = Number.isFinite(window.screenX) ? window.screenX : 0
  const winY = Number.isFinite(window.screenY) ? window.screenY : 0
  const area = {
    left: Math.max(0, screenLeft - winX),
    top: Math.max(0, screenTop - winY),
    right: Math.min(window.innerWidth, screenLeft + screenWidth - winX),
    bottom: Math.min(window.innerHeight, screenTop + screenHeight - winY),
  }
  if (area.right - area.left < 24 || area.bottom - area.top < 24) {
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    }
  }
  return area
}

function clampElementToVisibleArea(left, top, width, height, padding = FLOATING_PADDING) {
  const area = viewportVisibleArea()
  const minLeft = area.left + padding
  const maxLeft = area.right - width - padding
  const minTop = area.top + padding
  const maxTop = area.bottom - height - padding
  return {
    left: clampPoint(left, minLeft, Math.max(minLeft, maxLeft)),
    top: clampPoint(top, minTop, Math.max(minTop, maxTop)),
  }
}

function prepareFloatingElement(el, preferredWidth, fallbackHeight, padding = FLOATING_PADDING) {
  const area = viewportVisibleArea()
  const availableWidth = Math.max(44, Math.floor(area.right - area.left - padding * 2))
  const availableHeight = Math.max(44, Math.floor(area.bottom - area.top - padding * 2))
  const width = Math.min(preferredWidth, availableWidth)
  if (el) {
    el.style.width = `${width}px`
    el.style.maxWidth = `${availableWidth}px`
  }
  const rect = visibleRectFor(el, width, fallbackHeight)
  const naturalHeight = rect.height
  const height = Math.min(naturalHeight, availableHeight)
  setElementMaxHeight(el, availableHeight)
  return { area, padding, width, height, naturalHeight, availableHeight }
}

function setElementMaxHeight(el, maxHeight) {
  if (!el) return
  const height = Math.max(44, Math.floor(maxHeight))
  el.style.maxHeight = `${height}px`
}

function rectIntersection(a, b) {
  if (!a || !b) return null
  const left = Math.max(a.left ?? a.x, b.left ?? b.x)
  const top = Math.max(a.top ?? a.y, b.top ?? b.y)
  const right = Math.min(a.right ?? (a.x + a.width), b.right ?? (b.x + b.width))
  const bottom = Math.min(a.bottom ?? (a.y + a.height), b.bottom ?? (b.y + b.height))
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function rectArea(rect) {
  return rect ? Math.max(0, rect.width) * Math.max(0, rect.height) : 0
}

function elementDragBounds(el) {
  if (!el || el.classList.contains('hidden')) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function floatingVisibleBounds() {
  const rects = [
    panelVisible ? elementDragBounds(eventPanel) : null,
    elementDragBounds(bubble),
  ].filter(Boolean)
  if (!rects.length) return null
  const left = Math.min(...rects.map(rect => rect.left))
  const top = Math.min(...rects.map(rect => rect.top))
  const right = Math.max(...rects.map(rect => rect.right))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    minVisibleRatio: 1,
  }
}

function scheduleFloatingLayout() {
  if (floatingLayoutFrame) return
  floatingLayoutFrame = requestAnimationFrame(() => {
    floatingLayoutFrame = 0
    positionBubble()
    positionPanel()
  })
}

function chooseCorner(width, height) {
  const padding = 10
  const area = viewportVisibleArea()
  const pet = petBounds()
  const petCenter = pet
    ? { x: pet.x + pet.width / 2, y: pet.y + pet.height / 2 }
    : { x: (area.left + area.right) / 2, y: area.bottom }
  const candidates = [
    { id: 'top-left', x: area.left + padding, y: area.top + padding },
    { id: 'top-right', x: area.right - width - padding, y: area.top + padding },
    { id: 'bottom-left', x: area.left + padding, y: area.bottom - height - padding },
    { id: 'bottom-right', x: area.right - width - padding, y: area.bottom - height - padding },
  ]
  return candidates
    .map((candidate) => {
      const { left: x, top: y } = clampElementToVisibleArea(candidate.x, candidate.y, width, height, padding)
      const cx = x + width / 2
      const cy = y + height / 2
      const distance = (cx - petCenter.x) ** 2 + (cy - petCenter.y) ** 2
      return { ...candidate, x, y, distance }
    })
    .sort((a, b) => b.distance - a.distance)[0]
}

function setElementCorner(el, corner, fallbackWidth, fallbackHeight) {
  if (!el) return
  if (corner === 'near') {
    positionNearPet(el, fallbackWidth, fallbackHeight)
    return
  }
  const { width, height, area, padding } = prepareFloatingElement(el, fallbackWidth, fallbackHeight, 10)
  const chosen = corner === 'auto' ? chooseCorner(width, height).id : corner
  const maxHeight = Math.max(44, area.bottom - area.top - padding * 2)
  const displayHeight = Math.min(height, maxHeight)
  const top = chosen.includes('top') ? area.top + padding : area.bottom - displayHeight - padding
  const left = chosen.includes('left') ? area.left + padding : area.right - width - padding
  const next = clampElementToVisibleArea(left, top, width, displayHeight, padding)
  setElementMaxHeight(el, maxHeight)
  el.style.transform = 'none'
  el.style.left = `${next.left}px`
  el.style.top = `${next.top}px`
}

function positionNearPet(el, fallbackWidth, fallbackHeight) {
  const pet = petBounds()
  const { width, height, naturalHeight, area, padding } = prepareFloatingElement(el, fallbackWidth, fallbackHeight)
  if (!pet) {
    setElementCorner(el, 'top-right', fallbackWidth, fallbackHeight)
    return
  }
  // Live2D bounds carry a lot of transparent padding, so snuggling against the
  // raw bounds leaves a big visible gap. Anchor the bubble to a centered visible
  // core instead, and keep the gap well under half the pet width.
  const CORE = 0.58
  const coreW = pet.width * CORE
  const coreH = pet.height * CORE
  const gap = Math.min(Math.max(6, uiSettings.bubbleGap), coreW * 0.5)
  const petRect = {
    left: pet.x + (pet.width - coreW) / 2,
    top: pet.y + (pet.height - coreH) / 2,
    right: pet.x + (pet.width + coreW) / 2,
    bottom: pet.y + (pet.height + coreH) / 2,
    width: coreW,
    height: coreH,
  }
  const visiblePet = rectIntersection(petRect, area)
  const anchorX = clampPoint(pet.x + pet.width / 2, area.left + padding, area.right - padding)
  const anchorY = clampPoint(
    pet.y + pet.height * (uiSettings.bubbleAnchor / 100),
    area.top + padding,
    area.bottom - padding,
  )
  const petOffRight = pet.x + pet.width > area.right - padding
  const petOffLeft = pet.x < area.left + padding
  const petOffBottom = pet.y + pet.height > area.bottom - padding
  const petOffTop = pet.y < area.top + padding

  if (visiblePet) {
    const minLeft = area.left + padding
    const maxRight = area.right - padding
    const minTop = area.top + padding
    const maxBottom = area.bottom - padding
    const zones = [
      {
        id: 'above',
        side: anchorX < visiblePet.left + visiblePet.width / 2 ? 'left' : 'right',
        vertical: 'top',
        left: minLeft,
        top: minTop,
        right: maxRight,
        bottom: Math.max(minTop, visiblePet.top - gap),
        preferredLeft: anchorX - width / 2,
        preferredTop: visiblePet.top - gap - Math.min(naturalHeight, Math.max(44, visiblePet.top - gap - minTop)),
      },
      {
        id: 'below',
        side: anchorX < visiblePet.left + visiblePet.width / 2 ? 'left' : 'right',
        vertical: 'bottom',
        left: minLeft,
        top: Math.min(maxBottom, visiblePet.bottom + gap),
        right: maxRight,
        bottom: maxBottom,
        preferredLeft: anchorX - width / 2,
        preferredTop: visiblePet.bottom + gap,
      },
      {
        id: 'left',
        side: 'left',
        vertical: anchorY < visiblePet.top + visiblePet.height / 2 ? 'top' : 'bottom',
        left: minLeft,
        top: minTop,
        right: Math.max(minLeft, visiblePet.left - gap),
        bottom: maxBottom,
        preferredLeft: visiblePet.left - gap - width,
        preferredTop: anchorY - height / 2,
      },
      {
        id: 'right',
        side: 'right',
        vertical: anchorY < visiblePet.top + visiblePet.height / 2 ? 'top' : 'bottom',
        left: Math.min(maxRight, visiblePet.right + gap),
        top: minTop,
        right: maxRight,
        bottom: maxBottom,
        preferredLeft: visiblePet.right + gap,
        preferredTop: anchorY - height / 2,
      },
    ].map(zone => ({
      ...zone,
      zoneWidth: zone.right - zone.left,
      zoneHeight: zone.bottom - zone.top,
    })).filter(zone => zone.zoneWidth >= width && zone.zoneHeight >= 44)

    const chosen = zones.map((zone) => {
      const displayHeight = Math.min(naturalHeight, zone.zoneHeight)
      const left = clampPoint(zone.preferredLeft, zone.left, Math.max(zone.left, zone.right - width))
      const top = clampPoint(zone.preferredTop, zone.top, Math.max(zone.top, zone.bottom - displayHeight))
      const edgeBonus =
        (petOffRight && zone.side === 'left' ? 5000 : 0) +
        (petOffLeft && zone.side === 'right' ? 5000 : 0) +
        (petOffBottom && zone.vertical === 'top' ? 2200 : 0) +
        (petOffTop && zone.vertical === 'bottom' ? 2200 : 0)
      const fitsNaturalHeight = zone.zoneHeight >= naturalHeight ? 100000 : 0
      const centerDistance = (left + width / 2 - anchorX) ** 2 + (top + displayHeight / 2 - anchorY) ** 2
      return {
        ...zone,
        left,
        top,
        displayHeight,
        score: fitsNaturalHeight + edgeBonus + displayHeight * 12 + zone.zoneWidth - centerDistance * 0.01,
      }
    }).sort((a, b) => b.score - a.score)[0]

    if (chosen) {
      setElementMaxHeight(el, chosen.zoneHeight)
      el.style.transform = 'none'
      el.style.left = `${chosen.left}px`
      el.style.top = `${chosen.top}px`
      return
    }
  }

  const fallbackCandidates = [
    { left: anchorX - width, top: pet.y - gap - height, side: 'left', vertical: 'top' },
    { left: anchorX, top: pet.y - gap - height, side: 'right', vertical: 'top' },
    { left: anchorX - width, top: pet.y + pet.height + gap, side: 'left', vertical: 'bottom' },
    { left: anchorX, top: pet.y + pet.height + gap, side: 'right', vertical: 'bottom' },
  ].map((candidate) => {
    const next = clampElementToVisibleArea(candidate.left, candidate.top, width, height, padding)
    const placed = { left: next.left, top: next.top, right: next.left + width, bottom: next.top + height, width, height }
    const overlap = rectArea(rectIntersection(placed, visiblePet))
    return {
      ...next,
      score: -overlap * 20 - ((next.left - candidate.left) ** 2 + (next.top - candidate.top) ** 2) * 0.02,
    }
  }).sort((a, b) => b.score - a.score)
  const next = fallbackCandidates[0] || clampElementToVisibleArea(area.right - width - padding, area.bottom - height - padding, width, height, padding)
  el.style.transform = 'none'
  el.style.left = `${next.left}px`
  el.style.top = `${next.top}px`
}

function positionBubble() {
  if (uiSettings.bubbleCorner !== 'near') {
    setElementCorner(bubble, uiSettings.bubbleCorner, BUBBLE_WIDTH, 54)
    return
  }
  positionNearPet(bubble, BUBBLE_WIDTH, 80)
}

function positionPanel() {
  if (!eventPanel || eventPanel.classList.contains('hidden')) return
  setElementCorner(eventPanel, uiSettings.panelCorner, PANEL_WIDTH, 260)
}

function bubbleKind(event) {
  if (!event) return 'system'
  if (isWaiting(event)) return 'waiting'
  if (event.source === 'lark') return 'lark'
  if (event.source === 'local') return 'agent'
  if (isDone(event)) return 'done'
  return 'system'
}

function bubbleTitle(event) {
  if (!event) return 'Kodama'
  return `${sourceLabel(event.source)} · ${typeLabel(event.type)}`
}

function isCodexTranscriptPath(value) {
  return /(^|\/)\.codex\/sessions\//.test(String(value || ''))
}

function isClaudeTranscriptPath(value) {
  return /(^|\/)\.claude\/projects\//.test(String(value || ''))
}

function inferSessionIdFromTranscriptPath(value) {
  const file = String(value || '').split('/').pop() || ''
  const uuid = file.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid?.[0] || ''
}

function sessionRequestForEvent(event) {
  if (!event || event.source !== 'local') return null
  const transcriptPath = event.transcriptPath || event.transcript_path || ''
  const agentTranscriptPath = event.agentTranscriptPath || event.agent_transcript_path || ''
  const sessionId = event.sessionId || event.session_id || inferSessionIdFromTranscriptPath(transcriptPath)
  const threadId = event.threadId || event.thread_id || event['thread-id'] || ''
  const client = String(event.client || event.originator || '').toLowerCase()
  const provider = isClaudeTranscriptPath(transcriptPath) || isClaudeTranscriptPath(agentTranscriptPath) || client.includes('claude')
    ? 'claude'
    : isCodexTranscriptPath(transcriptPath) || client.includes('codex') || threadId || sessionId
      ? 'codex'
      : ''
  const id = provider === 'codex' ? (threadId || sessionId) : sessionId
  if (!provider || !id) return null
  return {
    provider,
    sessionId: id,
    threadId,
    transcriptPath,
    agentTranscriptPath,
    cwd: event.cwd || event.projectDir || event.project_dir || event.workspacePath || event.workspace_path || '',
    bridgeUrl: activeAgentConfig.bridgeUrl || 'http://127.0.0.1:8787',
    token: activeAgentConfig.token || '',
  }
}

function shouldPersistBubble(event) {
  return Boolean(event?.type)
}

function removeBubble(id) {
  const index = bubbleLog.findIndex(item => item.id === String(id))
  if (index >= 0) bubbleLog.splice(index, 1)
  renderBubbles()
}

function trimBubbles() {
  while (bubbleLog.length > MAX_BUBBLES) {
    const transientIndex = bubbleLog.findLastIndex(item => !item.persistent)
    bubbleLog.splice(transientIndex >= 0 ? transientIndex : bubbleLog.length - 1, 1)
  }
}

function renderBubbles() {
  if (!bubbleLog.length) {
    bubble.classList.add('hidden')
    bubble.innerHTML = ''
    activeBubbleEvent = null
    hideBubbleHover()
    return
  }
  activeBubbleEvent = bubbleLog[0]?.event || null
  const stackTools = bubbleLog.length > 1
    ? '<div class="bubble-stack-tools"><button type="button" data-dismiss-all-bubbles="1">全部忽略</button></div>'
    : ''
  bubble.innerHTML = stackTools + bubbleLog.map((item) => {
    const target = targetForEvent(item.event)
    const targetText = target ? `<div class="bubble-target">${escapeHtml(target.label || '打开会话')}</div>` : ''
    const shareButton = sessionRequestForEvent(item.event)
      ? `<button type="button" data-share-bubble="${escapeHtml(item.id)}" title="生成会话分享链接">分享</button>`
      : ''
    return [
      `<article class="bubble-card bubble-${escapeHtml(item.kind)}${target ? ' clickable' : ''}" data-bubble-id="${escapeHtml(item.id)}">`,
      '<div class="bubble-head">',
      `<strong>${escapeHtml(item.title)}</strong>`,
      '<div class="bubble-actions">',
      shareButton,
      `<button type="button" data-dismiss-bubble="${escapeHtml(item.id)}" title="忽略">忽略</button>`,
      '</div>',
      '</div>',
      `<div class="bubble-text">${escapeHtml(item.text)}</div>`,
      targetText,
      '</article>',
    ].join('')
  }).join('')
  bubble.classList.remove('hidden')
  positionBubble()
}

function say(text, ms = 2500, event = null) {
  const id = String(++bubbleSeq)
  const persistent = shouldPersistBubble(event)
  bubbleLog.unshift({
    id,
    text,
    event,
    persistent,
    kind: bubbleKind(event),
    title: bubbleTitle(event),
    createdAt: new Date().toISOString(),
  })
  trimBubbles()
  renderBubbles()
  if (!persistent) {
    setTimeout(() => removeBubble(id), ms)
  }
}

function shortText(text, max = 82) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function bubbleHoverHtml(item) {
  const preview = item.preview
  if (preview?.ok) {
    const rows = [
      `<div class="bubble-hover-title">${escapeHtml(preview.title || item.title)}</div>`,
    ]
    for (const line of (preview.lines || []).slice(-2)) {
      rows.push(`<div class="bubble-hover-text">${escapeHtml(shortText(line, 74))}</div>`)
    }
    return rows.join('')
  }
  if (preview?.loading) {
    return [
      `<div class="bubble-hover-title">${escapeHtml(item.title)}</div>`,
      '<div class="bubble-hover-text">正在读取会话摘要...</div>',
    ].join('')
  }
  if (preview?.error) {
    return [
      `<div class="bubble-hover-title">${escapeHtml(item.title)}</div>`,
      `<div class="bubble-hover-text">摘要读取失败：${escapeHtml(preview.error)}</div>`,
    ].join('')
  }
  const rows = [
    `<div class="bubble-hover-title">${escapeHtml(item.title)}</div>`,
    `<div class="bubble-hover-text">${escapeHtml(shortText(item.text, 74))}</div>`,
  ]
  if (item.event?.agent) rows.push(`<div class="bubble-hover-meta">Agent：${escapeHtml(item.event.agent)}</div>`)
  return rows.join('')
}

function showBubbleHover(item, event, anchor) {
  activeHoverBubbleId = item.id
  ensureBubblePreview(item, event, anchor)
  bubbleHoverTip.innerHTML = bubbleHoverHtml(item)
  bubbleHoverTip.classList.remove('hidden')
  positionBubbleHover(anchor, event)
}

function positionBubbleHover(anchor, event) {
  const { width, height } = visibleRectFor(bubbleHoverTip, 220, 72)
  const padding = 8
  const area = viewportVisibleArea()
  const rect = anchor?.getBoundingClientRect?.()
  const anchorLeft = rect ? rect.left + rect.width / 2 - width / 2 : event.clientX + 10
  const belowTop = rect ? rect.top + rect.height + 6 : event.clientY + 10
  const aboveTop = rect ? rect.top - height - 6 : event.clientY - height - 10
  const top = belowTop + height <= area.bottom - padding ? belowTop : aboveTop
  const next = clampElementToVisibleArea(anchorLeft, top, width, height, padding)
  bubbleHoverTip.style.left = `${next.left}px`
  bubbleHoverTip.style.top = `${next.top}px`
}

function hideBubbleHover() {
  activeHoverBubbleId = ''
  bubbleHoverTip.classList.add('hidden')
}

function previewKey(request) {
  return [
    request.provider,
    request.sessionId,
    request.transcriptPath || request.agentTranscriptPath || '',
  ].join(':')
}

async function ensureBubblePreview(item, event, anchor) {
  const request = sessionRequestForEvent(item.event)
  if (!request || item.preview?.ok || item.preview?.loading) return
  const key = previewKey(request)
  if (sessionPreviewCache.has(key)) {
    item.preview = sessionPreviewCache.get(key)
    return
  }
  item.preview = { loading: true }
  try {
    const result = await window.pet.sessionPreview?.(request)
    item.preview = result?.ok ? result : { ok: false, error: result?.error || '没有可见摘要' }
  } catch (error) {
    item.preview = { ok: false, error: String(error?.message || error) }
  }
  sessionPreviewCache.set(key, item.preview)
  if (activeHoverBubbleId === item.id) {
    bubbleHoverTip.innerHTML = bubbleHoverHtml(item)
    positionBubbleHover(anchor, event)
  }
}

init()

function setupEventPanel() {
  panelClose?.addEventListener('click', () => togglePanel(false))
  bridgeTasksOpen?.addEventListener('click', () => openBridgeTasksWindow())
  manageOpen?.addEventListener('click', () => window.pet.openManageWindow?.())
  bridgeTasksRefresh?.addEventListener('click', () => refreshBridgeTasks({ force: true }))
  bridgeTasksShare?.addEventListener('click', () => shareBridgeTaskViewer())
  bridgeTasksWindow?.addEventListener('click', () => openBridgeTasksWindow())
  settingPetScale?.addEventListener('input', () => {
    uiSettings.petScale = clampNumber(Number(settingPetScale.value) / 100, 0.4, 1.25, DEFAULT_UI_SETTINGS.petScale)
    saveUiSettings()
    applyUiSettings()
  })
  settingPetOpacity?.addEventListener('input', () => {
    uiSettings.petOpacity = clampNumber(Number(settingPetOpacity.value) / 100, 0.25, 1, DEFAULT_UI_SETTINGS.petOpacity)
    saveUiSettings()
    applyUiSettings()
  })
  settingHitboxScale?.addEventListener('input', () => {
    uiSettings.hitboxScale = clampNumber(Number(settingHitboxScale.value) / 100, 0.25, 1, DEFAULT_UI_SETTINGS.hitboxScale)
    saveUiSettings()
    applyUiSettings()
  })
  settingBubbleCorner?.addEventListener('change', () => {
    uiSettings.bubbleCorner = CORNERS.has(settingBubbleCorner.value) ? settingBubbleCorner.value : DEFAULT_UI_SETTINGS.bubbleCorner
    saveUiSettings()
    applyUiSettings()
  })
  settingPanelCorner?.addEventListener('change', () => {
    uiSettings.panelCorner = CORNERS.has(settingPanelCorner.value)
      ? settingPanelCorner.value
      : DEFAULT_UI_SETTINGS.panelCorner
    saveUiSettings()
    applyUiSettings()
  })
  settingTriggerMode?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-trigger-mode]')
    if (!button) return
    uiSettings.triggerMode = button.dataset.triggerMode === 'left' ? 'left' : 'right'
    saveUiSettings()
    applyUiSettings()
  })
  settingEdgeMode?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-edge-mode]')
    if (!button) return
    uiSettings.edgeMode = button.dataset.edgeMode === 'inside' ? 'inside' : 'half'
    saveUiSettings()
    applyUiSettings()
  })
  settingPettingEnabled?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-petting-enabled]')
    if (!button) return
    setBooleanSetting('pettingEnabled', button.dataset.pettingEnabled === 'true')
  })
  settingWanderEnabled?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-wander-enabled]')
    if (!button) return
    setBooleanSetting('wanderEnabled', button.dataset.wanderEnabled === 'true')
  })
  settingDndMode?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-dnd-mode]')
    if (!button) return
    setDndMode(button.dataset.dndMode === 'true')
  })
  settingSoundEnabled?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-sound-enabled]')
    if (!button) return
    setBooleanSetting('soundEnabled', button.dataset.soundEnabled === 'true')
  })
  settingNotificationsEnabled?.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-notifications-enabled]')
    if (!button) return
    setBooleanSetting('notificationsEnabled', button.dataset.notificationsEnabled === 'true')
  })
  settingFocusMinutes?.addEventListener('change', () => {
    updatePomodoroSettings({ focusMinutes: settingFocusMinutes.value })
  })
  settingShortBreakMinutes?.addEventListener('change', () => {
    updatePomodoroSettings({ shortBreakMinutes: settingShortBreakMinutes.value })
  })
  settingLongBreakMinutes?.addEventListener('change', () => {
    updatePomodoroSettings({ longBreakMinutes: settingLongBreakMinutes.value })
  })
  settingSedentaryMinutes?.addEventListener('change', () => {
    updatePomodoroSettings({ sedentaryMinutes: settingSedentaryMinutes.value })
  })
  settingLongBreakEvery?.addEventListener('input', () => {
    updatePomodoroSettings({ longBreakEvery: settingLongBreakEvery.value })
  })
  settingBubbleAnchor?.addEventListener('input', () => {
    uiSettings.bubbleAnchor = clampNumber(settingBubbleAnchor.value, 35, 80, DEFAULT_UI_SETTINGS.bubbleAnchor)
    saveUiSettings()
    applyUiSettings()
  })
  settingBubbleGap?.addEventListener('input', () => {
    uiSettings.bubbleGap = clampNumber(settingBubbleGap.value, 0, 48, DEFAULT_UI_SETTINGS.bubbleGap)
    saveUiSettings()
    applyUiSettings()
  })
  settingExportConfig?.addEventListener('click', exportConfigToClipboard)
  settingImportConfig?.addEventListener('click', importConfigFromClipboard)
  settingHidePet?.addEventListener('click', () => window.pet.setHidden?.(true))
  eventPanel?.addEventListener('click', (e) => {
    const tabButton = e.target.closest?.('[data-tab]')
    if (tabButton) {
      setActivePanelTab(tabButton.dataset.tab)
      return
    }
    const sizeButton = e.target.closest?.('[data-window-size]')
    if (sizeButton) {
      const [width, height] = String(sizeButton.dataset.windowSize || '').split('x').map(Number)
      window.pet.setWindowSize?.({ width, height })
      return
    }
    const shareSub = e.target.closest?.('[data-share-subagent]')
    if (shareSub) {
      e.stopPropagation()
      shareSubagentTranscript(shareSub.dataset.shareSubagent)
      return
    }
    const item = e.target.closest?.('[data-event-id]')
    if (item) {
      openEventById(item.dataset.eventId)
      return
    }
    const bridgeItem = e.target.closest?.('[data-bridge-task-id]')
    if (bridgeItem) openBridgeTasksWindow()
  })
  syncEventPanel()
}

async function exportConfigToClipboard() {
  const payload = {
    version: 1,
    ui: uiSettings,
    pomodoro: pomodoroSettings,
  }
  await window.pet.copyText?.(JSON.stringify(payload, null, 2))
  say('配置已复制', 1800)
}

async function importConfigFromClipboard() {
  try {
    const result = await window.pet.readText?.()
    const payload = JSON.parse(result?.text || '{}')
    if (!payload || typeof payload !== 'object') throw new Error('配置格式不对')
    if (payload.ui && typeof payload.ui === 'object') {
      uiSettings = normalizeUiSettings({ ...uiSettings, ...payload.ui })
      saveUiSettings()
    }
    if (payload.pomodoro && typeof payload.pomodoro === 'object') {
      updatePomodoroSettings(payload.pomodoro)
    }
    applyUiSettings()
    say('配置已导入', 1800)
  } catch (error) {
    say(`导入失败：${error?.message || error}`, 3200)
  }
}

function setActivePanelTab(tab) {
  activePanelTab = PANEL_TABS.has(tab) ? tab : 'settings'
  eventPanel?.setAttribute('data-active-tab', activePanelTab)
  eventPanel?.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === activePanelTab)
  })
  eventPanel?.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tabPanel === activePanelTab)
  })
  if (activePanelTab === 'bridge' && !bridgeTasksState.loaded && !bridgeTasksState.loading) {
    refreshBridgeTasks()
  }
  positionPanel()
}

function togglePanel(force) {
  panelVisible = typeof force === 'boolean' ? force : !panelVisible
  eventPanel?.classList.toggle('hidden', !panelVisible)
  if (panelVisible) {
    window.pet.setIgnoreMouse(false)
    requestAnimationFrame(positionPanel)
  } else {
    window.pet.setIgnoreMouse(true, { forward: true })
  }
  syncEventPanel()
}

function recordAgentEvent(event) {
  if (!event || !event.type) return
  const record = {
    ...event,
    id: String(++eventSeq),
    target: targetForEvent(event),
    receivedAt: new Date().toISOString(),
  }
  eventLog.unshift(record)
  if (eventLog.length > MAX_EVENT_LOG) eventLog.length = MAX_EVENT_LOG
  syncEventPanel()
}

function targetForEvent(event) {
  if (!event) return null
  const url = event.url || event.link || event.deepLink || event.deep_link || ''
  if (url) return { kind: 'url', url, label: '打开链接' }
  const chatId = event.chatId || event.chat_id || ''
  if (chatId) {
    const messageId = event.messageId || event.message_id || ''
    return {
      kind: 'lark',
      chatId,
      messageId,
      label: messageId ? `飞书消息 ${messageId}` : `飞书会话 ${chatId}`,
    }
  }
  const session = sessionRequestForEvent(event)
  if (session) {
    if (session.provider === 'codex') {
      return {
        kind: 'codex-thread',
        threadId: session.sessionId,
        turnId: event.turnId || event.turn_id || event['turn-id'] || '',
        url: `codex://threads/${encodeURIComponent(session.sessionId)}`,
        label: '打开 Codex 会话',
        fallbackPath: session.transcriptPath,
      }
    }
    if (session.provider === 'claude') {
      return {
        kind: 'terminal-session',
        sessionId: session.sessionId,
        tty: event.tty || '',
        cwd: session.cwd,
        label: '打开 Claude Code 终端',
        fallbackPath: session.transcriptPath,
      }
    }
  }
  return null
}

function targetKey(target) {
  if (!target) return ''
  return target.url || target.path || target.threadId || target.sessionId || `${target.chatId || ''}:${target.messageId || ''}`
}

function openableEvents() {
  const seen = new Set()
  const out = []
  for (const event of eventLog) {
    if (!event.target) continue
    const key = targetKey(event.target)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(event)
  }
  return out
}

async function openTarget(target) {
  if (!target) return false
  const result = await window.pet.openTarget?.(target)
  if (!result?.ok) {
    const suffix = result?.copiedUrl ? '，已复制链接' : ''
    say(`跳转失败：${result?.error || '没有会话信息'}${suffix}`, 3200)
    return false
  }
  const text = target.kind === 'local-path'
    ? '正在打开本地记录'
    : target.kind === 'terminal-session'
      ? '正在打开 Agent 终端'
      : target.kind === 'codex-thread'
        ? '正在打开 Codex 会话'
        : '正在打开飞书会话'
  say(text, 1400)
  return true
}

async function shareBubbleSession(id) {
  const item = bubbleLog.find(record => record.id === String(id))
  const request = sessionRequestForEvent(item?.event)
  if (!request) {
    say('这条气泡没有可分享的会话信息', 2400)
    return
  }
  say('正在生成会话分享链接...', 2200)
  try {
    const result = await window.pet.shareSession?.(request)
    if (!result?.ok) {
      say(`分享失败：${result?.error || 'bridge 没返回链接'}`, 4200)
      return
    }
    const url = result.url || result.share?.url
    say('分享链接已生成，已复制', 0, {
      source: 'local',
      type: 'task_done',
      text: url || '分享链接已生成',
      url,
    })
  } catch (error) {
    say(`分享失败：${error?.message || error}`, 4200)
  }
}

function openEventById(id) {
  const event = eventLog.find(item => item.id === String(id))
  if (event?.target) openTarget(event.target)
}

// Optional spoken notification for important events (macOS `say`, off by default).
const TTS_LINES = {
  task_done: '任务完成',
  agent_done: '子任务完成',
  task_failed: '任务失败',
  task_waiting: '需要你确认',
  pomodoro_completed: '番茄钟完成',
  lark_message_received: '飞书有新消息',
}
function speakEvent(event) {
  if (!uiSettings.ttsEnabled || !event) return
  const line = TTS_LINES[event.type]
  if (!line) return
  const src = event.source === 'lark' ? '飞书' : '本地'
  window.pet.speak?.(`${src}，${line}`)
}

// Share a single sub-agent's own conversation (its transcript file → session-share).
async function shareSubagentTranscript(transcript) {
  const transcriptPath = String(transcript || '').trim()
  const sessionId = inferSessionIdFromTranscriptPath(transcriptPath)
  if (!sessionId) {
    say('这个子 Agent 没有可分享的会话文件', 2600)
    return
  }
  say('正在生成子 Agent 分享链接...', 2200)
  try {
    const result = await window.pet.shareSession?.({
      provider: 'claude',
      sessionId,
      transcriptPath,
      bridgeUrl: activeAgentConfig.bridgeUrl || 'http://127.0.0.1:8787',
      token: activeAgentConfig.token || '',
    })
    if (!result?.ok) {
      say(`子 Agent 分享失败：${result?.error || 'bridge 没返回链接'}`, 4200)
      return
    }
    const url = result.url || result.share?.url
    say('子 Agent 分享链接已生成，已复制', 0, { source: 'local', type: 'task_done', text: url || '已生成', url })
  } catch (error) {
    say(`子 Agent 分享失败：${error?.message || error}`, 4200)
  }
}

function openBubbleTarget(event = activeBubbleEvent) {
  const bubbleTarget = targetForEvent(event)
  const sessions = openableEvents()
  const hasOtherSession = bubbleTarget && sessions.some(event => targetKey(event.target) !== targetKey(bubbleTarget))
  if (bubbleTarget && !hasOtherSession) {
    openTarget(bubbleTarget)
    return
  }
  if (sessions.length === 1) {
    openTarget(sessions[0].target)
    return
  }
  if (sessions.length > 1) {
    togglePanel(true)
    return
  }
  togglePanel(true)
}

function syncSettingControls() {
  if (settingPetScale) settingPetScale.value = String(Math.round(uiSettings.petScale * 100))
  if (settingPetScaleValue) settingPetScaleValue.textContent = `${Math.round(uiSettings.petScale * 100)}%`
  if (settingPetOpacity) settingPetOpacity.value = String(Math.round(uiSettings.petOpacity * 100))
  if (settingPetOpacityValue) settingPetOpacityValue.textContent = `${Math.round(uiSettings.petOpacity * 100)}%`
  if (settingHitboxScale) settingHitboxScale.value = String(Math.round(uiSettings.hitboxScale * 100))
  if (settingHitboxScaleValue) settingHitboxScaleValue.textContent = `${Math.round(uiSettings.hitboxScale * 100)}%`
  if (settingBubbleCorner) settingBubbleCorner.value = uiSettings.bubbleCorner
  if (settingPanelCorner) settingPanelCorner.value = uiSettings.panelCorner
  if (settingTriggerMode) {
    settingTriggerMode.querySelectorAll('[data-trigger-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.triggerMode === uiSettings.triggerMode)
    })
  }
  if (settingEdgeMode) {
    settingEdgeMode.querySelectorAll('[data-edge-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.edgeMode === uiSettings.edgeMode)
    })
  }
  if (settingPettingEnabled) {
    settingPettingEnabled.querySelectorAll('[data-petting-enabled]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.pettingEnabled === 'true') === uiSettings.pettingEnabled)
    })
  }
  if (settingWanderEnabled) {
    settingWanderEnabled.querySelectorAll('[data-wander-enabled]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.wanderEnabled === 'true') === uiSettings.wanderEnabled)
    })
  }
  if (settingDndMode) {
    settingDndMode.querySelectorAll('[data-dnd-mode]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.dndMode === 'true') === uiSettings.dndMode)
    })
  }
  if (settingSoundEnabled) {
    settingSoundEnabled.querySelectorAll('[data-sound-enabled]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.soundEnabled === 'true') === uiSettings.soundEnabled)
    })
  }
  if (settingNotificationsEnabled) {
    settingNotificationsEnabled.querySelectorAll('[data-notifications-enabled]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.notificationsEnabled === 'true') === uiSettings.notificationsEnabled)
    })
  }
  if (settingFocusMinutes) settingFocusMinutes.value = String(pomodoroSettings.focusMinutes)
  if (settingShortBreakMinutes) settingShortBreakMinutes.value = String(pomodoroSettings.shortBreakMinutes)
  if (settingLongBreakMinutes) settingLongBreakMinutes.value = String(pomodoroSettings.longBreakMinutes)
  if (settingSedentaryMinutes) settingSedentaryMinutes.value = String(pomodoroSettings.sedentaryMinutes)
  if (settingLongBreakEvery) settingLongBreakEvery.value = String(pomodoroSettings.longBreakEvery)
  if (settingLongBreakEveryValue) settingLongBreakEveryValue.textContent = `${pomodoroSettings.longBreakEvery}轮`
  if (settingBubbleAnchor) settingBubbleAnchor.value = String(Math.round(uiSettings.bubbleAnchor))
  if (settingBubbleAnchorValue) settingBubbleAnchorValue.textContent = `${Math.round(uiSettings.bubbleAnchor)}%`
  if (settingBubbleGap) settingBubbleGap.value = String(Math.round(uiSettings.bubbleGap))
  if (settingBubbleGapValue) settingBubbleGapValue.textContent = `${Math.round(uiSettings.bubbleGap)}px`
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function typeLabel(type) {
  return {
    lark_message_received: '飞书消息',
    task_started: '开工',
    task_progress: '进度',
    lark_reply_sent: '飞书回复',
    task_waiting: '待交互',
    agent_done: 'Agent 完成',
    task_done: '完成',
    task_failed: '失败',
    pomodoro_completed: '番茄钟',
  }[type] || type
}

function sourceLabel(source) {
  const src = PET_CONFIG.sources[source] || PET_CONFIG.sources.lark
  return `${src.icon} ${src.label}`
}

function isWaiting(event) {
  return event.type === 'task_waiting'
}

function isDone(event) {
  return event.type === 'task_done' || event.type === 'agent_done'
}

function eventText(event) {
  return event.text || event.agent || typeLabel(event.type)
}

function fmtTime(value) {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function renderEventList(el, list) {
  if (!el) return
  if (!list.length) {
    el.className = 'event-list empty'
    el.textContent = '暂无'
    return
  }
  el.className = 'event-list'
  el.innerHTML = list.map((event) => {
    const cls = [
      isWaiting(event) ? 'waiting' : '',
      isDone(event) ? 'done' : '',
      event.source === 'lark' ? 'source-lark' : event.source === 'local' ? 'source-local' : '',
    ].filter(Boolean).map(item => ` ${item}`).join('')
    const agent = event.agent ? ` · ${escapeHtml(event.agent)}` : ''
    const target = event.target ? `<div class="event-target">${escapeHtml(event.target.label || '打开会话')}</div>` : ''
    return [
      `<article class="event-item${cls}" data-event-id="${escapeHtml(event.id || '')}">`,
      '<div class="event-meta">',
      `<span>${escapeHtml(sourceLabel(event.source))} · ${escapeHtml(typeLabel(event.type))}${agent}</span>`,
      `<time>${escapeHtml(fmtTime(event.receivedAt))}</time>`,
      '</div>',
      `<div class="event-text">${escapeHtml(eventText(event))}</div>`,
      target,
      '</article>',
    ].join('')
  }).join('')
}

function renderSessionList(el, list) {
  if (!el) return
  if (!list.length) {
    el.className = 'event-list empty'
    el.textContent = '暂无可跳转会话'
    return
  }
  el.className = 'event-list sessions'
  el.innerHTML = list.map((event) => {
    const subs = subagentsForSession(event)
    const parent = [
      `<article class="event-item" data-event-id="${escapeHtml(event.id || '')}">`,
      '<div class="event-meta">',
      `<span>${escapeHtml(sourceLabel(event.source))} · ${escapeHtml(typeLabel(event.type))}${subs.length ? ` · ${subs.length} 子 Agent` : ''}</span>`,
      `<time>${escapeHtml(fmtTime(event.receivedAt))}</time>`,
      '</div>',
      `<div class="event-text">${escapeHtml(eventText(event))}</div>`,
      `<div class="event-target">${escapeHtml(event.target?.label || '打开会话')}</div>`,
      '</article>',
    ].join('')
    // Sub-agents run inside the parent session's terminal, so clicking jumps to
    // the same parent terminal; the value here is showing them separately with a
    // clear parent→child hierarchy.
    const children = subs.map((sub) => [
      `<article class="event-item event-subagent" data-event-id="${escapeHtml(event.id || '')}" title="子 Agent 运行在父会话终端内">`,
      `<div class="event-subagent-name">↳ 子 Agent · ${escapeHtml(sub.name)}`,
      sub.transcript ? `<button type="button" class="subagent-share" data-share-subagent="${escapeHtml(sub.transcript)}">分享</button>` : '',
      '</div>',
      `<div class="event-text">${escapeHtml(eventText(sub.last))}</div>`,
      '</article>',
    ].join('')).join('')
    return parent + children
  }).join('')
}

// Collect the sub-agents (SubagentStart/Stop carry agent_transcript_path + the
// parent session_id) belonging to a parent session, deduped by transcript.
function subagentsForSession(sessionEvent) {
  const parentId = sessionEvent?.sessionId || sessionEvent?.session_id || ''
  if (!parentId) return []
  const seen = new Set()
  const subs = []
  for (const ev of eventLog) {
    const transcript = ev.agentTranscriptPath || ev.agent_transcript_path || ''
    const pid = ev.sessionId || ev.session_id || ''
    if (!transcript || pid !== parentId || seen.has(transcript)) continue
    seen.add(transcript)
    subs.push({ transcript, name: ev.agent || ev.agentId || ev.agent_id || '子 Agent', last: ev })
  }
  return subs
}

function renderConfig() {
  if (!configEvents) return
  const notif = typeof Notification === 'undefined' ? '不可用' : Notification.permission
  const tokenText = activeAgentConfig.token ? '已配置' : '未配置'
  configEvents.innerHTML = [
    ['Bridge', activeAgentConfig.bridgeUrl || 'http://127.0.0.1:8787'],
    ['SSE', agentSyncStatus === 'connected' ? '已连接' : '离线/重连中'],
    ['Hook', '127.0.0.1:7766'],
    ['Token', tokenText],
    ['勿扰', uiSettings.dndMode ? '开启' : '关闭'],
    ['声音', uiSettings.soundEnabled ? '开启' : '关闭'],
    ['系统通知', uiSettings.notificationsEnabled ? '开启' : '关闭'],
    ['通知权限', notif],
    ['番茄钟', `${pomodoroSettings.focusMinutes}/${pomodoroSettings.shortBreakMinutes}/${pomodoroSettings.longBreakMinutes} min`],
    ['久坐提醒', pomodoroSettings.sedentaryMinutes > 0 ? `${pomodoroSettings.sedentaryMinutes} min` : '关闭'],
  ].map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')
}

function bridgeTaskStatusLabel(status) {
  return {
    running: '运行中',
    waiting: '待交互',
    done: '完成',
    failed: '失败',
    canceled: '取消',
  }[status] || status || '未知'
}

function bridgeTaskMeta(task) {
  const parts = [
    bridgeTaskStatusLabel(task.status),
    task.backend || '',
    task.runtime || '',
    task.tokens ? `${task.tokens} tok` : '',
    task.eventCount ? `${task.eventCount} 事件` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function bridgeTaskTime(task) {
  return fmtTime(task.updatedAt || task.finishedAt || task.startedAt)
}

function renderBridgeTasks() {
  if (!bridgeTasksSummary || !bridgeTasksList) return
  if (bridgeTasksState.loading) {
    bridgeTasksSummary.textContent = '正在读取 Bridge 任务...'
  } else if (bridgeTasksState.error) {
    bridgeTasksSummary.textContent = `读取失败：${bridgeTasksState.error}`
  } else {
    const tasks = bridgeTasksState.tasks || []
    const running = tasks.filter(task => task.status === 'running').length
    const waiting = tasks.filter(task => task.status === 'waiting').length
    const done = tasks.filter(task => task.status === 'done').length
    const failed = tasks.filter(task => task.status === 'failed').length
    const updated = bridgeTasksState.updatedAt ? fmtTime(bridgeTasksState.updatedAt) : ''
    bridgeTasksSummary.textContent = `共 ${tasks.length} 个任务 · 运行 ${running} · 待交互 ${waiting} · 完成 ${done} · 失败 ${failed}${updated ? ` · ${updated}` : ''}`
  }

  const tasks = (bridgeTasksState.tasks || []).slice(0, 5)
  if (!tasks.length) {
    bridgeTasksList.className = 'event-list empty'
    bridgeTasksList.textContent = bridgeTasksState.loaded ? '暂无 Bridge 任务' : '尚未加载'
    return
  }
  bridgeTasksList.className = 'event-list'
  bridgeTasksList.innerHTML = tasks.map(task => [
    `<article class="event-item${task.status === 'failed' ? ' waiting' : task.status === 'done' ? ' done' : ''}" data-bridge-task-id="${escapeHtml(task.id || '')}">`,
    '<div class="event-meta">',
    `<span>${escapeHtml(task.source || 'bridge')} · ${escapeHtml(bridgeTaskStatusLabel(task.status))}</span>`,
    `<time>${escapeHtml(bridgeTaskTime(task))}</time>`,
    '</div>',
    '<div class="bridge-task-mini">',
    `<strong>${escapeHtml(shortText(task.title || task.prompt || task.id, 56))}</strong>`,
    `<span>${escapeHtml(bridgeTaskMeta(task))}</span>`,
    '</div>',
    '</article>',
  ].join('')).join('')
}

async function refreshBridgeTasks({ force = false } = {}) {
  if (!force && bridgeTasksState.loading) return
  bridgeTasksState = { ...bridgeTasksState, loading: true, error: '' }
  renderBridgeTasks()
  try {
    const result = await window.pet.bridgeTasks?.({
      bridgeUrl: activeAgentConfig.bridgeUrl || 'http://127.0.0.1:8787',
      token: activeAgentConfig.token || '',
      limit: 50,
    })
    if (!result?.ok) {
      bridgeTasksState = {
        loading: false,
        loaded: true,
        error: result?.error || 'Bridge 任务页不可用',
        tasks: [],
        updatedAt: new Date().toISOString(),
      }
    } else {
      bridgeTasksState = {
        loading: false,
        loaded: true,
        error: '',
        tasks: Array.isArray(result.tasks) ? result.tasks : [],
        updatedAt: result.updatedAt || new Date().toISOString(),
      }
    }
  } catch (error) {
    bridgeTasksState = {
      loading: false,
      loaded: true,
      error: error?.message || String(error),
      tasks: [],
      updatedAt: new Date().toISOString(),
    }
  }
  renderBridgeTasks()
}

async function openBridgeTasksWindow() {
  const result = await window.pet.openBridgeTasksWindow?.()
  if (!result?.ok) say(`打开任务详情失败：${result?.error || '未知错误'}`, 2600)
}

async function shareBridgeTaskViewer() {
  say('正在生成 Bridge 全部任务分享页...', 2200)
  try {
    const result = await window.pet.shareBridgeTasks?.({
      bridgeUrl: activeAgentConfig.bridgeUrl || 'http://127.0.0.1:8787',
      token: activeAgentConfig.token || '',
      limit: 100,
    })
    if (!result?.ok) {
      say(`分享失败：${result?.error || 'bridge 没返回链接'}`, 4200)
      return
    }
    say('Bridge 任务分享链接已复制', 0, {
      source: 'local',
      type: 'task_done',
      text: result.url || 'Bridge 任务分享链接已复制',
      url: result.url || '',
    })
  } catch (error) {
    say(`分享失败：${error?.message || error}`, 4200)
  }
}

function syncEventPanel() {
  const waiting = eventLog.filter(isWaiting)
  const done = eventLog.filter(isDone)
  if (metricWaiting) metricWaiting.textContent = String(waiting.length)
  if (metricDone) metricDone.textContent = String(done.length)
  if (metricTotal) metricTotal.textContent = String(eventLog.length)
  if (panelStatus) {
    const statusText = agentSyncStatus === 'connected' ? 'Bridge 已连接' : 'Bridge 离线/重连中'
    panelStatus.textContent = `${statusText} · Hook 127.0.0.1:7766`
  }
  renderEventList(waitingEvents, waiting.slice(0, 6))
  renderEventList(doneEvents, done.slice(0, 8))
  renderSessionList(sessionEvents, openableEvents().slice(0, 8))
  renderEventList(recentEvents, eventLog.slice(0, 8))
  renderConfig()
  renderBridgeTasks()
  syncSettingControls()
  setActivePanelTab(activePanelTab)
  positionPanel()
}

window.addEventListener('resize', () => {
  positionBubble()
  positionPanel()
})
