// Pomodoro state machine (main process). Pure logic + callbacks; the caller
// drives time via tick() (one call per second) so it's easy to test.
//
// Phases: idle | focus | short_break | long_break.  Pause is a flag, not a phase
// (avoids state explosion). Long break every `longEvery` focuses (modulo).
// Completing a focus calls onReward(); abandoning gives NO reward (loss-aversion,
// not punishment — matches the pet's gentle tone).
function createPomodoro(opts = {}) {
  const focus = opts.focus ?? 25 * 60
  const short = opts.short ?? 5 * 60
  const long = opts.long ?? 15 * 60
  const longEvery = opts.longEvery ?? 4
  const { onNotify, onReward, onTick } = opts

  let phase = 'idle'
  let paused = false
  let remaining = 0
  let completed = 0

  const emitTick = () => onTick?.({ phase, paused, remaining, completed })

  function enter(next) {
    phase = next
    if (next === 'focus') {
      remaining = focus
      onNotify?.({ text: '🍅 专注开始，加油！', status: 'working' })
    } else if (next === 'short_break') {
      remaining = short
      onNotify?.({ text: '☕ 短休一下~', status: 'replying', motion: 'Tap' })
    } else if (next === 'long_break') {
      remaining = long
      onNotify?.({ text: '🛋️ 长休息，放松一下', status: 'replying', motion: 'Tap' })
    } else {
      remaining = 0
      onNotify?.({ text: '番茄钟结束 🍅', status: 'idle' })
    }
    emitTick()
  }

  function advance() {
    if (phase === 'focus') {
      completed += 1
      onReward?.() // pomodoro_completed -> feeds the pet
      enter(completed % longEvery === 0 ? 'long_break' : 'short_break')
    } else if (phase === 'short_break') {
      enter('focus')
    } else {
      enter('idle') // long break done -> session over
    }
  }

  return {
    start() {
      if (phase === 'idle') {
        paused = false
        enter('focus')
      }
    },
    pauseResume() {
      if (phase === 'idle') return
      paused = !paused
      onNotify?.({ text: paused ? '⏸ 已暂停' : '▶ 继续', status: paused ? 'idle' : 'working' })
      emitTick()
    },
    abandon() {
      if (phase === 'idle') return
      const wasFocus = phase === 'focus'
      phase = 'idle'
      paused = false
      remaining = 0
      onNotify?.(
        wasFocus
          ? { text: '又分心啦…下次加油 😔', status: 'failed' } // no reward
          : { text: '番茄钟结束', status: 'idle' },
      )
      emitTick()
    },
    tick() {
      if (paused || phase === 'idle') return
      remaining -= 1
      emitTick()
      if (remaining <= 0) advance()
    },
    state() {
      return { phase, paused, remaining, completed }
    },
  }
}

module.exports = { createPomodoro }
