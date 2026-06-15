const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require('electron')
const path = require('path')
const http = require('http')

let win
let tray

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 360
  const height = 520

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

  // Float above everything, including fullscreen apps, on all desktops.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })

  // Click-through by default; the renderer flips this on when the cursor is
  // over the model (forward:true keeps mousemove events flowing for hit-testing).
  win.setIgnoreMouseEvents(true, { forward: true })

  win.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Uncomment while debugging:
  // win.webContents.openDevTools({ mode: 'detach' })
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

// Local receiver for Claude Code / Codex hooks. They POST lifecycle events here;
// we map them to pet events (source:'local') and forward to the renderer, so
// local sessions and the Feishu bot share one pet.
const LOCAL_AGENT_PORT = 7766
const HOOK_TOKEN = process.env.KODAMA_HOOK_TOKEN || '' // optional shared secret
const MAX_BODY_BYTES = 64 * 1024

function mapHookToEvent(data) {
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

function createTray() {
  // No icon asset yet in P0 — use a menu-bar title on macOS so it stays clickable.
  const { nativeImage } = require('electron')
  tray = new Tray(nativeImage.createEmpty())
  if (process.platform === 'darwin') tray.setTitle('🌳')
  tray.setToolTip('Kodama')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Kodama 桌宠', enabled: false },
      { type: 'separator' },
      { label: '退出 Quit', click: () => app.quit() },
    ]),
  )
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  startLocalAgentServer()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
