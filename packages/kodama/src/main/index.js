const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell, clipboard, globalShortcut, Notification } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const { spawn } = require('child_process')
const tokenUsage = require('./token-usage')
const { createPomodoro } = require('./pomodoro')
const { mapHookToEvent } = require('./hook-events')

let win
let taskWin
let manageWin
let lastUiSettings = null
let tray
let pomodoro = null
let sedentaryTimer = null
let accessoryMenuState = null
let petUiMenuState = { dndMode: false, soundEnabled: true, notificationsEnabled: true }
let localEventCount = 0
let lastLocalEvent = null
let lastOpenedTarget = null
let petHidden = false
let topmostTimers = []
let topmostInterval = null

process.on('uncaughtException', (err) => {
  console.error(`[kodama] uncaught exception: ${err?.stack || err?.message || err}`)
})
process.on('unhandledRejection', (err) => {
  console.error(`[kodama] unhandled rejection: ${err?.stack || err?.message || err}`)
})

function sendToPet(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    // Full-workarea transparent overlay. The pet is positioned *inside* this
    // window (renderer petX/petY) so it can hug any screen edge and bubbles
    // never clip at a tiny window's border. Click-through by default (set right
    // below) keeps the rest of the desktop fully usable.
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    movable: false,
    transparent: true,
    frame: false,
    hasShadow: false, // otherwise a grey rectangle shadow shows around the model
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    // macOS: a non-activating NSPanel is what reliably floats over *other apps'*
    // native fullscreen spaces (not just the desktop). 'panel' adds
    // NSWindowStyleMaskNonactivatingPanel at runtime and joins all spaces; paired
    // with app.setActivationPolicy('accessory') in whenReady. A harmless
    // "NSWindow does not support nonactivating panel styleMask" warning is
    // expected for frameless windows (electron/electron#35815, wontfix).
    // https://www.electronjs.org/docs/latest/api/base-window (type: 'panel')
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  reassertTopmost()
  // Click-through by default; the renderer flips this on when the cursor is
  // over the model (forward:true keeps mousemove events flowing for hit-testing).
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadFile(path.join(__dirname, '../renderer/index.html'))
  // macOS resets collection behavior on show; re-assert so the pet floats over
  // other apps' fullscreen spaces, not just the desktop.
  win.once('ready-to-show', scheduleTopmostReassert)
  win.on('show', scheduleTopmostReassert)
  win.on('focus', scheduleTopmostReassert)
  win.on('blur', scheduleTopmostReassert)

  // Uncomment while debugging:
  // win.webContents.openDevTools({ mode: 'detach' })
}

function createBridgeTasksWindow() {
  function showBridgeTasksWindow() {
    if (!taskWin || taskWin.isDestroyed()) return
    try {
      app.focus({ steal: true })
      taskWin.show()
      taskWin.focus()
      if (typeof taskWin.moveTop === 'function') taskWin.moveTop()
      taskWin.setAlwaysOnTop(true, 'floating')
      setTimeout(() => {
        if (taskWin && !taskWin.isDestroyed()) taskWin.setAlwaysOnTop(false)
      }, 1200).unref?.()
    } catch (err) {
      console.error(`[kodama] show bridge tasks window failed: ${err.message}`)
    }
  }

  if (taskWin && !taskWin.isDestroyed()) {
    showBridgeTasksWindow()
    return taskWin
  }

  taskWin = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: 'Kodama Bridge Tasks',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  taskWin.loadFile(path.join(__dirname, '../renderer/bridge-tasks.html'))
  taskWin.once('ready-to-show', showBridgeTasksWindow)
  taskWin.webContents.once('did-finish-load', showBridgeTasksWindow)
  setTimeout(showBridgeTasksWindow, 800).unref?.()
  taskWin.on('closed', () => {
    taskWin = null
  })
  return taskWin
}

// A real, roomy settings/management window (the right-click overlay panel is
// cramped). It talks to the pet renderer's ui-settings via the main cache.
function openManageWindow() {
  if (manageWin && !manageWin.isDestroyed()) {
    manageWin.show()
    manageWin.focus()
    return manageWin
  }
  manageWin = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 560,
    minHeight: 520,
    title: 'Kodama 管理',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  manageWin.loadFile(path.join(__dirname, '../renderer/manage.html'))
  manageWin.once('ready-to-show', () => {
    manageWin.show()
    manageWin.focus()
  })
  manageWin.on('closed', () => {
    manageWin = null
  })
  return manageWin
}

// Float above everything — including other apps' fullscreen spaces — on all desktops.
function reassertTopmost() {
  if (petHidden || !win || win.isDestroyed()) return
  if (!win.isVisible()) win.showInactive()
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  if (typeof win.moveTop === 'function') win.moveTop()
}

function scheduleTopmostReassert() {
  if (petHidden) return
  topmostTimers.forEach(clearTimeout)
  topmostTimers = [20, 250, 900].map(delay => setTimeout(reassertTopmost, delay))
}

function setPetHidden(hidden) {
  petHidden = Boolean(hidden)
  if (win && !win.isDestroyed()) {
    if (petHidden) {
      win.hide()
      notifyHiddenControls()
    } else {
      win.showInactive()
      scheduleTopmostReassert()
    }
  }
  refreshTray()
}

function showPetAndMaybeTogglePanel(togglePanel = false) {
  setPetHidden(false)
  if (togglePanel) setTimeout(() => sendToPet('pet:toggle-panel'), 80)
}

function notifyHiddenControls() {
  try {
    if (!Notification.isSupported()) return
    new Notification({
      title: 'Kodama 已隐藏',
      body: '按 ⌘⌥K 恢复，或在 kodama 目录运行 pnpm run show。',
    }).show()
  } catch {
    /* notification is best-effort */
  }
}

function loginItemOptions(openAtLogin = false) {
  if (app.isPackaged) return { openAtLogin }
  return {
    openAtLogin,
    path: process.execPath,
    args: [app.getAppPath()],
  }
}

function isLoginItemEnabled() {
  try {
    return app.getLoginItemSettings(loginItemOptions(false)).openAtLogin === true
  } catch {
    return false
  }
}

function setLoginItemEnabled(enabled) {
  try {
    app.setLoginItemSettings(loginItemOptions(enabled === true))
  } catch (err) {
    console.error(`[kodama] set login item failed: ${err.message}`)
  }
  refreshTray()
}

const WINDOW_STATE_VERSION = 3
const DEFAULT_WINDOW = { width: 280, height: 400 }
const windowStateFile = () => path.join(app.getPath('userData'), 'kodama-window.json')

// sessionId -> tty, captured while a session is alive so we can still jump to its
// cmux tab after the agent process exits (the tab/tty persist).
const sessionTtyFile = () => path.join(app.getPath('userData'), 'kodama-session-tty.json')
let sessionTtyCache = new Map()
let sessionTtySaveTimer = null
function loadSessionTtyCache() {
  try {
    const obj = JSON.parse(fs.readFileSync(sessionTtyFile(), 'utf8'))
    if (obj && typeof obj === 'object') sessionTtyCache = new Map(Object.entries(obj))
  } catch { /* first run / corrupt — start empty */ }
}
function saveSessionTtyCache() {
  if (sessionTtySaveTimer) return
  sessionTtySaveTimer = setTimeout(() => {
    sessionTtySaveTimer = null
    try { fs.writeFileSync(sessionTtyFile(), JSON.stringify(Object.fromEntries(sessionTtyCache))) } catch { /* ignore */ }
  }, 1000)
}
function clampWindowState(state, workArea) {
  const margin = 8
  const width = Math.min(state.width, Math.max(180, workArea.width - margin * 2))
  const height = Math.min(state.height, Math.max(240, workArea.height - margin * 2))
  const minX = workArea.x + margin
  const maxX = workArea.x + workArea.width - width - margin
  const minY = workArea.y + margin
  const maxY = workArea.y + workArea.height - height - margin
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(state.x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(state.y, minY), Math.max(minY, maxY))),
  }
}

function clampWindowByVisibleBounds(state, visibleBounds, workArea) {
  if (!visibleBounds || visibleBounds.width <= 0 || visibleBounds.height <= 0) {
    return clampWindowState(state, workArea)
  }
  const margin = 6
  const minVisibleRatio = Math.min(1, Math.max(0.25, Number(visibleBounds.minVisibleRatio) || 1))
  const bounds = {
    x: Number(visibleBounds.x) || 0,
    y: Number(visibleBounds.y) || 0,
    width: Number(visibleBounds.width) || 0,
    height: Number(visibleBounds.height) || 0,
  }
  const horizontalOverflow = bounds.width * (1 - minVisibleRatio)
  const verticalOverflow = bounds.height * (1 - minVisibleRatio)
  const minX = workArea.x + margin - bounds.x - horizontalOverflow
  const maxX = workArea.x + workArea.width - margin - bounds.x - bounds.width + horizontalOverflow
  const minY = workArea.y + margin - bounds.y - verticalOverflow
  const maxY = workArea.y + workArea.height - margin - bounds.y - bounds.height + verticalOverflow
  return {
    ...state,
    x: Math.round(Math.min(Math.max(state.x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(state.y, minY), Math.max(minY, maxY))),
  }
}

function defaultWindowState(workArea, width = DEFAULT_WINDOW.width, height = DEFAULT_WINDOW.height) {
  return clampWindowState({
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
  }, workArea)
}

function loadWindowState(workArea) {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
    if (s && s.version === WINDOW_STATE_VERSION && s.width > 0 && s.height > 0) {
      return clampWindowState({
        width: s.width,
        height: s.height,
        x: Number.isFinite(s.x) ? s.x : workArea.x + workArea.width - s.width - 24,
        y: Number.isFinite(s.y) ? s.y : workArea.y + workArea.height - s.height - 24,
      }, workArea)
    }
  } catch {
    /* fall back to default */
  }
  return defaultWindowState(workArea)
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const [width, height] = win.getSize()
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify({ version: WINDOW_STATE_VERSION, width, height, x, y }))
  } catch (err) {
    console.error(`[kodama] save window state failed: ${err.message}`)
  }
}

// The overlay window now spans the whole work area; "size" means scaling the
// pet inside it, which the renderer owns. Tray presets just push a scale.
function setPetScale(scale) {
  sendToPet('pet:set-scale', scale)
}

// Keep the overlay covering the current primary work area across display changes.
function fitWindowToWorkArea() {
  if (!win || win.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  win.setBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height })
}

// renderer -> main: toggle click-through
ipcMain.on('pet:set-ignore-mouse', (e, ignore, opts) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w) w.setIgnoreMouseEvents(ignore, opts)
})

// renderer -> main: drag the window by a screen-space delta
ipcMain.on('pet:move', (e, dx, dy, visibleBounds) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  const [x, y] = w.getPosition()
  const [width, height] = w.getSize()
  const nextBounds = { x: Math.round(x + dx), y: Math.round(y + dy), width, height }
  const display = screen.getDisplayMatching(nextBounds)
  const next = clampWindowByVisibleBounds(nextBounds, visibleBounds, display.workArea)
  w.setPosition(next.x, next.y)
  saveWindowState()
})

ipcMain.on('pet:set-window-size', () => {
  // No-op: the overlay spans the full work area now; pet size is a renderer scale.
})

// Management window <-> pet renderer ui-settings sync, brokered by main.
ipcMain.on('pet:report-ui-settings', (_e, settings) => {
  if (settings && typeof settings === 'object') lastUiSettings = settings
})
ipcMain.handle('pet:get-ui-settings', () => lastUiSettings)
ipcMain.on('pet:patch-ui-settings', (_e, patch) => {
  if (patch && typeof patch === 'object') sendToPet('pet:apply-ui-patch', patch)
})
ipcMain.handle('pet:open-manage-window', () => {
  openManageWindow()
  return { ok: true }
})

ipcMain.on('pet:set-hidden', (_e, hidden) => {
  setPetHidden(hidden)
})

function larkChatUrls(chatId) {
  const id = String(chatId || '').trim()
  if (!/^oc_[A-Za-z0-9]+$/.test(id)) return []
  const encoded = encodeURIComponent(id)
  return [
    `https://applink.feishu.cn/client/chat/open?openChatId=${encoded}`,
    `https://applink.larksuite.com/client/chat/open?openChatId=${encoded}`,
    `lark://applink.feishu.cn/client/chat/open?openChatId=${encoded}`,
  ]
}

function safeExternalUrls(target) {
  const direct = String(target?.url || '').trim()
  if (direct) {
    try {
      const parsed = new URL(direct)
      if (['codex:', 'lark:', 'feishu:', 'https:', 'http:'].includes(parsed.protocol)) return [direct]
    } catch {
      return []
    }
  }
  return larkChatUrls(target?.chatId)
}

function isUnderPath(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`)
}

function expandUserPath(value) {
  const text = String(value || '').trim()
  if (!text || text.includes('\0')) return ''
  if (text === '~') return app.getPath('home')
  if (text.startsWith('~/')) return path.join(app.getPath('home'), text.slice(2))
  return text
}

function resolveSafeLocalPath(target) {
  const raw = expandUserPath(target?.path || target?.filePath || target?.folderPath)
  if (!raw) return { error: 'missing-local-path' }
  if (!path.isAbsolute(raw)) return { error: 'local-path-not-absolute' }
  if (!fs.existsSync(raw)) return { error: 'local-path-not-found' }

  const real = fs.realpathSync.native(raw)
  const allowedRoots = [app.getPath('home'), app.getPath('temp'), '/tmp', '/private/tmp']
    .map(root => fs.existsSync(root) ? fs.realpathSync.native(root) : '')
    .filter(Boolean)
  if (!allowedRoots.some(root => isUnderPath(real, root))) return { error: 'local-path-not-allowed' }
  const stat = fs.statSync(real)
  return { path: real, stat }
}

const TEXT_PATH_EXTENSIONS = new Set([
  '.bash',
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.kt',
  '.log',
  '.mjs',
  '.md',
  '.markdown',
  '.py',
  '.rs',
  '.sh',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
])

function isLikelyTextPath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return TEXT_PATH_EXTENSIONS.has(ext) || /(?:transcript|session|log)/i.test(path.basename(filePath))
}

function openTextPath(filePath) {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise((resolve) => {
    const child = spawn('open', ['-t', filePath], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

async function openLocalTarget(target) {
  const resolved = resolveSafeLocalPath(target)
  if (resolved.error) return { ok: false, error: resolved.error }

  if (resolved.stat.isDirectory()) {
    const openPathError = await shell.openPath(resolved.path)
    if (!openPathError) return { ok: true, path: resolved.path, method: 'shell.openPath:folder' }
    return { ok: false, error: openPathError || 'open-local-folder-failed' }
  }

  if (isLikelyTextPath(resolved.path) && await openTextPath(resolved.path)) {
    return { ok: true, path: resolved.path, method: 'open -t' }
  }

  shell.showItemInFolder(resolved.path)
  return { ok: true, path: resolved.path, method: 'shell.showItemInFolder' }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `${command} exited ${code}`))
    })
  })
}

function parsePs(stdout) {
  return stdout.split('\n').map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) return null
    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      tty: match[4],
      command: match[5],
    }
  }).filter(Boolean)
}

function appPathFromCommand(command) {
  const match = String(command || '').match(/(\/Applications\/[^"]+?\.app)(?:\/|$)/)
  return match?.[1] || ''
}

const isAgentCommand = (command) => /(^|\/|\s)(claude|codex)(\s|$)/i.test(String(command || ''))

// Working directory of a pid via lsof (used to locate an agent session whose id
// isn't on its argv — e.g. Claude Code, where we only know the cwd).
async function processCwd(pid) {
  try {
    const out = await runCommand('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)])
    const line = out.split('\n').find((l) => l.startsWith('n'))
    return line ? line.slice(1).trim() : ''
  } catch {
    return ''
  }
}

async function findCliSessionTarget(target) {
  const sessionId = String(target?.sessionId || '').trim()
  const cwd = String(target?.cwd || '').trim()
  const rows = parsePs(await runCommand('ps', ['-axo', 'pid,ppid,pgid,tty,args']))
  const byPid = new Map(rows.map(row => [row.pid, row]))

  // 1) Strongest signal: the agent process carries the session id on its argv.
  let hit = sessionId
    ? rows.find((row) => row.command.includes(sessionId) && isAgentCommand(row.command))
    : null

  // 2) Fallback: match a running agent by working directory (Claude Code rarely
  //    puts the session id on argv, which is why jumps used to miss the tty).
  if (!hit && cwd) {
    const agents = rows.filter((row) => isAgentCommand(row.command) && normalizeTty(row.tty))
    for (const row of agents) {
      if (await processCwd(row.pid) === cwd) { hit = row; break }
    }
  }
  if (!hit) return null

  let appPath = ''
  let cursor = hit
  const seen = new Set()
  while (cursor && !seen.has(cursor.pid)) {
    seen.add(cursor.pid)
    appPath = appPathFromCommand(cursor.command) || appPath
    cursor = byPid.get(cursor.ppid)
  }
  return { ...hit, appPath }
}

// ---------- cmux integration ----------
// cmux ships a socket-control CLI; we use it to focus the exact workspace/pane
// that hosts a session instead of blindly re-opening the app (which dumped the
// user into a fresh cmux). Join key between our session and cmux is the tty.
function cmuxBinPath() {
  for (const base of ['/Applications', path.join(app.getPath('home'), 'Applications')]) {
    const p = path.join(base, 'cmux.app', 'Contents', 'Resources', 'bin', 'cmux')
    if (fs.existsSync(p)) return p
  }
  return ''
}

function bareTty(value) {
  return String(value || '').replace(/^\/dev\//, '').trim()
}

// Parse `cmux tree --all` into surfaces with their enclosing window/workspace/pane.
async function listCmuxSurfaces() {
  const bin = cmuxBinPath()
  if (!bin) return []
  let out = ''
  try { out = await runCommand(bin, ['tree', '--all']) } catch { return [] }
  const surfaces = []
  let win = ''
  let ws = ''
  let pane = ''
  for (const line of out.split('\n')) {
    const w = line.match(/\bwindow\s+(window:\d+)/)
    if (w) win = w[1]
    const k = line.match(/\bworkspace\s+(workspace:\d+)/)
    if (k) ws = k[1]
    const p = line.match(/\bpane\s+(pane:\d+)/)
    if (p) pane = p[1]
    const s = line.match(/\bsurface\s+(surface:\d+)\b.*?\btty=(\S+)/)
    if (s) surfaces.push({ window: win, workspace: ws, pane, surface: s[1], tty: bareTty(s[2]) })
  }
  return surfaces
}

async function focusCmuxByTty(tty) {
  const bare = bareTty(tty)
  if (!bare) return null
  const bin = cmuxBinPath()
  if (!bin) return null
  const hit = (await listCmuxSurfaces()).find((s) => s.tty === bare)
  if (!hit) return null
  try {
    if (hit.window) await runCommand(bin, ['focus-window', '--window', hit.window]).catch(() => {})
    if (hit.workspace) await runCommand(bin, ['select-workspace', '--workspace', hit.workspace])
    if (hit.pane) await runCommand(bin, ['focus-pane', '--pane', hit.pane, '--workspace', hit.workspace]).catch(() => {})
    return { workspace: hit.workspace, pane: hit.pane, surface: hit.surface, tty: bare }
  } catch (err) {
    console.error(`[kodama] cmux focus failed: ${err.message}`)
    return null
  }
}

// While a session is alive, remember its tty so we can still jump after it ends.
async function cacheSessionTty(sessionId) {
  const id = String(sessionId || '').trim()
  if (!id) return
  try {
    const rows = parsePs(await runCommand('ps', ['-axo', 'pid,ppid,pgid,tty,args']))
    const hit = rows.find((row) => row.command.includes(id) && isAgentCommand(row.command) && normalizeTty(row.tty))
    const tty = hit ? normalizeTty(hit.tty) : ''
    if (tty && sessionTtyCache.get(id) !== tty) {
      sessionTtyCache.set(id, tty)
      saveSessionTtyCache()
    }
  } catch { /* best-effort */ }
}

function normalizeTty(value) {
  const tty = String(value || '').trim()
  if (!tty || tty === '??') return ''
  return tty.startsWith('/dev/') ? tty : `/dev/${tty}`
}

async function activateTerminalTty(tty) {
  if (process.platform !== 'darwin') return false
  const targetTty = normalizeTty(tty)
  if (!targetTty) return false
  const script = `
set targetTty to ${JSON.stringify(targetTty)}
tell application "Terminal"
  repeat with wi from 1 to count windows
    set w to window wi
    repeat with ti from 1 to count tabs of w
      set t to tab ti of w
      try
        if (tty of t as string) is targetTty then
          set selected of t to true
          set index of w to 1
          activate
          return "ok"
        end if
      end try
    end repeat
  end repeat
end tell
return "not-found"
`
  try {
    const result = (await runCommand('osascript', ['-e', script])).trim()
    return result === 'ok'
  } catch (err) {
    console.error(`[kodama] activate terminal failed: ${err.message}`)
    return false
  }
}

async function openAppPath(appPath) {
  if (!appPath) return false
  try {
    await runCommand('open', [appPath])
    return true
  } catch {
    return false
  }
}

async function openTerminalSessionTarget(target) {
  const found = await findCliSessionTarget(target)
  let tty = normalizeTty(target?.tty) || normalizeTty(found?.tty)
  // Completed session: process gone, recover the tty cached while it was alive.
  if (!tty && target?.sessionId) tty = normalizeTty(sessionTtyCache.get(String(target.sessionId).trim()))

  // Prefer cmux: focus the exact workspace/pane by tty rather than re-opening
  // the app (which is what spawned a stray cmux instead of jumping).
  if (tty && cmuxBinPath()) {
    const cmux = await focusCmuxByTty(tty)
    if (cmux) {
      await openAppPath(found?.appPath || cmuxBinPath().replace(/\/Contents\/.*$/, ''))
      return { ok: true, method: 'cmux focus', tty, pid: found?.pid || null, ...cmux }
    }
  }

  if (tty && await activateTerminalTty(tty)) {
    return { ok: true, method: 'Terminal tty', tty, pid: found?.pid || null }
  }
  if (found?.appPath && await openAppPath(found.appPath)) {
    return { ok: true, method: 'open host app', appPath: found.appPath, tty, pid: found.pid }
  }
  return { ok: false, error: found ? 'terminal-tab-not-found' : 'agent-process-not-found' }
}

function appExists(name) {
  return fs.existsSync(`/Applications/${name}.app`) || fs.existsSync(path.join(app.getPath('home'), 'Applications', `${name}.app`))
}

function openUrlWithApp(appName, url) {
  return new Promise((resolve) => {
    const child = spawn('open', ['-a', appName, url], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

async function openExternalTarget(url) {
  const parsed = new URL(url)
  const shouldUseLark = ['lark:', 'feishu:'].includes(parsed.protocol) || /(^|\.)applink\.(feishu\.cn|larksuite\.com)$/i.test(parsed.hostname)
  const shouldUseCodex = parsed.protocol === 'codex:'
  if (shouldUseCodex && process.platform === 'darwin' && appExists('Codex')) {
    if (await openUrlWithApp('Codex', url)) return { ok: true, method: 'open -a Codex' }
  }
  if (shouldUseLark && process.platform === 'darwin') {
    for (const appName of ['Lark', 'Feishu', '飞书']) {
      if (appExists(appName) && await openUrlWithApp(appName, url)) return { ok: true, method: `open -a ${appName}` }
    }
  }
  await shell.openExternal(url)
  return { ok: true, method: 'shell.openExternal' }
}

ipcMain.handle('pet:open-target', async (_e, target) => {
  if (target?.kind === 'terminal-session') {
    const result = await openTerminalSessionTarget(target)
    if (result.ok) {
      lastOpenedTarget = { ...result, at: new Date().toISOString(), target }
    }
    return result
  }

  if (target?.kind === 'local-path' || target?.path || target?.filePath || target?.folderPath) {
    const result = await openLocalTarget(target)
    if (result.ok) {
      lastOpenedTarget = { path: result.path, method: result.method, at: new Date().toISOString(), target }
    }
    return result
  }

  const urls = safeExternalUrls(target)
  if (!urls.length) return { ok: false, error: 'missing-target-url' }
  let lastError = ''
  for (const url of urls) {
    try {
      const result = await openExternalTarget(url)
      lastOpenedTarget = { url, method: result.method, at: new Date().toISOString(), target }
      return { ok: true, url, method: result.method }
    } catch (err) {
      lastError = String(err?.message || err)
    }
  }
  clipboard.writeText(urls[0])
  return { ok: false, error: lastError || 'open-target-failed', copiedUrl: urls[0] }
})

function shortSessionIdFromPath(value) {
  const file = String(value || '').split(path.sep).pop() || ''
  const match = file.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return match?.[0] || ''
}

function readTextWindow(filePath, stat) {
  const maxBytes = 640 * 1024
  if (stat.size <= maxBytes) return fs.readFileSync(filePath, 'utf8')

  const headBytes = 128 * 1024
  const tailBytes = maxBytes - headBytes
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(headBytes)
    const tail = Buffer.alloc(tailBytes)
    const headRead = fs.readSync(fd, head, 0, headBytes, 0)
    const tailRead = fs.readSync(fd, tail, 0, tailBytes, Math.max(0, stat.size - tailBytes))
    return `${head.slice(0, headRead).toString('utf8')}\n${tail.slice(0, tailRead).toString('utf8')}`
  } finally {
    fs.closeSync(fd)
  }
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function extractVisibleText(value, depth = 0) {
  if (depth > 6 || value == null) return ''
  if (typeof value === 'string') return compactText(value)
  if (Array.isArray(value)) return compactText(value.map(item => extractVisibleText(item, depth + 1)).filter(Boolean).join(' '))
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return compactText(value.text)
  if (typeof value.content === 'string') return compactText(value.content)
  if (value.message && typeof value.message === 'object') return extractVisibleText(value.message, depth + 1)
  if (value.content) return extractVisibleText(value.content, depth + 1)
  return ''
}

function pushPreviewLine(lines, role, text) {
  const normalized = compactText(text)
  if (!normalized) return
  const prefix = role === 'user' ? '你' : role === 'assistant' ? 'Agent' : role || '消息'
  const line = `${prefix}: ${normalized}`
  if (lines[lines.length - 1] !== line) lines.push(line)
}

function parseCodexPreview(text, fallback = {}) {
  const lines = []
  const meta = { id: fallback.sessionId || '', cwd: fallback.cwd || '', updatedAt: '' }
  let lastUser = ''
  for (const raw of text.split('\n')) {
    if (!raw.trim().startsWith('{')) continue
    let item
    try {
      item = JSON.parse(raw)
    } catch {
      continue
    }
    if (item.timestamp) meta.updatedAt = item.timestamp
    if (item.type === 'session_meta' && item.payload) {
      meta.id = meta.id || item.payload.id || ''
      meta.cwd = meta.cwd || item.payload.cwd || ''
      meta.updatedAt = meta.updatedAt || item.payload.timestamp || ''
      continue
    }
    if (item.type === 'response_item' && item.payload?.role) {
      if (item.payload.role !== 'user' && item.payload.role !== 'assistant') continue
      const role = item.payload.role
      const visible = extractVisibleText(item.payload.content)
      if (role === 'user' && visible) lastUser = visible
      pushPreviewLine(lines, role, visible)
      continue
    }
    if (item.type === 'event_msg' && item.payload?.message) {
      pushPreviewLine(lines, 'Agent', item.payload.message)
    }
  }
  const cwdName = meta.cwd ? path.basename(meta.cwd) : ''
  const title = lastUser ? compactText(lastUser).slice(0, 48) : cwdName || `Codex ${String(meta.id || '').slice(0, 8)}`
  return { title, cwd: meta.cwd, updatedAt: meta.updatedAt, lines: lines.slice(-4) }
}

function parseClaudePreview(text, fallback = {}) {
  const lines = []
  const meta = { id: fallback.sessionId || '', cwd: fallback.cwd || '', updatedAt: '' }
  let lastUser = ''
  for (const raw of text.split('\n')) {
    if (!raw.trim().startsWith('{')) continue
    let item
    try {
      item = JSON.parse(raw)
    } catch {
      continue
    }
    if (item.timestamp) meta.updatedAt = item.timestamp
    meta.id = meta.id || item.sessionId || ''
    meta.cwd = meta.cwd || item.cwd || ''
    if (item.type !== 'user' && item.type !== 'assistant') continue
    const role = item.type === 'user' ? 'user' : 'assistant'
    const visible = extractVisibleText(item.message?.content)
    if (role === 'user' && visible) lastUser = visible
    pushPreviewLine(lines, role, visible)
  }
  const cwdName = meta.cwd ? path.basename(meta.cwd) : ''
  const title = lastUser ? compactText(lastUser).slice(0, 48) : cwdName || `Claude ${String(meta.id || '').slice(0, 8)}`
  return { title, cwd: meta.cwd, updatedAt: meta.updatedAt, lines: lines.slice(-4) }
}

function resolvePreviewPath(request) {
  const preferred = request?.transcriptPath || request?.agentTranscriptPath || ''
  if (!preferred) return { error: 'missing-transcript-path' }
  const resolved = resolveSafeLocalPath({ path: preferred })
  if (resolved.error) return resolved
  if (!resolved.stat.isFile()) return { error: 'transcript-not-file' }
  return resolved
}

ipcMain.handle('pet:session-preview', async (_e, request) => {
  try {
    const resolved = resolvePreviewPath(request)
    if (resolved.error) return { ok: false, error: resolved.error }
    const text = readTextWindow(resolved.path, resolved.stat)
    const provider = request?.provider === 'claude' ? 'claude' : 'codex'
    const sessionId = request?.sessionId || shortSessionIdFromPath(resolved.path)
    const parser = provider === 'claude' ? parseClaudePreview : parseCodexPreview
    const preview = parser(text, { sessionId, cwd: request?.cwd || '' })
    return {
      ok: true,
      provider,
      sessionId,
      transcriptPath: resolved.path,
      ...preview,
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

function bridgeTokenFromDisk() {
  const envToken = String(process.env.KODAMA_BRIDGE_TOKEN || '').trim()
  if (envToken) return envToken
  const candidates = [
    path.join(app.getPath('home'), '.lark-codex-bridge-http-token'),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const value = fs.readFileSync(candidate, 'utf8').trim()
      if (value) return value
    } catch {
      /* optional token file */
    }
  }
  return ''
}

function normalizeBridgeBaseUrl(value) {
  const parsed = new URL(String(value || 'http://127.0.0.1:8787'))
  const hostname = parsed.hostname.toLowerCase()
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new Error('bridge URL must be loopback')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported bridge protocol')
  return `${parsed.protocol}//${parsed.host}`
}

async function requestBridgeJson(baseUrl, pathName, { method = 'GET', body = null, token = '', timeoutMs = 30000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body != null) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = {}
    try {
      json = JSON.parse(text || '{}')
    } catch {
      json = { error: text || `HTTP ${res.status}` }
    }
    if (!res.ok) return { ok: false, status: res.status, error: json.error || `HTTP ${res.status}`, raw: json }
    return json
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: 'bridge request timed out' }
    return { ok: false, error: err?.message || String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function postBridgeJson(baseUrl, pathName, body, token) {
  return requestBridgeJson(baseUrl, pathName, {
    method: 'POST',
    body,
    token,
    timeoutMs: 180000,
  })
}

ipcMain.handle('pet:share-session', async (_e, request) => {
  try {
    const provider = request?.provider === 'claude' ? 'claude' : 'codex'
    const sessionId = String(request?.sessionId || request?.threadId || '').trim()
    if (!sessionId) return { ok: false, error: 'missing-session-id' }
    const baseUrl = normalizeBridgeBaseUrl(request?.bridgeUrl)
    const token = String(request?.token || '').trim() || bridgeTokenFromDisk()
    const result = await postBridgeJson(baseUrl, '/v1/sessions/session-shares', {
      provider,
      session_id: sessionId,
    }, token)
    if (!result?.ok) return result || { ok: false, error: 'bridge-share-failed' }
    const url = result.share?.url || result.doc?.url || result.url || ''
    if (!url) return { ok: false, error: 'bridge did not return a share URL', raw: result }
    clipboard.writeText(url)
    return { ...result, url, copied: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

function normalizeBridgeTaskLimit(value) {
  return clampInt(value, 1, 200, 50)
}

function normalizeBridgeTaskScope(request = {}) {
  const source = request || {}
  const scope = {}
  const taskId = String(source.taskId || source.task_id || '').trim()
  const contextKey = String(source.contextKey || source.context_key || '').trim()
  const chatId = String(source.chatId || source.chat_id || '').trim()
  const messageId = String(source.messageId || source.message_id || '').trim()
  if (taskId) scope.task_id = taskId
  if (contextKey) scope.context_key = contextKey
  if (chatId) scope.chat_id = chatId
  if (messageId) scope.message_id = messageId
  return scope
}

function bridgeTaskQueryPath(limit, scope = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  Object.entries(scope).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  return `/task-viewer/tasks.json?${params.toString()}`
}

ipcMain.handle('pet:bridge-tasks', async (_e, request) => {
  try {
    const baseUrl = normalizeBridgeBaseUrl(request?.bridgeUrl)
    const token = String(request?.token || '').trim() || bridgeTokenFromDisk()
    const limit = normalizeBridgeTaskLimit(request?.limit)
    const scope = normalizeBridgeTaskScope(request)
    const result = await requestBridgeJson(baseUrl, bridgeTaskQueryPath(limit, scope), {
      token,
      timeoutMs: 15000,
    })
    if (!result?.ok) return result || { ok: false, error: 'bridge task viewer request failed' }
    const tasks = Array.isArray(result.tasks) ? result.tasks : []
    return {
      ok: true,
      bridgeUrl: baseUrl,
      updatedAt: new Date().toISOString(),
      tasks,
      scope: result.scope || scope,
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('pet:share-bridge-tasks', async (_e, request) => {
  try {
    const baseUrl = normalizeBridgeBaseUrl(request?.bridgeUrl)
    const token = String(request?.token || '').trim() || bridgeTokenFromDisk()
    const limit = normalizeBridgeTaskLimit(request?.limit)
    const scope = normalizeBridgeTaskScope(request)
    const result = await postBridgeJson(baseUrl, '/v1/bridge/task-viewer/share', { limit, ...scope }, token)
    if (!result?.ok) return result || { ok: false, error: 'bridge task viewer share failed' }
    const url = result.url || result.share?.url || result.doc?.url || ''
    if (url) clipboard.writeText(url)
    return { ...result, url, copied: Boolean(url) }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('pet:open-bridge-tasks-window', () => {
  createBridgeTasksWindow()
  return { ok: true }
})

ipcMain.handle('pet:copy-text', (_e, text) => {
  clipboard.writeText(String(text || ''))
  return { ok: true }
})

ipcMain.handle('pet:read-text', () => {
  return { ok: true, text: clipboard.readText() }
})

// Growth state (level/exp/food) persisted in userData. (P4)
const stateFile = () => path.join(app.getPath('userData'), 'kodama-state.json')
ipcMain.handle('pet:get-state', () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  } catch {
    return null
  }
})
ipcMain.on('pet:save-state', (_e, state) => {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state))
  } catch (err) {
    console.error(`[kodama] save state failed: ${err.message}`)
  }
})

ipcMain.on('pet:accessory-menu', (_e, state) => {
  accessoryMenuState = state && typeof state === 'object' ? state : null
  refreshTray()
})

ipcMain.on('pet:ui-menu-state', (_e, state) => {
  if (state && typeof state === 'object') {
    petUiMenuState = {
      dndMode: state.dndMode === true,
      soundEnabled: state.soundEnabled !== false,
      notificationsEnabled: state.notificationsEnabled !== false,
    }
    refreshTray()
  }
})

const DEFAULT_POMODORO_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sedentaryMinutes: 45,
})
const pomodoroSettingsFile = () => path.join(app.getPath('userData'), 'kodama-pomodoro.json')

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizePomodoroSettings(input = {}) {
  return {
    focusMinutes: clampInt(input.focusMinutes, 1, 180, DEFAULT_POMODORO_SETTINGS.focusMinutes),
    shortBreakMinutes: clampInt(input.shortBreakMinutes, 1, 60, DEFAULT_POMODORO_SETTINGS.shortBreakMinutes),
    longBreakMinutes: clampInt(input.longBreakMinutes, 1, 120, DEFAULT_POMODORO_SETTINGS.longBreakMinutes),
    longBreakEvery: clampInt(input.longBreakEvery, 1, 12, DEFAULT_POMODORO_SETTINGS.longBreakEvery),
    sedentaryMinutes: clampInt(input.sedentaryMinutes, 0, 240, DEFAULT_POMODORO_SETTINGS.sedentaryMinutes),
  }
}

function loadPomodoroSettings() {
  try {
    return normalizePomodoroSettings(JSON.parse(fs.readFileSync(pomodoroSettingsFile(), 'utf8')))
  } catch {
    return { ...DEFAULT_POMODORO_SETTINGS }
  }
}

function savePomodoroSettings(settings) {
  try {
    fs.writeFileSync(pomodoroSettingsFile(), JSON.stringify(settings))
  } catch (err) {
    console.error(`[kodama] save pomodoro settings failed: ${err.message}`)
  }
}

function configurePomodoro(settings) {
  const next = normalizePomodoroSettings(settings)
  savePomodoroSettings(next)
  pomodoro?.configure({
    focus: next.focusMinutes * 60,
    short: next.shortBreakMinutes * 60,
    long: next.longBreakMinutes * 60,
    longEvery: next.longBreakEvery,
  })
  resetSedentaryTimer(next)
  refreshTray()
  return next
}

function resetSedentaryTimer(settings = loadPomodoroSettings()) {
  if (sedentaryTimer) {
    clearInterval(sedentaryTimer)
    sedentaryTimer = null
  }
  const minutes = Number(settings.sedentaryMinutes || 0)
  if (!Number.isFinite(minutes) || minutes <= 0) return
  sedentaryTimer = setInterval(() => {
    const phase = pomodoro?.state().phase
    if (phase === 'short_break' || phase === 'long_break') return
    sendToPet('pet-notify', { text: '🪑 久坐啦，起来走两步~', status: 'looking' })
  }, minutes * 60 * 1000)
  sedentaryTimer.unref?.()
}

ipcMain.handle('pet:pomodoro-settings', () => loadPomodoroSettings())
ipcMain.on('pet:pomodoro-settings', (_e, settings) => {
  configurePomodoro(settings)
})

// Feishu (lark) token ledger — accumulated from bridge events (source-tagged).
// Kept in its own file so the renderer's growth-state writes don't clobber it.
// Safe to add on the same machine without double-counting: the bridge runs Codex
// with --ephemeral, so those sessions are NOT in local ~/.codex.
const larkTokensFile = () => path.join(app.getPath('userData'), 'kodama-lark-tokens.json')
function loadLarkLedger() {
  try {
    return JSON.parse(fs.readFileSync(larkTokensFile(), 'utf8'))
  } catch {
    return {}
  }
}

const EMPTY_TOKEN_STATS = Object.freeze({
  today: 0,
  last7: 0,
  total: 0,
  local: Object.freeze({ today: 0, last7: 0, total: 0 }),
  lark: Object.freeze({ today: 0, last7: 0, total: 0 }),
})
let tokenStatsCache = { ...EMPTY_TOKEN_STATS, local: { ...EMPTY_TOKEN_STATS.local }, lark: { ...EMPTY_TOKEN_STATS.lark } }
let tokenStatsUpdatedAt = 0
let tokenStatsRefreshPromise = null

function mergeTokenStats(local, lark) {
  return {
    today: local.today + lark.today,
    last7: local.last7 + lark.last7,
    total: local.total + lark.total,
    local,
    lark,
  }
}

function computeLarkTokenStats(now = new Date()) {
  return tokenUsage.summarizeByDay(loadLarkLedger(), now)
}

function updateLarkTokenStatsCache() {
  const lark = computeLarkTokenStats()
  const local = tokenStatsCache.local || EMPTY_TOKEN_STATS.local
  tokenStatsCache = mergeTokenStats(local, lark)
  tokenStatsUpdatedAt = Date.now()
}

function runTokenStatsWorker() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'token-stats-worker.js')
    const env = { ...process.env }
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
    const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('token stats worker timed out'))
    }, 5 * 60 * 1000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `token stats worker exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (err) {
        reject(err)
      }
    })
  })
}

async function computeMergedTokenStatsOffMainThread() {
  const local = await runTokenStatsWorker()
  const lark = computeLarkTokenStats()
  return {
    today: local.today + lark.today,
    last7: local.last7 + lark.last7,
    total: local.total + lark.total,
    local,
    lark,
  }
}

function refreshTokenStats({ force = false } = {}) {
  const maxAgeMs = 5 * 60 * 1000
  if (!force && tokenStatsUpdatedAt && Date.now() - tokenStatsUpdatedAt < maxAgeMs) {
    return Promise.resolve(tokenStatsCache)
  }
  if (tokenStatsRefreshPromise) return tokenStatsRefreshPromise

  tokenStatsRefreshPromise = computeMergedTokenStatsOffMainThread()
    .then((stats) => {
      tokenStatsCache = stats
      tokenStatsUpdatedAt = Date.now()
      return tokenStatsCache
    })
    .catch((err) => {
      console.error(`[kodama] token stats refresh failed: ${err.message}`)
      return tokenStatsCache
    })
    .finally(() => {
      tokenStatsRefreshPromise = null
      refreshTray()
    })
  return tokenStatsRefreshPromise
}

function getCachedTokenStats() {
  refreshTokenStats()
  return tokenStatsCache
}

ipcMain.on('pet:add-lark-tokens', (_e, tokens) => {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return
  const day = new Date().toISOString().slice(0, 10)
  const led = loadLarkLedger()
  led[day] = (led[day] || 0) + n
  try {
    fs.writeFileSync(larkTokensFile(), JSON.stringify(led))
    updateLarkTokenStatsCache()
    refreshTray()
    refreshTokenStats({ force: true })
  } catch (err) {
    console.error(`[kodama] save lark tokens failed: ${err.message}`)
  }
})

// Cross-source token stats: local JSONL (direct) + lark ledger (Feishu), merged.
// Local Codex history can be gigabytes; keep the UI/hook server responsive by
// returning the last cache immediately and refreshing the expensive scan later.
ipcMain.handle('pet:token-stats', () => {
  try {
    return getCachedTokenStats()
  } catch (err) {
    console.error(`[kodama] token stats failed: ${err.message}`)
    return tokenStatsCache
  }
})

// Local receiver for Claude Code / Codex hooks. They POST lifecycle events here;
// we map them to pet events (source:'local') and forward to the renderer, so
// local sessions and the Feishu bot share one pet.
const LOCAL_AGENT_PORT = 7766
const HOOK_TOKEN = process.env.KODAMA_HOOK_TOKEN || '' // optional shared secret
const MAX_BODY_BYTES = 64 * 1024

function tokenOk(req) {
  if (!HOOK_TOKEN) return true // no token configured -> accept (loopback only)
  const header = req.headers['x-kodama-token'] || ''
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  return header === HOOK_TOKEN || bearer === HOOK_TOKEN
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function clampEventText(value, max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function emitRendererAgentEvent(event) {
  if (!event || !win || win.isDestroyed()) return false
  localEventCount += 1
  lastLocalEvent = { ...event, receivedAt: new Date().toISOString() }
  if (petHidden && shouldWakeHiddenPet(event)) setPetHidden(false)
  win.webContents.send('agent-event', event)
  return true
}

function controlPet(action) {
  if (action === 'show') {
    setPetHidden(false)
  } else if (action === 'hide') {
    setPetHidden(true)
  } else if (action === 'toggle') {
    setPetHidden(!petHidden)
  } else if (action === 'panel') {
    showPetAndMaybeTogglePanel(true)
  } else if (action === 'bridge-tasks') {
    createBridgeTasksWindow()
  } else {
    return { ok: false, error: 'unknown-control-action' }
  }
  return {
    ok: true,
    action,
    petHidden,
    windowReady: Boolean(win && !win.isDestroyed()),
  }
}

function shouldWakeHiddenPet(event) {
  return event && ['task_waiting', 'task_failed'].includes(event.type)
}

function startLocalAgentServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/healthz') {
      writeJson(res, 200, {
        ok: true,
        port: LOCAL_AGENT_PORT,
        windowReady: Boolean(win && !win.isDestroyed()),
        petHidden,
        localEventCount,
        lastLocalEvent,
        lastOpenedTarget,
        tokenStats: tokenStatsCache,
        loginItemEnabled: isLoginItemEnabled(),
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/pet/token-stats') {
      writeJson(res, 200, { ok: true, ...getCachedTokenStats() })
      return
    }
    const controlMatch = url.pathname.match(/^\/pet\/(show|hide|toggle|panel|bridge-tasks)$/)
    if (controlMatch && (req.method === 'GET' || req.method === 'POST')) {
      writeJson(res, 200, controlPet(controlMatch[1]))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      res.writeHead(415)
      res.end()
      return
    }
    if (!tokenOk(req)) {
      res.writeHead(401)
      res.end()
      return
    }
    let body = ''
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      body += c
      if (body.length > MAX_BODY_BYTES) {
        aborted = true
        res.writeHead(413)
        res.end()
        req.destroy()
      }
    })
    req.on('end', () => {
      if (aborted) return
      let data = {}
      try {
        data = JSON.parse(body || '{}')
      } catch {
        /* ignore malformed body */
      }
      const event = mapHookToEvent(data)
      if (url.pathname === '/pet/lark-token-test') {
        const tokens = Number(data.tokens || data.usage || data.total_tokens || 0)
        const larkEvent = {
          type: 'task_done',
          source: 'lark',
          text: clampEventText(data.text || `Feishu token test +${tokens}`),
          tokens: Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0,
          chatId: data.chatId || data.chat_id || '',
          messageId: data.messageId || data.message_id || '',
        }
        emitRendererAgentEvent(larkEvent)
        writeJson(res, 200, { ok: true, event: larkEvent })
        return
      }
      if (event) {
        const sid = event.sessionId || event.session_id
        if (sid) cacheSessionTty(sid) // remember tty while the session is alive
        emitRendererAgentEvent(event)
      }
      writeJson(res, 200, { ok: true })
    })
  })
  server.on('error', (e) => console.error(`[kodama] local agent receiver error: ${e.message}`))
  server.listen(LOCAL_AGENT_PORT, '127.0.0.1', () => {
    console.error(`[kodama] local agent receiver on http://127.0.0.1:${LOCAL_AGENT_PORT}`)
  })
  return server
}

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

function fmtClock(s) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// Live countdown in the menu-bar title (cheap, called every tick).
function updateTrayClock(st) {
  if (!tray || process.platform !== 'darwin') return
  if (!st || st.phase === 'idle') {
    tray.setTitle('Kodama')
    return
  }
  const emoji = st.phase === 'focus' ? '🍅' : '☕'
  tray.setTitle(`Kodama ${emoji} ${fmtClock(st.remaining)}${st.paused ? ' ⏸' : ''}`)
}

function buildAccessoryMenu() {
  if (!accessoryMenuState) return [{ label: '载入中', enabled: false }]
  const slots = Array.isArray(accessoryMenuState.slots) ? accessoryMenuState.slots : []
  const accessories = Array.isArray(accessoryMenuState.accessories) ? accessoryMenuState.accessories : []
  const unlocked = new Set(Array.isArray(accessoryMenuState.unlocked) ? accessoryMenuState.unlocked : [])
  const equipped = accessoryMenuState.equipped && typeof accessoryMenuState.equipped === 'object' ? accessoryMenuState.equipped : {}

  return slots.map((slot) => {
    const slotAccessories = accessories.filter((acc) => acc.slot === slot.id)
    const submenu = [
      {
        label: '不佩戴',
        type: 'radio',
        checked: !equipped[slot.id],
        click: () => sendToPet('pet:equip-accessory', { slot: slot.id, id: null }),
      },
      ...slotAccessories.map((acc) => {
        const isUnlocked = unlocked.has(acc.id)
        return {
          label: isUnlocked ? acc.label : `🔒 Lv.${acc.unlockLevel} ${acc.label}`,
          type: isUnlocked ? 'radio' : 'normal',
          checked: equipped[slot.id] === acc.id,
          enabled: isUnlocked,
          click: () => sendToPet('pet:equip-accessory', { slot: slot.id, id: acc.id }),
        }
      }),
    ]
    return { label: slot.label, submenu }
  })
}

function refreshTray() {
  if (!tray) return
  let stats = tokenStatsCache
  try {
    stats = getCachedTokenStats()
  } catch {
    /* keep cached stats */
  }
  const ps = pomodoro ? pomodoro.state() : { phase: 'idle', paused: false }
  const items = [{ label: 'Kodama 桌宠', enabled: false }, { type: 'separator' }]
  items.push({
    label: petHidden ? '显示桌宠  ⌘⌥K' : '隐藏桌宠  ⌘⌥K',
    click: () => setPetHidden(!petHidden),
  })
  items.push({ label: '事件 / 配置面板  ⌘⌥P', click: () => showPetAndMaybeTogglePanel(true) })
  items.push({ label: '管理 / 设置中心…', click: () => openManageWindow() })
  items.push({ label: 'Bridge 任务详情', click: () => createBridgeTasksWindow() })
  items.push({
    label: petUiMenuState.dndMode ? '退出勿扰模式' : '进入勿扰模式',
    click: () => sendToPet('pet:set-dnd-mode', !petUiMenuState.dndMode),
  })
  items.push({
    label: '开机自启',
    type: 'checkbox',
    checked: isLoginItemEnabled(),
    click: menuItem => setLoginItemEnabled(menuItem.checked),
  })
  if (ps.phase === 'idle') {
    items.push({ label: '🍅 开始番茄钟', click: () => pomodoro?.start() })
  } else {
    items.push({ label: ps.paused ? '▶ 继续' : '⏸ 暂停', click: () => pomodoro?.pauseResume() })
    items.push({ label: '✕ 放弃', click: () => pomodoro?.abandon() })
  }
  items.push({
    label: '大小',
    submenu: [
      { label: '很小', click: () => setPetScale(0.5) },
      { label: '小', click: () => setPetScale(0.72) },
      { label: '中（默认）', click: () => setPetScale(0.95) },
      { label: '大', click: () => setPetScale(1.2) },
    ],
  })
  items.push({ label: '配饰', submenu: buildAccessoryMenu() })
  const larkToday = stats.lark?.today || 0
  items.push(
    { type: 'separator' },
    { label: `今日 token：${fmtTokens(stats.today)}`, enabled: false },
    { label: `　飞书：${fmtTokens(larkToday)} / 本地：${fmtTokens(stats.today - larkToday)}`, enabled: false },
    { label: `近 7 天：${fmtTokens(stats.last7)}`, enabled: false },
    { type: 'separator' },
    { label: '退出 Quit', click: () => app.quit() },
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray() {
  // Text title is more reliable than emoji-only titles in crowded macOS menu bars.
  const { nativeImage } = require('electron')
  tray = new Tray(nativeImage.createEmpty())
  if (process.platform === 'darwin') tray.setTitle('Kodama')
  tray.setToolTip('Kodama')
  refreshTray()
  setInterval(refreshTray, 5 * 60 * 1000)
}

function registerGlobalShortcuts() {
  const shortcuts = [
    ['CommandOrControl+Option+K', () => setPetHidden(!petHidden)],
    ['CommandOrControl+Option+P', () => showPetAndMaybeTogglePanel(true)],
  ]
  shortcuts.forEach(([accelerator, handler]) => {
    if (!globalShortcut.register(accelerator, handler)) {
      console.error(`[kodama] global shortcut unavailable: ${accelerator}`)
    }
  })
}

app.whenReady().then(() => {
  console.error('[kodama] app ready')
  loadSessionTtyCache()
  // macOS: become an accessory (agent) app — no Dock icon, never grabs a Space.
  // The other half (with the pet window's type:'panel') of reliably floating
  // over other apps' native fullscreen spaces.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  startLocalAgentServer()
  createWindow()
  createTray()
  registerGlobalShortcuts()
  refreshTokenStats({ force: true })
  topmostInterval = setInterval(reassertTopmost, 15 * 1000)
  topmostInterval.unref?.()
  const onDisplayChange = () => { fitWindowToWorkArea(); scheduleTopmostReassert() }
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
  app.on('browser-window-focus', scheduleTopmostReassert)
  app.on('browser-window-blur', scheduleTopmostReassert)

  // Pomodoro: main owns the timer + tray controls; the renderer just animates.
  const pomodoroSettings = loadPomodoroSettings()
  pomodoro = createPomodoro({
    focus: pomodoroSettings.focusMinutes * 60,
    short: pomodoroSettings.shortBreakMinutes * 60,
    long: pomodoroSettings.longBreakMinutes * 60,
    longEvery: pomodoroSettings.longBreakEvery,
    onNotify: (n) => {
      sendToPet('pet-notify', n) // bubble + status/motion in renderer
      refreshTray() // menu reflects the new phase
    },
    onReward: () => sendToPet('agent-event', { type: 'pomodoro_completed', source: 'local' }),
    onTick: (st) => updateTrayClock(st),
  })
  setInterval(() => pomodoro.tick(), 1000)
  resetSedentaryTimer(pomodoroSettings)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else scheduleTopmostReassert()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
