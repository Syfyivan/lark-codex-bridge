const fs = require('fs')
const os = require('os')
const path = require('path')

function cleanTitle(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function defaultIndexPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.codex', 'session_index.jsonl')
}

function readCodexSessionTitles(indexPath, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync
  const titles = new Map()
  let text = ''
  try {
    text = readFileSync(indexPath, 'utf8')
  } catch {
    return titles
  }
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const item = JSON.parse(trimmed)
      const id = cleanTitle(item?.id || item?.session_id || item?.sessionId, 120)
      const title = cleanTitle(item?.thread_name || item?.threadName || item?.title)
      if (id && title) titles.set(id, title)
    } catch {
      /* ignore malformed jsonl rows */
    }
  }
  return titles
}

function createCodexSessionTitleResolver(options = {}) {
  const indexPath = options.indexPath || defaultIndexPath(options.homeDir)
  const statSync = options.statSync || fs.statSync
  let stamp = ''
  let cache = new Map()

  function refreshIfNeeded() {
    let nextStamp = 'missing'
    try {
      const stat = statSync(indexPath)
      nextStamp = `${stat.mtimeMs}:${stat.size}`
    } catch {
      nextStamp = 'missing'
    }
    if (nextStamp === stamp) return
    stamp = nextStamp
    cache = readCodexSessionTitles(indexPath, options)
  }

  return function resolveCodexSessionTitle(sessionId) {
    const id = cleanTitle(sessionId, 120)
    if (!id) return ''
    refreshIfNeeded()
    return cache.get(id) || ''
  }
}

module.exports = {
  cleanTitle,
  createCodexSessionTitleResolver,
  defaultIndexPath,
  readCodexSessionTitles,
}
