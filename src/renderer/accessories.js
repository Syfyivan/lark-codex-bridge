import { ACCESSORIES } from './config/accessories.js'

const ACCESSORY_MARKUP = {
  round_glasses: '<span class="lens lens-left"></span><span class="bridge"></span><span class="lens lens-right"></span>',
  agent_badge: '<span>AI</span>',
}

let byId = new Map(ACCESSORIES.map((a) => [a.id, a]))

let layer = null
let getBounds = () => null
let equipped = {}
let renderedKey = ''

function ensureLayer() {
  if (layer) return layer
  layer = document.getElementById('accessory-layer')
  if (!layer) {
    layer = document.createElement('div')
    layer.id = 'accessory-layer'
    document.body.appendChild(layer)
  }
  return layer
}

function equippedIds() {
  return Object.values(equipped).filter(Boolean)
}

function render() {
  const ids = equippedIds()
  const key = ids.join('|')
  if (key === renderedKey) return
  renderedKey = key

  const root = ensureLayer()
  root.textContent = ''
  for (const id of ids) {
    const acc = byId.get(id)
    if (!acc) continue
    const el = document.createElement('div')
    el.className = `accessory accessory-${acc.id}`
    el.dataset.accessoryId = acc.id
    el.setAttribute('aria-hidden', 'true')
    el.innerHTML = ACCESSORY_MARKUP[acc.id] || ''
    root.appendChild(el)
  }
}

function position() {
  const root = ensureLayer()
  const bounds = getBounds?.()
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    root.classList.add('accessory-layer-hidden')
    return
  }
  root.classList.remove('accessory-layer-hidden')

  for (const el of root.children) {
    const acc = byId.get(el.dataset.accessoryId)
    if (!acc) continue
    const a = acc.anchor
    const width = bounds.width * a.width
    const height = width * (a.aspect || 1)
    el.style.left = `${bounds.x + bounds.width * a.x}px`
    el.style.top = `${bounds.y + bounds.height * a.y}px`
    el.style.width = `${width}px`
    el.style.height = `${height}px`
  }
}

function tick() {
  position()
  requestAnimationFrame(tick)
}

export function initAccessoryLayer(boundsGetter, options = {}) {
  getBounds = boundsGetter || getBounds
  if (Array.isArray(options.accessories) && options.accessories.length) {
    byId = new Map(options.accessories.map((a) => [a.id, a]))
  }
  ensureLayer()
  requestAnimationFrame(tick)
  return {
    setEquipped(nextEquipped = {}) {
      equipped = { ...nextEquipped }
      render()
      position()
    },
  }
}
