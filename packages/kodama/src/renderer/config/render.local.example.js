// Copy this file to `render.local.js` (same folder) to switch Kodama to the
// PRIVATE GIF backend. render.local.js is gitignored — it and your GIFs are
// never committed or shipped, so the public build keeps using Live2D.
//
// Steps:
//   1. cp render.local.example.js render.local.js
//   2. drop your GIFs into  src/renderer/pets/capybara/  (at minimum idle.gif)
//   3. pnpm start
//
// Missing states fall back to idle.gif, so one idle.gif is enough to start.
export const RENDER = {
  backend: 'gif',
  gif: {
    set: 'capybara', // -> src/renderer/pets/capybara/
    map: {
      idle: 'idle.gif',
      looking: 'looking.gif',
      working: 'working.gif',
      replying: 'working.gif',
      waiting: 'waiting.gif',
      done: 'done.gif',
      failed: 'failed.gif',
      tap: 'tap.gif',
    },
  },
}
