// Pomodoro state machine (main process). Pure logic + callbacks; the caller
// drives time via tick() (one call per second) so it's easy to test.
//
// Phases: idle | focus | short_break | long_break.  Pause is a flag, not a phase
// (avoids state explosion). Long break every `longEvery` focuses (modulo).
// Completing a focus calls onReward(); abandoning gives NO reward (loss-aversion,
// not punishment — matches the pet's gentle tone).
function createPomodoro(opts = {}) {
  const { onNotify, onReward, onTick } = opts
  const durations = {
    focus: positiveInt(opts.focus, 25 * 60),
    short: positiveInt(opts.short, 5 * 60),
    long: positiveInt(opts.long, 15 * 60),
    longEvery: positiveInt(opts.longEvery, 4),
  }

  let phase = 'idle'
  let paused = false
  let remaining = 0
  let completed = 0

  const emitTick = () => onTick?.({ phase, paused, remaining, completed, settings: settings() })

  function positiveInt(value, fallback) {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
  }

  function settings() {
    return { ...durations }
  }

  function enter(next) {
    phase = next
    if (next === 'focus') {
      remaining = durations.focus
      onNotify?.({ text: '🍅 专注开始，加油！', status: 'working' })
    } else if (next === 'short_break') {
      remaining = durations.short
      onNotify?.({ text: '☕ 短休一下~', status: 'replying', motion: 'Tap' })
    } else if (next === 'long_break') {
      remaining = durations.long
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
      enter(completed % durations.longEvery === 0 ? 'long_break' : 'short_break')
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
    configure(next = {}) {
      const before = durations[phase] || 0
      if (next.focus) durations.focus = positiveInt(next.focus, durations.focus)
      if (next.short) durations.short = positiveInt(next.short, durations.short)
      if (next.long) durations.long = positiveInt(next.long, durations.long)
      if (next.longEvery) durations.longEvery = positiveInt(next.longEvery, durations.longEvery)
      const after = durations[phase] || 0
      if (phase !== 'idle' && before > 0 && after > 0) remaining = Math.min(remaining, after)
      emitTick()
    },
    tick() {
      if (paused || phase === 'idle') return
      remaining -= 1
      emitTick()
      if (remaining <= 0) advance()
    },
    state() {
      return { phase, paused, remaining, completed, settings: settings() }
    },
    settings,
  }
}

module.exports = { createPomodoro }
