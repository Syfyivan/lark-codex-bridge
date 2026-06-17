// Built-in public accessories. They are CSS-rendered overlays, so the public
// build does not ship third-party art. Coordinates are relative to the current
// pet bounds and can be tuned per accessory without touching renderer logic.
export const ACCESSORY_SLOTS = [
  { id: 'head', label: '头饰' },
  { id: 'face', label: '脸部' },
  { id: 'badge', label: '徽章' },
  { id: 'aura', label: '光效' },
]

export const ACCESSORIES = [
  {
    id: 'sprout',
    slot: 'head',
    label: '小芽',
    unlockLevel: 1,
    anchor: { x: 0.5, y: 0.11, width: 0.16, aspect: 0.95 },
  },
  {
    id: 'round_glasses',
    slot: 'face',
    label: '圆框眼镜',
    unlockLevel: 2,
    anchor: { x: 0.5, y: 0.35, width: 0.36, aspect: 0.32 },
  },
  {
    id: 'agent_badge',
    slot: 'badge',
    label: 'Agent 徽章',
    unlockLevel: 3,
    anchor: { x: 0.72, y: 0.62, width: 0.18, aspect: 0.58 },
  },
  {
    id: 'focus_halo',
    slot: 'aura',
    label: '专注光环',
    unlockLevel: 5,
    anchor: { x: 0.5, y: 0.08, width: 0.42, aspect: 0.28 },
  },
]
