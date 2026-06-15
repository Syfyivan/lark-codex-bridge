// GIF / sprite rendering backend — a single <img> whose source swaps by status.
//
// PRIVATE use only: drop your own GIFs in src/renderer/pets/<set>/ (gitignored —
// never committed, never shipped). The public/distributed build keeps using the
// Live2D backend, so no third-party art ends up in the repo or release.
//
// cfg: { set, map: { idle, looking, working, replying, waiting, done, failed, tap } }
const TRANSIENT = new Set(['done', 'failed', 'waiting', 'tap'])

export function initGifBackend(cfg = {}) {
  const base = `./pets/${cfg.set || 'default'}/`
  const map = cfg.map || {}
  const img = document.createElement('img')
  img.id = 'pet-gif'
  img.draggable = false
  document.body.appendChild(img)

  let ongoing = 'idle' // the looping baseline state to revert to
  let revertTimer

  const fileFor = (state) => map[state] || map.idle || 'idle.gif'

  function render(state) {
    if (img.getAttribute('data-state') === state) return
    img.src = base + fileFor(state)
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
  }
}
