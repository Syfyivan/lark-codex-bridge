// Built-in public accessories. They are CSS-rendered overlays, so the public
// build does not ship third-party art. Coordinates are relative to the current
// pet bounds and can be tuned per accessory without touching renderer logic.
export const ACCESSORY_SLOTS = [
  { id: 'head', label: '头饰' },
  { id: 'face', label: '脸部' },
  { id: 'badge', label: '徽章' },
  { id: 'aura', label: '光效' },
]

// emoji 配饰商店(零版权:emoji 当配饰,免下载)。
// `icon` 是直接渲染的 emoji 文本,`cost` 是经验(⭐)售价。SHOP_ONLY 把它们挡在
// 等级解锁路径之外 → 不随升级自动解锁,只能在管理中心「配饰商店」用经验购买。
// 渲染层(accessories.js)见到 `icon` 就画 emoji 文本,无需任何素材文件。
const SHOP_ONLY = 9999
const SHOP_ANCHORS = {
  head: { x: 0.5, y: 0.1, width: 0.26, aspect: 1 },
  face: { x: 0.5, y: 0.34, width: 0.3, aspect: 1 },
  badge: { x: 0.74, y: 0.6, width: 0.18, aspect: 1 },
  aura: { x: 0.5, y: 0.06, width: 0.32, aspect: 1 },
}
const EMOJI_SHOP = [
  ['top_hat', 'head', '礼帽', '🎩', 40],
  ['cap', 'head', '鸭舌帽', '🧢', 40],
  ['crown', 'head', '皇冠', '👑', 120],
  ['bow', 'head', '蝴蝶结', '🎀', 30],
  ['shades', 'face', '墨镜', '🕶️', 50],
  ['disguise', 'face', '伪装', '🥸', 60],
  ['medal', 'badge', '勋章', '🎖️', 60],
  ['star_badge', 'badge', '星徽', '⭐', 30],
  ['bone', 'badge', '骨头', '🦴', 40],
  ['sparkles', 'aura', '星环', '💫', 70],
  ['blossom', 'aura', '花环', '🌸', 80],
].map(([id, slot, label, icon, cost]) => ({
  id, slot, label, icon, cost, unlockLevel: SHOP_ONLY, anchor: SHOP_ANCHORS[slot],
}))

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
  ...EMOJI_SHOP,
]
