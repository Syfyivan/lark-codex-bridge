// P4 养成系统：agent 事件 + token 用量喂食 → 攒饱食(food)/经验(exp) → 升级(level)。
// 状态持久化在主进程(userData/kodama-state.json)，经 preload 的 getState/saveState。
import { ACCESSORIES, ACCESSORY_SLOTS } from './config/accessories.js'

// 每类事件喂多少：{ food, exp }
const GAINS = {
  lark_message_received: { food: 0, exp: 1 },
  task_started: { food: 0, exp: 1 },
  task_progress: { food: 1, exp: 1 },
  lark_reply_sent: { food: 1, exp: 2 },
  agent_done: { food: 3, exp: 5 },
  task_done: { food: 5, exp: 8 },
  task_waiting: { food: 0, exp: 0 },
  task_failed: { food: 1, exp: 2 },
  pomodoro_completed: { food: 20, exp: 50 }, // 预留给番茄钟
}

const TOKENS_PER_FOOD = 2000 // 每 2000 token 喂 1 点饱食

// 从 level 升到 level+1 所需经验
function expForLevel(level) {
  return 20 + (level - 1) * 15
}

let activeAccessories = ACCESSORIES
let accessoryById = new Map(activeAccessories.map((a) => [a.id, a]))
let slotIds = new Set(ACCESSORY_SLOTS.map((s) => s.id))

function defaultState() {
  return {
    level: 1,
    exp: 0,
    food: 0,
    totalFed: 0,
    lastTokens: null,
    unlockedAccessories: [],
    equippedAccessories: {},
  }
}

let state = defaultState()
let hooks = {}

export function configureAccessories({ accessories, slots } = {}) {
  if (Array.isArray(accessories) && accessories.length) {
    activeAccessories = accessories
    accessoryById = new Map(activeAccessories.map((a) => [a.id, a]))
  }
  if (Array.isArray(slots) && slots.length) {
    slotIds = new Set(slots.map((s) => s.id))
  }
  if (hooks.onChange) {
    state = normalizeState(state)
    persist()
  }
}

export async function initGrowth(h) {
  hooks = h || {}
  try {
    const saved = await window.pet.getState?.()
    state = normalizeState(saved)
  } catch {
    state = normalizeState(null)
  }
  persist()
}

function persist() {
  window.pet?.saveState?.(getState())
  hooks.onChange?.(getState())
}

function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeState(saved) {
  const raw = saved && typeof saved === 'object' ? saved : {}
  const next = { ...defaultState(), ...raw }
  next.level = Math.max(1, Math.floor(numberOr(next.level, 1)))
  next.exp = Math.max(0, Math.floor(numberOr(next.exp, 0)))
  next.food = Math.max(0, Math.floor(numberOr(next.food, 0)))
  next.totalFed = Math.max(0, Math.floor(numberOr(next.totalFed, 0)))
  next.lastTokens = next.lastTokens == null ? null : Math.max(0, numberOr(next.lastTokens, 0))

  const unlocked = new Set(Array.isArray(raw.unlockedAccessories) ? raw.unlockedAccessories : [])
  for (const acc of activeAccessories) {
    if (next.level >= acc.unlockLevel) unlocked.add(acc.id)
  }
  next.unlockedAccessories = activeAccessories.filter((acc) => unlocked.has(acc.id)).map((acc) => acc.id)

  const equipped = {}
  const rawEquipped = raw.equippedAccessories && typeof raw.equippedAccessories === 'object' ? raw.equippedAccessories : {}
  for (const [slot, id] of Object.entries(rawEquipped)) {
    const acc = accessoryById.get(id)
    if (slotIds.has(slot) && acc?.slot === slot && next.unlockedAccessories.includes(id)) equipped[slot] = id
  }
  next.equippedAccessories = equipped
  return next
}

function unlockForLevel() {
  const unlocked = new Set(state.unlockedAccessories)
  const newly = []
  for (const acc of activeAccessories) {
    if (state.level >= acc.unlockLevel && !unlocked.has(acc.id)) {
      unlocked.add(acc.id)
      newly.push(acc)
    }
  }
  state.unlockedAccessories = activeAccessories.filter((acc) => unlocked.has(acc.id)).map((acc) => acc.id)
  return newly
}

// Add food/exp, handle level-ups, persist. Returns true if leveled up.
function applyGains(food, exp) {
  state.food += food
  state.totalFed += food
  state.exp += exp
  let leveled = false
  while (state.exp >= expForLevel(state.level)) {
    state.exp -= expForLevel(state.level)
    state.level += 1
    leveled = true
  }
  const newlyUnlocked = unlockForLevel()
  persist()
  if (leveled) {
    hooks.playMotion?.('Tap')
    const unlockText = newlyUnlocked.length ? ` · 解锁 ${newlyUnlocked.map((a) => a.label).join('、')}` : ''
    hooks.say?.(`✨ 升级啦！现在 Lv.${state.level}${unlockText} ✨`, 5000)
  }
  return leveled
}

export function feed(type) {
  const g = GAINS[type]
  if (!g) return
  applyGains(g.food, g.exp)
}

// 主动投喂:消耗食物换经验(食物自动从使用累积,投喂是把它"花"成成长)。
const FEED_COST = 200 // 每次投喂消耗的食物(不足则全投)
const FEED_EXP_RATE = 0.5 // 食物→经验的转化率
export function feedManually() {
  const cost = Math.min(state.food, FEED_COST)
  if (cost <= 0) {
    hooks.say?.('还没有食物呢，跑跑任务攒点 🍖', 2600)
    return { ok: false, reason: 'no-food' }
  }
  state.food -= cost
  const expGain = Math.max(1, Math.round(cost * FEED_EXP_RATE))
  hooks.playMotion?.('Tap')
  hooks.say?.(`投喂 -${cost}🍖 → +${expGain}⭐ 😋`, 2600)
  applyGains(0, expGain) // 加经验 + 处理升级 + 持久化
  return { ok: true, cost, expGain, level: state.level }
}

// 等级影响显示大小:幼崽小 → 成年大,温和封顶(31 级到顶 1.0,不打扰已满级桌宠)。
export function growthScale() {
  return Math.min(1, 0.7 + (state.level - 1) * 0.01)
}

// Feed the pet from cumulative token usage. First call only sets a baseline
// (so pre-existing usage doesn't dump a huge level-up); afterwards each refresh
// feeds the delta of newly-used tokens.
export function feedTokens(totalTokens) {
  if (typeof totalTokens !== 'number' || totalTokens < 0) return
  if (state.lastTokens == null) {
    state.lastTokens = totalTokens
    persist()
    return
  }
  const delta = totalTokens - state.lastTokens
  if (delta <= 0) return
  state.lastTokens = totalTokens
  const food = Math.floor(delta / TOKENS_PER_FOOD)
  if (food <= 0) {
    persist()
    return
  }
  applyGains(food, food * 2)
}

export function statusText() {
  return `Lv.${state.level} · 🍖${state.food} · ⭐${state.exp}/${expForLevel(state.level)}`
}

export function getState() {
  return {
    ...state,
    unlockedAccessories: [...state.unlockedAccessories],
    equippedAccessories: { ...state.equippedAccessories },
  }
}

export function equipAccessory(request) {
  const id = typeof request === 'object' ? request?.id : request
  const requestedSlot = typeof request === 'object' ? request?.slot : null

  if (!id || id === 'none') return unequipAccessory(requestedSlot)

  const acc = accessoryById.get(id)
  if (!acc) return { ok: false, reason: '未知配饰' }
  if (!state.unlockedAccessories.includes(acc.id)) {
    return { ok: false, reason: `${acc.label} 需要 Lv.${acc.unlockLevel}` }
  }

  state.equippedAccessories = { ...state.equippedAccessories, [acc.slot]: acc.id }
  persist()
  return { ok: true, action: 'equip', accessory: publicAccessory(acc), state: getState() }
}

export function unequipAccessory(slot) {
  if (!slotIds.has(slot)) return { ok: false, reason: '未知配饰槽位' }
  const next = { ...state.equippedAccessories }
  delete next[slot]
  state.equippedAccessories = next
  persist()
  return { ok: true, action: 'unequip', slot, state: getState() }
}

function publicAccessory(acc) {
  return { id: acc.id, slot: acc.slot, label: acc.label, unlockLevel: acc.unlockLevel }
}
