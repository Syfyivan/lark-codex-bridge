const TERMINAL_LAUNCHERS = new Set(['auto', 'cmux', 'orca'])

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

module.exports = {
  TERMINAL_LAUNCHERS,
  normalizeTerminalLauncher,
  isCmuxAppPath,
  isOrcaAppPath,
  shouldPreferOrca,
  shouldTryCmux,
}
