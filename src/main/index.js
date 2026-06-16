const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const tokenUsage = require('./token-usage')
const { createPomodoro } = require('./pomodoro')

let win
let tray
let pomodoro = null

function sendToPet(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const { width, height } = loadWindowSize()

  win = new BrowserWindow({
    width,
    height,
    // bottom-right corner of the work area by default
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
    transparent: true,
    frame: false,
    hasShadow: false, // otherwise a grey rectangle shadow shows around the model
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
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
  win.once('ready-to-show', reassertTopmost)
  win.on('show', reassertTopmost)

  // Uncomment while debugging:
  // win.webContents.openDevTools({ mode: 'detach' })
}

// Float above everything — including other apps' fullscreen spaces — on all desktops.
function reassertTopmost() {
  if (!win || win.isDestroyed()) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}

const DEFAULT_WINDOW = { width: 360, height: 520 }
const windowStateFile = () => path.join(app.getPath('userData'), 'kodama-window.json')
function loadWindowSize() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
    if (s && s.width > 0 && s.height > 0) return { width: s.width, height: s.height }
  } catch {
    /* fall back to default */
  }
  return { ...DEFAULT_WINDOW }
}
function setPetSize(width, height) {
  if (!win || win.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  win.setResizable(true) // some platforms ignore setSize while non-resizable
  win.setSize(width, height)
  win.setResizable(false)
  win.setPosition(workArea.x + workArea.width - width - 24, workArea.y + workArea.height - height - 24)
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify({ width, height }))
  } catch (err) {
    console.error(`[kodama] save window size failed: ${err.message}`)
  }
}

// renderer -> main: toggle click-through
ipcMain.on('pet:set-ignore-mouse', (e, ignore, opts) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w) w.setIgnoreMouseEvents(ignore, opts)
})

// renderer -> main: drag the window by a screen-space delta
ipcMain.on('pet:move', (e, dx, dy) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  const [x, y] = w.getPosition()
  w.setPosition(Math.round(x + dx), Math.round(y + dy))
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
ipcMain.on('pet:add-lark-tokens', (_e, tokens) => {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return
  const day = new Date().toISOString().slice(0, 10)
  const led = loadLarkLedger()
  led[day] = (led[day] || 0) + n
  try {
    fs.writeFileSync(larkTokensFile(), JSON.stringify(led))
  } catch (err) {
    console.error(`[kodama] save lark tokens failed: ${err.message}`)
  }
})

// Cross-source token stats: local JSONL (direct) + lark ledger (Feishu), merged.
function mergedTokenStats() {
  const now = new Date()
  const local = tokenUsage.summarizeByDay(tokenUsage.usageByDay(), now)
  const lark = tokenUsage.summarizeByDay(loadLarkLedger(), now)
  return {
    today: local.today + lark.today,
    last7: local.last7 + lark.last7,
    total: local.total + lark.total,
    local,
    lark,
  }
}
ipcMain.handle('pet:token-stats', () => {
  try {
    return mergedTokenStats()
  } catch (err) {
    console.error(`[kodama] token stats failed: ${err.message}`)
    return { today: 0, last7: 0, total: 0, local: {}, lark: {} }
  }
})

// Local receiver for Claude Code / Codex hooks. They POST lifecycle events here;
// we map them to pet events (source:'local') and forward to the renderer, so
// local sessions and the Feishu bot share one pet.
const LOCAL_AGENT_PORT = 7766
const HOOK_TOKEN = process.env.KODAMA_HOOK_TOKEN || '' // optional shared secret
const MAX_BODY_BYTES = 64 * 1024

function mapHookToEvent(data) {
  // Codex `notify` payloads use `type` (no hook_event_name).
  if (!data.hook_event_name && data.type) {
    if (data.type === 'agent-turn-complete') {
      return { type: 'task_done', source: 'local', text: String(data['last-assistant-message'] || '').slice(0, 80) }
    }
    return null
  }
  switch (data.hook_event_name) {
    case 'UserPromptSubmit':
      return { type: 'task_started', source: 'local', text: '' }
    case 'SubagentStop':
      return { type: 'task_progress', source: 'local', text: '子任务完成' }
    case 'Stop':
      return { type: 'task_done', source: 'local', text: '' }
    case 'Notification':
      if (data.notification_type === 'idle_prompt') return { type: 'task_done', source: 'local' }
      return { type: 'task_waiting', source: 'local' } // permission_prompt etc.
    default:
      return null
  }
}

function tokenOk(req) {
  if (!HOOK_TOKEN) return true // no token configured -> accept (loopback only)
  const header = req.headers['x-kodama-token'] || ''
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  return header === HOOK_TOKEN || bearer === HOOK_TOKEN
}

function startLocalAgentServer() {
  const server = http.createServer((req, res) => {
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
      if (event && win && !win.isDestroyed()) {
        win.webContents.send('agent-event', event)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
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
    tray.setTitle('🌳')
    return
  }
  const emoji = st.phase === 'focus' ? '🍅' : '☕'
  tray.setTitle(`${emoji} ${fmtClock(st.remaining)}${st.paused ? ' ⏸' : ''}`)
}

function refreshTray() {
  if (!tray) return
  let stats = { today: 0, last7: 0, lark: { today: 0 } }
  try {
    stats = mergedTokenStats()
  } catch {
    /* keep zeros */
  }
  const ps = pomodoro ? pomodoro.state() : { phase: 'idle', paused: false }
  const items = [{ label: 'Kodama 桌宠', enabled: false }, { type: 'separator' }]
  if (ps.phase === 'idle') {
    items.push({ label: '🍅 开始番茄钟', click: () => pomodoro?.start() })
  } else {
    items.push({ label: ps.paused ? '▶ 继续' : '⏸ 暂停', click: () => pomodoro?.pauseResume() })
    items.push({ label: '✕ 放弃', click: () => pomodoro?.abandon() })
  }
  items.push({
    label: '大小',
    submenu: [
      { label: '很小', click: () => setPetSize(200, 290) },
      { label: '小', click: () => setPetSize(280, 400) },
      { label: '中（默认）', click: () => setPetSize(360, 520) },
      { label: '大', click: () => setPetSize(460, 650) },
    ],
  })
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
  // No icon asset yet in P0 — use a menu-bar title on macOS so it stays clickable.
  const { nativeImage } = require('electron')
  tray = new Tray(nativeImage.createEmpty())
  if (process.platform === 'darwin') tray.setTitle('🌳')
  tray.setToolTip('Kodama')
  refreshTray()
  setInterval(refreshTray, 5 * 60 * 1000)
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  startLocalAgentServer()

  // Pomodoro: main owns the timer + tray controls; the renderer just animates.
  pomodoro = createPomodoro({
    onNotify: (n) => {
      sendToPet('pet-notify', n) // bubble + status/motion in renderer
      refreshTray() // menu reflects the new phase
    },
    onReward: () => sendToPet('agent-event', { type: 'pomodoro_completed', source: 'local' }),
    onTick: (st) => updateTrayClock(st),
  })
  setInterval(() => pomodoro.tick(), 1000)

  // Sedentary nudge: gentle bubble unless you're already on a break.
  setInterval(() => {
    const phase = pomodoro?.state().phase
    if (phase === 'short_break' || phase === 'long_break') return
    sendToPet('pet-notify', { text: '🪑 久坐啦，起来走两步~', status: 'looking' })
  }, 45 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
