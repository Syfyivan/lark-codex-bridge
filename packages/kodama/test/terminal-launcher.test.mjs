import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTerminalLauncher,
  isCmuxAppPath,
  isOrcaAppPath,
  shouldPreferOrca,
  shouldTryCmux,
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
