// Copy this file to `render.local.js` (same folder) to switch Kodama off the
// default Live2D pet. render.local.js is gitignored, so your choice stays local.
//
//   cp render.local.example.js render.local.js && pnpm start
//
// Two ready options below — keep ONE `export const RENDER`.

// ── Option 1 (bundled, CC0): slime that evolves color by level ───────────────
// Ships in the repo at src/renderer/pets/slime/ — "Slime (CC0)" by Rick Hoppmann
// (https://opengameart.org/content/slime-0). CC0: commercial-ok, no attribution.
// The growth level picks the color stage; it shows for every status.
export const RENDER = {
  backend: 'gif',
  gif: {
    set: 'slime',
    stages: [
      { file: 'green.png', minLevel: 1, label: '幼体' },
      { file: 'blue.png', minLevel: 5, label: '成长期' },
      { file: 'yellow.png', minLevel: 15, label: '进阶' },
      { file: 'red.png', minLevel: 30, label: '高阶' },
      { file: 'purple.png', minLevel: 60, label: '最终形态' },
    ],
    map: { idle: 'green.png' }, // fallback if `stages` is removed
  },
}

// ── Option 2 (private): your own GIFs, swapped by status ─────────────────────
// Drop GIFs in src/renderer/pets/<set>/ (gitignored). Missing states fall back
// to idle.gif, so one idle.gif is enough. Most web GIFs are copyrighted — keep
// them LOCAL, never commit/ship.
//
// export const RENDER = {
//   backend: 'gif',
//   gif: {
//     set: 'capybara',
//     map: {
//       idle: 'idle.gif', looking: 'looking.gif', working: 'working.gif',
//       replying: 'working.gif', waiting: 'waiting.gif', done: 'done.gif',
//       failed: 'failed.gif', tap: 'tap.gif',
//     },
//   },
// }
