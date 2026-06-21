const { contextBridge, ipcRenderer } = require('electron')

// Minimal, safe bridge exposed to the renderer as window.pet
contextBridge.exposeInMainWorld('pet', {
  setIgnoreMouse: (ignore, opts) => ipcRenderer.send('pet:set-ignore-mouse', ignore, opts),
  move: (dx, dy, visibleBounds) => ipcRenderer.send('pet:move', dx, dy, visibleBounds),
  setWindowSize: (size) => ipcRenderer.send('pet:set-window-size', size),
  onSetScale: (cb) => ipcRenderer.on('pet:set-scale', (_e, scale) => cb(scale)),
  setHidden: (hidden) => ipcRenderer.send('pet:set-hidden', hidden),
  openTarget: (target) => ipcRenderer.invoke('pet:open-target', target),
  sessionPreview: (request) => ipcRenderer.invoke('pet:session-preview', request),
  shareSession: (request) => ipcRenderer.invoke('pet:share-session', request),
  bridgeTasks: (request) => ipcRenderer.invoke('pet:bridge-tasks', request),
  shareBridgeTasks: (request) => ipcRenderer.invoke('pet:share-bridge-tasks', request),
  openBridgeTasksWindow: () => ipcRenderer.invoke('pet:open-bridge-tasks-window'),
  copyText: (text) => ipcRenderer.invoke('pet:copy-text', text),
  readText: () => ipcRenderer.invoke('pet:read-text'),
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
  getPomodoroSettings: () => ipcRenderer.invoke('pet:pomodoro-settings'),
  updatePomodoroSettings: (settings) => ipcRenderer.send('pet:pomodoro-settings', settings),
  onTogglePanel: (cb) => ipcRenderer.on('pet:toggle-panel', () => cb()),
  updateUiMenuState: (state) => ipcRenderer.send('pet:ui-menu-state', state),
  onSetDndMode: (cb) => ipcRenderer.on('pet:set-dnd-mode', (_e, enabled) => cb(enabled)),
  // accessory tray menu state and commands
  updateAccessoryMenu: (state) => ipcRenderer.send('pet:accessory-menu', state),
  onEquipAccessory: (cb) => ipcRenderer.on('pet:equip-accessory', (_e, payload) => cb(payload)),
})
