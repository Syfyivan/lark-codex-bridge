#!/usr/bin/env node
import { spawn } from 'node:child_process'
import http from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const startScript = resolve(appDir, 'scripts/start-detached.mjs')
const port = 7766
const host = '127.0.0.1'
const action = process.argv[2] || 'show'
const tokenTestAmount = Number(process.argv[3] || 1234)
const allowed = new Set(['show', 'hide', 'toggle', 'panel', 'healthz', 'tokens', 'token-test'])

function request(path, method = 'POST', body = null) {
  return new Promise((resolveRequest, reject) => {
    const payload = body ? JSON.stringify(body) : ''
    const req = http.request({
      host,
      port,
      path,
      method,
      headers: method === 'POST' ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
      timeout: 1500,
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          resolveRequest(JSON.parse(body || '{}'))
        } catch {
          resolveRequest({ ok: false, status: res.statusCode, raw: body })
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function launchDetached() {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(process.execPath, [startScript], {
      cwd: appDir,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolveLaunch()
      else reject(new Error(`start-detached exited with ${code}`))
    })
  })
}

async function waitForServer(timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return await request('/healthz', 'GET')
    } catch (err) {
      lastError = err
      await new Promise(resolveWait => setTimeout(resolveWait, 200))
    }
  }
  throw lastError || new Error('Kodama did not start')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function runTokenTest() {
  const event = await request('/pet/lark-token-test', 'POST', {
    tokens: Number.isFinite(tokenTestAmount) && tokenTestAmount > 0 ? Math.round(tokenTestAmount) : 1234,
    text: 'Feishu token ledger test',
  })
  await sleep(500)
  const stats = await request('/pet/token-stats', 'GET')
  return { ...event, tokenStats: stats }
}

async function main() {
  if (!allowed.has(action)) {
    throw new Error(`unknown action "${action}". Use one of: ${Array.from(allowed).join(', ')}`)
  }

  try {
    const result = action === 'healthz'
      ? await request('/healthz', 'GET')
      : action === 'tokens'
        ? await request('/pet/token-stats', 'GET')
        : action === 'token-test'
          ? await runTokenTest()
      : await request(`/pet/${action}`)
    console.log(JSON.stringify(result))
    return
  } catch (err) {
    if (!['show', 'panel', 'tokens', 'token-test'].includes(action)) throw err
  }

  await launchDetached()
  await waitForServer()
  const result = action === 'panel'
    ? await request('/pet/panel')
    : action === 'tokens'
      ? await request('/pet/token-stats', 'GET')
      : action === 'token-test'
        ? await runTokenTest()
        : await request('/pet/show')
  console.log(JSON.stringify({ ...result, launched: true }))
}

main().catch((err) => {
  console.error(`[kodama] ${err.message}`)
  process.exitCode = 1
})
