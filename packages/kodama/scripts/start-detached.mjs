#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 7766

function portOpen(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolvePort) => {
    const socket = connect({ port, host })
    const done = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolvePort(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

function electronAppFromBinary(bin) {
  const marker = '/Contents/MacOS/Electron'
  if (!bin.endsWith(marker)) return ''
  return bin.slice(0, -marker.length)
}

async function main() {
  if (await portOpen(PORT)) {
    console.error(`[kodama] already listening on 127.0.0.1:${PORT}`)
    return
  }

  const electronBin = require('electron')
  let child
  if (process.platform === 'darwin') {
    const electronApp = electronAppFromBinary(electronBin)
    if (!electronApp || !existsSync(electronApp)) {
      throw new Error(`cannot resolve Electron.app from ${electronBin}`)
    }
    child = spawn('open', ['-n', electronApp, '--args', appDir], {
      detached: true,
      stdio: 'ignore',
    })
  } else {
    child = spawn(electronBin, [appDir], {
      detached: true,
      stdio: 'ignore',
    })
  }
  child.unref()
  console.error(`[kodama] launched detached from ${appDir}`)
}

main().catch((err) => {
  console.error(`[kodama] detached launch failed: ${err.message}`)
  process.exitCode = 1
})
