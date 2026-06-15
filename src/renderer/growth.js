// P4 养成系统：agent 事件喂食 → 攒饱食(food)/经验(exp) → 升级(level)。
// 状态持久化在主进程(userData/kodama-state.json)，经 preload 的 getState/saveState。
// 后续可在升级时解锁皮肤/动作表演、接入真实 token 用量喂食、番茄钟喂食。

// 每类事件喂多少：{ food, exp }
const GAINS = {
  lark_message_received: { food: 0, exp: 1 },
  task_started: { food: 0, exp: 1 },
  task_progress: { food: 1, exp: 1 },
  lark_reply_sent: { food: 1, exp: 2 },
  task_done: { food: 5, exp: 8 },
  task_waiting: { food: 0, exp: 0 },
  task_failed: { food: 1, exp: 2 },
}

// 从 level 升到 level+1 所需经验
function expForLevel(level) {
  return 20 + (level - 1) * 15
}

let state = { level: 1, exp: 0, food: 0, totalFed: 0 }
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

export function feed(type) {
  const g = GAINS[type]
  if (!g) return
  state.food += g.food
  state.totalFed += g.food
  state.exp += g.exp

  let leveled = false
  while (state.exp >= expForLevel(state.level)) {
    state.exp -= expForLevel(state.level)
    state.level += 1
    leveled = true
  }

  window.pet?.saveState?.({ ...state })

  if (leveled) {
    hooks.playMotion?.('Tap')
    hooks.say?.(`✨ 升级啦！现在 Lv.${state.level} ✨`, 5000)
  }
}

export function statusText() {
  return `Lv.${state.level} · 🍖${state.food} · ⭐${state.exp}/${expForLevel(state.level)}`
}

export function getState() {
  return { ...state }
}
