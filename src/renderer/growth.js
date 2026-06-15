// P4 养成系统：agent 事件 + token 用量喂食 → 攒饱食(food)/经验(exp) → 升级(level)。
// 状态持久化在主进程(userData/kodama-state.json)，经 preload 的 getState/saveState。

// 每类事件喂多少：{ food, exp }
const GAINS = {
  lark_message_received: { food: 0, exp: 1 },
  task_started: { food: 0, exp: 1 },
  task_progress: { food: 1, exp: 1 },
  lark_reply_sent: { food: 1, exp: 2 },
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

let state = { level: 1, exp: 0, food: 0, totalFed: 0, lastTokens: null }
let hooks = {}

export async function initGrowth(h) {
  hooks = h || {}
  try {
    const saved = await window.pet.getState?.()
    if (saved && typeof saved.level === 'number') state = { ...state, ...saved }
  } catch {
    /* keep defaults */
  }
}

function persist() {
  window.pet?.saveState?.({ ...state })
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
  persist()
  if (leveled) {
    hooks.playMotion?.('Tap')
    hooks.say?.(`✨ 升级啦！现在 Lv.${state.level} ✨`, 5000)
  }
  return leveled
}

export function feed(type) {
  const g = GAINS[type]
  if (!g) return
  applyGains(g.food, g.exp)
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
  return { ...state }
}
