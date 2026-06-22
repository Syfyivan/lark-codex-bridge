// GIF / sprite rendering backend — a single <img> whose source swaps by status
// (and, with `stages`, by growth level). The default pet stays Live2D; this is
// opt-in via config/render.local.js.
//
// Assets live in src/renderer/pets/<set>/. The bundled `slime` set is CC0 and
// shipped; any other set is gitignored, so your own (possibly copyrighted) GIFs
// stay local and never get committed or shipped.
//
// cfg: {
//   set,
//   map: { idle, looking, working, replying, waiting, done, failed, tap },
//   stages: [{ file, minLevel }]  // optional level-based evolution
// }
// When `stages` is set, the growth level picks the sprite (e.g. a slime that
// changes color as it levels up) and that sprite is shown for every status —
// evolution is conveyed by the stage art, not per-status animations.
const TRANSIENT = new Set(['done', 'failed', 'waiting', 'tap'])

function pickStageFile(stages, level) {
  let chosen = ''
  for (const s of stages) {
    if (!s?.file) continue
    if (level >= (Number(s.minLevel) || 1)) chosen = s.file
  }
  return chosen || stages[0]?.file || ''
}

export function initGifBackend(cfg = {}) {
  const base = `./pets/${cfg.set || 'default'}/`
  const map = cfg.map || {}
  const stages = Array.isArray(cfg.stages) ? cfg.stages : []
  let stageFile = stages.length ? pickStageFile(stages, 1) : ''
  const img = document.createElement('img')
  img.id = 'pet-gif'
  img.draggable = false
  img.addEventListener('error', () => {
    const b = document.getElementById('bubble')
    if (b) {
      b.textContent = `⚠️ 缺少 ${base}${img.getAttribute('data-file') || 'idle.gif'}`
      b.classList.remove('hidden')
    }
  })
  document.body.appendChild(img)

  let ongoing = 'idle' // the looping baseline state to revert to
  let revertTimer

  // Stage art (if any) overrides per-status files: the evolved sprite is always shown.
  const fileFor = (state) => stageFile || map[state] || map.idle || 'idle.gif'

  // Compare the resolved file (not the state) so a stage swap re-renders even when
  // the status is unchanged.
  function render(state) {
    const file = fileFor(state)
    if (img.getAttribute('data-file') === file) {
      img.setAttribute('data-state', state)
      return
    }
    img.setAttribute('data-file', file)
    img.src = base + file
    img.setAttribute('data-state', state)
  }

  function show(state, transient) {
    clearTimeout(revertTimer)
    render(state)
    if (transient) {
      revertTimer = setTimeout(() => render(ongoing), 2600)
    } else {
      ongoing = state
    }
  }

  show('idle', false)

  return {
    el: img,
    getBounds() {
      const r = img.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    },
    // logical motion from reactions / tap ('Idle' | 'Tap')
    playMotion(pref) {
      if (/tap|touch/i.test(pref)) show('tap', true)
    },
    // status from reactions (working/done/failed/waiting/looking/replying/idle)
    setStatus(status) {
      if (status) show(status, TRANSIENT.has(status))
    },
    // growth level → evolution stage (no-op when `stages` isn't configured)
    setLevel(level) {
      if (!stages.length) return
      const next = pickStageFile(stages, Math.max(1, Number(level) || 1))
      if (next && next !== stageFile) {
        stageFile = next
        render(img.getAttribute('data-state') || ongoing)
      }
    },
  }
}
