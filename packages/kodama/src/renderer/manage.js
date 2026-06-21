/* Kodama 管理中心 —— 独立窗口。通过 window.pet 的 IPC 与桌宠/主进程同步。 */

const $ = (id) => document.getElementById(id)
const setStatus = (t) => { const el = $('status'); if (el) el.textContent = t }

// patch a single ui setting → main → pet renderer (applies + saves + reports back)
function patch(key, value) {
  window.pet.patchUiSettings?.({ [key]: value })
  setStatus(`已更新 ${key}`)
}

// ---- sliders (value shown as %/px) ----
const SLIDERS = [
  { id: 'petScale', toModel: (v) => v / 100, fmt: (v) => `${v}%` },
  { id: 'petOpacity', toModel: (v) => v / 100, fmt: (v) => `${v}%` },
  { id: 'hitboxScale', toModel: (v) => v / 100, fmt: (v) => `${v}%` },
  { id: 'bubbleAnchor', toModel: (v) => v, fmt: (v) => `${v}%` },
  { id: 'bubbleGap', toModel: (v) => v, fmt: (v) => `${v}px` },
]

function bindSliders() {
  for (const s of SLIDERS) {
    const el = $(s.id)
    const out = $(`${s.id}V`)
    if (!el) continue
    el.addEventListener('input', () => { if (out) out.textContent = s.fmt(Number(el.value)) })
    el.addEventListener('change', () => patch(s.id, s.toModel(Number(el.value))))
  }
}

// ---- segmented toggles (triggerMode / edgeMode) ----
function bindSegments() {
  for (const groupId of ['triggerMode', 'edgeMode']) {
    const group = $(groupId)
    if (!group) continue
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]')
      if (!btn) return
      ;[...group.children].forEach((b) => b.classList.toggle('active', b === btn))
      patch(groupId, btn.dataset.v)
    })
  }
}

// ---- switches ----
const SWITCHES = ['pettingEnabled', 'wanderEnabled', 'dndMode', 'soundEnabled', 'notificationsEnabled', 'ttsEnabled']
function bindSwitches() {
  for (const id of SWITCHES) {
    const el = $(id)
    if (!el) continue
    el.addEventListener('click', () => {
      const next = !el.classList.contains('on')
      el.classList.toggle('on', next)
      patch(id, next)
    })
  }
}

// ---- pomodoro (owned by main) ----
const POMO = ['focusMinutes', 'shortBreakMinutes', 'longBreakMinutes', 'longBreakEvery', 'sedentaryMinutes']
function bindPomodoro() {
  for (const id of POMO) {
    const el = $(id)
    if (!el) continue
    el.addEventListener('change', () => {
      const settings = {}
      for (const k of POMO) settings[k] = Number($(k)?.value)
      window.pet.updatePomodoroSettings?.(settings)
      setStatus('番茄钟设置已更新')
    })
  }
}

// ---- apply current state into the controls ----
function fillUi(ui) {
  if (!ui) return
  const pct = (v) => Math.round(Number(v) * 100)
  const setSlider = (id, value, out) => { const el = $(id); if (el) { el.value = String(value); const o = $(`${id}V`); if (o) o.textContent = out } }
  setSlider('petScale', pct(ui.petScale), `${pct(ui.petScale)}%`)
  setSlider('petOpacity', pct(ui.petOpacity), `${pct(ui.petOpacity)}%`)
  setSlider('hitboxScale', pct(ui.hitboxScale), `${pct(ui.hitboxScale)}%`)
  setSlider('bubbleAnchor', Math.round(ui.bubbleAnchor), `${Math.round(ui.bubbleAnchor)}%`)
  setSlider('bubbleGap', Math.round(ui.bubbleGap), `${Math.round(ui.bubbleGap)}px`)
  for (const groupId of ['triggerMode', 'edgeMode']) {
    const group = $(groupId)
    if (group) [...group.children].forEach((b) => b.classList.toggle('active', b.dataset.v === ui[groupId]))
  }
  for (const id of SWITCHES) { const el = $(id); if (el) el.classList.toggle('on', ui[id] !== false && ui[id] !== undefined ? Boolean(ui[id]) : false) }
}

function fillPomodoro(p) {
  if (!p) return
  for (const k of POMO) { const el = $(k); if (el && Number.isFinite(p[k])) el.value = String(p[k]) }
}

function fmtTok(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(v)
}

async function refreshStats() {
  try {
    const state = await window.pet.getState?.()
    if (state) {
      $('statLevel').textContent = state.level ?? '–'
      $('statFood').textContent = state.food ?? '–'
      $('statExp').textContent = state.exp ?? '–'
    }
  } catch { /* ignore */ }
  try {
    const tok = await window.pet.tokenStats?.()
    if (tok) {
      $('tokToday').textContent = fmtTok(tok.today)
      $('tok7').textContent = fmtTok(tok.last7)
      $('tokTotal').textContent = fmtTok(tok.total)
      if (tok.local || tok.lark) {
        $('tokSplit').textContent = `本地 今日 ${fmtTok(tok.local?.today)} · 飞书 今日 ${fmtTok(tok.lark?.today)}`
      }
    }
  } catch { /* ignore */ }
}

async function init() {
  bindSliders()
  bindSegments()
  bindSwitches()
  bindPomodoro()

  // ui-settings come from the pet renderer via the main cache; it may not be set
  // the instant we open, so retry briefly.
  let ui = null
  for (let i = 0; i < 20 && !ui; i++) {
    ui = await window.pet.getUiSettings?.()
    if (!ui) await new Promise((r) => setTimeout(r, 150))
  }
  fillUi(ui)
  fillPomodoro(await window.pet.getPomodoroSettings?.())
  refreshStats()
  setInterval(refreshStats, 5000)
  setStatus(ui ? '已连接桌宠' : '桌宠未运行（设置仍会在桌宠下次启动后生效）')
}

init()
