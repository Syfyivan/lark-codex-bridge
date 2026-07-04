const os = require('os')
const path = require('path')

// Trae's desktop hook JSON currently exposes the core lifecycle surface. The
// Trae/Coco CLI TOML surface is richer and matches the Claude-like hook names.
const TRAE_CORE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]

const TRAE_CLI_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd',
]

function toolMatcher(event) {
  return /^PreToolUse|PostToolUse|PostToolUseFailure$/.test(event) ? '*' : ''
}

const traeAgent = {
  id: 'trae',
  label: 'Trae hooks.json',
  hookConfig: {
    configFormat: 'trae-hooks-json',
    settingsPath(home = os.homedir()) {
      return path.join(home, '.trae', 'hooks.json')
    },
    allowCreate: true,
    optional: true,
    events: TRAE_CORE_HOOK_EVENTS,
    matcherForEvent: toolMatcher,
  },
}

const traeCnAgent = {
  id: 'trae-cn',
  label: 'Trae CN hooks.json',
  hookConfig: {
    configFormat: 'trae-hooks-json',
    settingsPath(home = os.homedir()) {
      return path.join(home, '.trae-cn', 'hooks.json')
    },
    allowCreate: true,
    optional: true,
    events: TRAE_CORE_HOOK_EVENTS,
    matcherForEvent: toolMatcher,
  },
}

const traeCliAgent = {
  id: 'trae-cli',
  label: 'Trae Work CLI traecli.toml',
  hookConfig: {
    configFormat: 'trae-cli-toml',
    settingsPath(home = os.homedir()) {
      return path.join(home, '.trae', 'traecli.toml')
    },
    allowCreate: false,
    optional: true,
    events: TRAE_CLI_HOOK_EVENTS,
  },
}

module.exports = {
  traeAgent,
  traeCnAgent,
  traeCliAgent,
  TRAE_CORE_HOOK_EVENTS,
  TRAE_CLI_HOOK_EVENTS,
}
