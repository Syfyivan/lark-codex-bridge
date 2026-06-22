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

// ---- evolution 图鉴 ----
// Shows the pet's level-based stages with the current one highlighted. Only the
// gif backend with `stages` reports this; Live2D / stage-less configs hide it.
let lastEvoKey = ''
async function refreshEvolution() {
  let evo = null
  try { evo = await window.pet.getEvolution?.() } catch { /* ignore */ }
  const card = $('evoCard')
  const grid = $('evoGrid')
  if (!card || !grid) return
  if (!evo || !Array.isArray(evo.stages) || !evo.stages.length) {
    card.style.display = 'none'
    lastEvoKey = ''
    return
  }
  card.style.display = ''
  const level = Number(evo.level) || 1
  let curIdx = 0
  evo.stages.forEach((s, i) => { if (level >= (Number(s.minLevel) || 1)) curIdx = i })

  const key = JSON.stringify({ set: evo.set, level, n: evo.stages.length })
  if (key === lastEvoKey) return
  lastEvoKey = key

  grid.innerHTML = ''
  evo.stages.forEach((s, i) => {
    const locked = level < (Number(s.minLevel) || 1)
    const cell = document.createElement('div')
    cell.className = `evo-item${i === curIdx ? ' current' : ''}${locked ? ' locked' : ''}`
    const img = document.createElement('img')
    img.className = 'evo-img'
    // manage.html lives in src/renderer/, same as pets/ — so the path is `pets/…`
    // (not `../pets/`, which would escape to src/pets/ and 404).
    img.src = `pets/${evo.set}/${s.file}`
    img.alt = s.label || ''
    cell.appendChild(img)
    const label = document.createElement('div')
    label.className = 'evo-label'
    label.textContent = s.label || `阶段${i + 1}`
    cell.appendChild(label)
    const lv = document.createElement('div')
    lv.className = 'evo-lv'
    lv.textContent = `Lv.${s.minLevel}`
    cell.appendChild(lv)
    grid.appendChild(cell)
  })
  const cur = evo.stages[curIdx]
  $('evoNote').textContent = `当前 Lv.${level} · ${cur?.label || ''}`
}

// ---- accessory shop ----
// Catalog is the same payload the pet renderer pushes to the tray (cached in main).
// We render a grid: locked → 「解锁 N⭐」(disabled if exp<cost), unlocked → 佩戴/卸下.
let lastShopKey = ''
async function refreshShop() {
  let cat = null
  try { cat = await window.pet.getAccessoryCatalog?.() } catch { /* ignore */ }
  const grid = $('shopGrid')
  if (!grid) return
  if (!cat || !Array.isArray(cat.accessories)) {
    if (lastShopKey !== 'empty') { grid.innerHTML = '<p class="muted">桌宠未运行,启动后显示配饰商店。</p>'; lastShopKey = 'empty' }
    return
  }
  const exp = Number(cat.exp) || 0
  if ($('shopExp')) $('shopExp').textContent = String(exp)
  // 只展示商店件(带 cost 的 emoji 配饰);等级解锁件留给托盘菜单。
  const items = cat.accessories.filter((a) => a.cost && a.icon)
  const unlocked = new Set(Array.isArray(cat.unlocked) ? cat.unlocked : [])
  const equipped = cat.equipped && typeof cat.equipped === 'object' ? cat.equipped : {}

  // Skip re-render when nothing changed (avoids clobbering hover/focus on poll).
  const key = JSON.stringify({ exp, u: [...unlocked].sort(), e: equipped, n: items.length })
  if (key === lastShopKey) return
  lastShopKey = key

  grid.innerHTML = ''
  for (const acc of items) {
    const isUnlocked = unlocked.has(acc.id)
    const isEquipped = equipped[acc.slot] === acc.id
    const cell = document.createElement('div')
    cell.className = `shop-item${isEquipped ? ' equipped' : ''}`

    const emoji = document.createElement('div')
    emoji.className = `shop-emoji${isUnlocked ? '' : ' locked'}`
    emoji.textContent = acc.icon
    cell.appendChild(emoji)

    const name = document.createElement('div')
    name.className = 'shop-name'
    name.textContent = acc.label
    cell.appendChild(name)

    const btn = document.createElement('button')
    if (!isUnlocked) {
      btn.className = 'shop-btn'
      btn.textContent = `解锁 ${acc.cost}⭐`
      btn.disabled = exp < acc.cost
      btn.title = btn.disabled ? `经验不足(${exp}/${acc.cost})` : ''
      btn.addEventListener('click', () => {
        window.pet.unlockAccessoryCmd?.({ id: acc.id })
        setStatus(`购买 ${acc.label}…`)
        setTimeout(() => { lastShopKey = ''; refreshShop(); refreshStats() }, 400)
      })
    } else if (isEquipped) {
      btn.className = 'shop-btn off'
      btn.textContent = '卸下'
      btn.addEventListener('click', () => {
        window.pet.equipAccessoryCmd?.({ slot: acc.slot, id: null })
        setStatus(`卸下 ${acc.label}`)
        setTimeout(() => { lastShopKey = ''; refreshShop() }, 400)
      })
    } else {
      btn.className = 'shop-btn ghost'
      btn.textContent = '佩戴'
      btn.addEventListener('click', () => {
        window.pet.equipAccessoryCmd?.({ slot: acc.slot, id: acc.id })
        setStatus(`佩戴 ${acc.label}`)
        setTimeout(() => { lastShopKey = ''; refreshShop() }, 400)
      })
    }
    cell.appendChild(btn)
    grid.appendChild(cell)
  }
}

async function init() {
  bindSliders()
  bindSegments()
  bindSwitches()
  bindPomodoro()
  $('petAction')?.addEventListener('click', () => { window.pet.petAction?.(); setStatus('摸了摸桌宠~') })
  $('feedPet')?.addEventListener('click', () => { window.pet.feedPet?.(); setStatus('投喂了桌宠~'); setTimeout(refreshStats, 600) })

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
  refreshShop()
  refreshEvolution()
  setInterval(() => { refreshStats(); refreshShop(); refreshEvolution() }, 5000)
  setStatus(ui ? '已连接桌宠' : '桌宠未运行（设置仍会在桌宠下次启动后生效）')
}

init()
