// Copy to accessories.local.js to tune accessory placement for your private pet.
// The local file is gitignored. You can override built-in accessories by id or
// add your own CSS-rendered classes (for example .accessory-my_hat in style.css).
import { ACCESSORIES as BUILTIN_ACCESSORIES, ACCESSORY_SLOTS as BUILTIN_SLOTS } from './accessories.js'

export const ACCESSORY_SLOTS = BUILTIN_SLOTS

export const ACCESSORIES = [
  ...BUILTIN_ACCESSORIES,
  // Example: retune the sprout for a shorter GIF pet.
  // {
  //   id: 'sprout',
  //   slot: 'head',
  //   label: '小芽',
  //   unlockLevel: 1,
  //   anchor: { x: 0.5, y: 0.08, width: 0.14, aspect: 0.95 },
  // },
]
