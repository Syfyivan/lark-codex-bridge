const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe bridge exposed to the renderer as window.pet
contextBridge.exposeInMainWorld('pet', {
  setIgnoreMouse: (ignore, opts) => ipcRenderer.send('pet:set-ignore-mouse', ignore, opts),
  move: (dx, dy) => ipcRenderer.send('pet:move', dx, dy),
  // local Claude Code / Codex hook events forwarded from the main process
  onAgentEvent: (cb) => ipcRenderer.on('agent-event', (_e, event) => cb(event)),
  // growth state (P4)
  getState: () => ipcRenderer.invoke('pet:get-state'),
  saveState: (state) => ipcRenderer.send('pet:save-state', state),
  // local token usage stats (P4)
  tokenStats: () => ipcRenderer.invoke('pet:token-stats'),
})
