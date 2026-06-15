const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe bridge exposed to the renderer as window.pet
contextBridge.exposeInMainWorld('pet', {
  setIgnoreMouse: (ignore, opts) => ipcRenderer.send('pet:set-ignore-mouse', ignore, opts),
  move: (dx, dy) => ipcRenderer.send('pet:move', dx, dy),
  // local Claude Code / Codex hook events forwarded from the main process
  onAgentEvent: (cb) => ipcRenderer.on('agent-event', (_e, event) => cb(event)),
})
