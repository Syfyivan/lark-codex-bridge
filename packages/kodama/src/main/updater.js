const { app, BrowserWindow, ipcMain, Notification } = require('electron')
const { autoUpdater } = require('electron-updater')

const STATUS_EVENT = 'pet:update-status-changed'

let onStatusChange = null
let notifyPet = null
let registered = false
let startupTimer = null

const state = {
  supported: false,
  checking: false,
  available: false,
  downloaded: false,
  version: null,
  releaseDate: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
  disabledReason: null,
}

function publicState() {
  return { ...state, currentVersion: app.getVersion() }
}

function emitStatus() {
  const payload = publicState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(STATUS_EVENT, payload)
  }
  onStatusChange?.(payload)
}

function setState(patch) {
  Object.assign(state, patch)
  emitStatus()
}

function notify(title, body, petStatus = 'replying') {
  const text = body ? `${title}：${body}` : title
  notifyPet?.({ text, status: petStatus })
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  } catch {
    /* notification support is platform-dependent */
  }
}

function markUnsupported(reason) {
  setState({
    supported: false,
    checking: false,
    available: false,
    downloaded: false,
    progress: null,
    disabledReason: reason,
  })
}

function configureUpdater() {
  state.supported = true
  state.disabledReason = null

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  autoUpdater.on('checking-for-update', () => {
    setState({ checking: true, error: null, progress: null })
  })

  autoUpdater.on('update-available', (info = {}) => {
    setState({
      checking: false,
      available: true,
      downloaded: false,
      version: info.version || null,
      releaseDate: info.releaseDate || null,
      progress: null,
      error: null,
    })
    notify('Kodama 有新版本', info.version ? `正在下载 ${info.version}` : '正在下载更新')
  })

  autoUpdater.on('update-not-available', () => {
    setState({
      checking: false,
      available: false,
      downloaded: false,
      progress: null,
      error: null,
      lastCheckedAt: new Date().toISOString(),
    })
  })

  autoUpdater.on('download-progress', (progress = {}) => {
    setState({
      available: true,
      downloaded: false,
      progress: {
        percent: Number.isFinite(progress.percent) ? progress.percent : null,
        bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : null,
        transferred: Number.isFinite(progress.transferred) ? progress.transferred : null,
        total: Number.isFinite(progress.total) ? progress.total : null,
      },
    })
  })

  autoUpdater.on('update-downloaded', (info = {}) => {
    setState({
      checking: false,
      available: true,
      downloaded: true,
      version: info.version || state.version,
      releaseDate: info.releaseDate || state.releaseDate,
      progress: null,
      error: null,
      lastCheckedAt: new Date().toISOString(),
    })
    notify('Kodama 更新已下载', '从托盘选择「安装更新」或退出应用时自动安装', 'idle')
  })

  autoUpdater.on('error', (err) => {
    setState({
      checking: false,
      progress: null,
      error: err?.message || String(err),
      lastCheckedAt: new Date().toISOString(),
    })
    notify('Kodama 更新失败', state.error, 'idle')
  })
}

function registerIpcHandlers() {
  ipcMain.handle('pet:update-status', () => publicState())
  ipcMain.handle('pet:check-for-updates', async () => checkForUpdates({ manual: true }))
  ipcMain.handle('pet:install-update', () => installDownloadedUpdate())
}

async function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) notify('Kodama 更新不可用', '开发模式不会检查 GitHub Releases', 'idle')
    return publicState()
  }
  if (!state.supported) return publicState()
  if (state.checking) return publicState()

  try {
    setState({ checking: true, error: null })
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setState({
      checking: false,
      progress: null,
      error: err?.message || String(err),
      lastCheckedAt: new Date().toISOString(),
    })
    if (manual) notify('Kodama 更新失败', state.error, 'idle')
  }
  return publicState()
}

function installDownloadedUpdate() {
  if (!state.downloaded) return { ok: false, error: 'no update downloaded' }
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return { ok: true }
}

function registerAutoUpdater(options = {}) {
  onStatusChange = options.onStatusChange || null
  notifyPet = options.notifyPet || null
  if (registered) return publicState()
  registered = true

  registerIpcHandlers()

  if (!app.isPackaged) {
    markUnsupported('development mode')
    return publicState()
  }

  configureUpdater()
  startupTimer = setTimeout(() => checkForUpdates(), 4000)
  startupTimer.unref?.()
  return publicState()
}

function getUpdateStatus() {
  return publicState()
}

function disposeAutoUpdater() {
  if (startupTimer) clearTimeout(startupTimer)
}

module.exports = {
  registerAutoUpdater,
  checkForUpdates,
  installDownloadedUpdate,
  getUpdateStatus,
  disposeAutoUpdater,
}
