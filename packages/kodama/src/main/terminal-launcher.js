const TERMINAL_LAUNCHERS = new Set(['auto', 'cmux', 'orca'])
const path = require('path')

function normalizeTerminalLauncher(value) {
  const normalized = String(value || 'auto').toLowerCase()
  return TERMINAL_LAUNCHERS.has(normalized) ? normalized : 'auto'
}

function isCmuxAppPath(appPath) {
  return /\/cmux\.app$/i.test(String(appPath || ''))
}

function isOrcaAppPath(appPath) {
  return /\/Orca\.app$/i.test(String(appPath || ''))
}

function shouldPreferOrca(launcher, foundAppPath) {
  const pref = normalizeTerminalLauncher(launcher)
  return pref === 'orca' || (pref === 'auto' && isOrcaAppPath(foundAppPath))
}

function shouldTryCmux(launcher) {
  return normalizeTerminalLauncher(launcher) !== 'orca'
}

function normalizeFsPath(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return path.normalize(text)
}

function bestTerminal(terminals, score = () => 0) {
  return [...terminals]
    .sort((a, b) => {
      const scoreDelta = score(b) - score(a)
      if (scoreDelta) return scoreDelta
      if (Boolean(a.connected) !== Boolean(b.connected)) return a.connected ? -1 : 1
      return Number(b.lastOutputAt || 0) - Number(a.lastOutputAt || 0)
    })[0] || null
}

function targetTranscriptPath(target = {}) {
  return String(target.transcriptPath || target.agentTranscriptPath || target.fallbackPath || '').trim()
}

function statusMatchesTarget(status, target = {}) {
  const sessionId = String(target.sessionId || '').trim()
  const transcriptPath = targetTranscriptPath(target)
  const providerSession = status?.providerSession || {}
  return Boolean(
    (sessionId && String(providerSession.id || '') === sessionId) ||
    (transcriptPath && String(providerSession.transcriptPath || '') === transcriptPath),
  )
}

function selectOrcaTerminal(target = {}, terminals = [], statuses = []) {
  const statusMatches = statuses
    .filter((status) => statusMatchesTarget(status, target))
    .sort((a, b) => Number(b.receivedAt || b.stateStartedAt || 0) - Number(a.receivedAt || a.stateStartedAt || 0))

  for (const status of statusMatches) {
    const matches = terminals.filter((terminal) => (
      (!status.tabId || terminal.tabId === status.tabId) &&
      (!status.leafId || terminal.leafId === status.leafId)
    ))
    const terminal = bestTerminal(matches)
    if (terminal) return { terminal, reason: 'provider-session' }
  }

  const cwd = normalizeFsPath(target.cwd)
  if (!cwd) return null

  const cwdMatches = terminals
    .map((terminal) => {
      const worktreePath = normalizeFsPath(terminal.worktreePath)
      const score = worktreePath && (cwd === worktreePath || cwd.startsWith(`${worktreePath}${path.sep}`))
        ? (cwd === worktreePath ? 2 : 1)
        : 0
      return { terminal, score }
    })
    .filter((item) => item.score > 0)

  const terminal = bestTerminal(cwdMatches.map((item) => item.terminal), (terminal) => {
    return cwdMatches.find((item) => item.terminal === terminal)?.score || 0
  })
  return terminal ? { terminal, reason: 'worktree-path' } : null
}

module.exports = {
  TERMINAL_LAUNCHERS,
  normalizeTerminalLauncher,
  isCmuxAppPath,
  isOrcaAppPath,
  shouldPreferOrca,
  shouldTryCmux,
  selectOrcaTerminal,
  statusMatchesTarget,
}
