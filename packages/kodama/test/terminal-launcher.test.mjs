import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTerminalLauncher,
  isCmuxAppPath,
  isOrcaAppPath,
  selectOrcaTerminal,
  shouldPreferOrca,
  shouldTryCmux,
  statusMatchesTarget,
} from '../src/main/terminal-launcher.js'

test('terminal launcher preference normalizes to a safe default', () => {
  assert.equal(normalizeTerminalLauncher('orca'), 'orca')
  assert.equal(normalizeTerminalLauncher('ORCA'), 'orca')
  assert.equal(normalizeTerminalLauncher('cmux'), 'cmux')
  assert.equal(normalizeTerminalLauncher('warp'), 'auto')
  assert.equal(normalizeTerminalLauncher(''), 'auto')
})

test('terminal host detection recognizes cmux and Orca app paths', () => {
  assert.equal(isOrcaAppPath('/Applications/Orca.app'), true)
  assert.equal(isOrcaAppPath('/Applications/Orca.app/Contents/MacOS/Orca'), false)
  assert.equal(isCmuxAppPath('/Users/me/Applications/cmux.app'), true)
  assert.equal(isCmuxAppPath('/Applications/Orca.app'), false)
})

test('auto prefers Orca only when the live agent host is Orca', () => {
  assert.equal(shouldPreferOrca('auto', '/Applications/Orca.app'), true)
  assert.equal(shouldPreferOrca('auto', '/Applications/Terminal.app'), false)
  assert.equal(shouldPreferOrca('cmux', '/Applications/Orca.app'), false)
  assert.equal(shouldPreferOrca('orca', ''), true)
})

test('Orca preference disables cmux fallback', () => {
  assert.equal(shouldTryCmux('auto'), true)
  assert.equal(shouldTryCmux('cmux'), true)
  assert.equal(shouldTryCmux('orca'), false)
})

test('Orca terminal selection prefers provider session identity', () => {
  const terminals = [
    {
      handle: 'term_old',
      tabId: 'tab-old',
      leafId: 'leaf-old',
      worktreePath: '/repo',
      connected: true,
      lastOutputAt: 20,
    },
    {
      handle: 'term_exact',
      tabId: 'tab-exact',
      leafId: 'leaf-exact',
      worktreePath: '/repo',
      connected: true,
      lastOutputAt: 1,
    },
  ]
  const statuses = [
    {
      tabId: 'tab-exact',
      leafId: 'leaf-exact',
      providerSession: {
        id: 'claude-session',
        transcriptPath: '/Users/me/.claude/projects/session.jsonl',
      },
      receivedAt: 100,
    },
  ]
  const match = selectOrcaTerminal({
    sessionId: 'claude-session',
    fallbackPath: '/Users/me/.claude/projects/session.jsonl',
    cwd: '/repo',
  }, terminals, statuses)
  assert.equal(match?.terminal.handle, 'term_exact')
  assert.equal(match?.reason, 'provider-session')
})

test('Orca terminal selection falls back to the best worktree path match', () => {
  const terminals = [
    {
      handle: 'term_parent',
      worktreePath: '/repo',
      connected: true,
      lastOutputAt: 1,
    },
    {
      handle: 'term_other',
      worktreePath: '/other',
      connected: true,
      lastOutputAt: 100,
    },
  ]
  const match = selectOrcaTerminal({
    cwd: '/repo/packages/kodama',
  }, terminals, [])
  assert.equal(match?.terminal.handle, 'term_parent')
  assert.equal(match?.reason, 'worktree-path')
})

test('Orca provider session matching accepts session id or transcript path', () => {
  const status = {
    providerSession: {
      id: 'session-a',
      transcriptPath: '/tmp/session-a.jsonl',
    },
  }
  assert.equal(statusMatchesTarget(status, { sessionId: 'session-a' }), true)
  assert.equal(statusMatchesTarget(status, { fallbackPath: '/tmp/session-a.jsonl' }), true)
  assert.equal(statusMatchesTarget(status, { sessionId: 'session-b', fallbackPath: '/tmp/other.jsonl' }), false)
})
