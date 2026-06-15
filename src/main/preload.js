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
  // token usage stats (P4) — local + Feishu(lark) merged
  tokenStats: () => ipcRenderer.invoke('pet:token-stats'),
  addLarkTokens: (tokens) => ipcRenderer.send('pet:add-lark-tokens', tokens),
  // pomodoro / reminder bubbles from main (P4)
  onNotify: (cb) => ipcRenderer.on('pet-notify', (_e, payload) => cb(payload)),
})
