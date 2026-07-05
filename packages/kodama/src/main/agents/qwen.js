const os = require('os')
const path = require('path')

// Qwen Code intentionally mirrors Claude-like hook events, but its settings
// path and app label are distinct. Keep this descriptor separate so the tray
// installer can skip Qwen cleanly when ~/.qwen is absent.
const QWEN_HOOK_EVENTS = [
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
  'TodoCompleted',
]

function matcherForEvent(event) {
  return /^(PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest|SubagentStart|SubagentStop|SessionStart|SessionEnd|PreCompact|PostCompact|Notification)$/.test(event) ? '*' : ''
}

const qwenAgent = {
  id: 'qwen',
  label: 'Qwen Code settings.json',
  hookConfig: {
    configFormat: 'qwen-settings-json',
    settingsPath(home = os.homedir()) {
      return path.join(home, '.qwen', 'settings.json')
    },
    allowCreate: true,
    optional: true,
    endpointPath: '/hooks/qwen',
    jsonAck: true,
    events: QWEN_HOOK_EVENTS,
    matcherForEvent,
  },
}

module.exports = { qwenAgent, QWEN_HOOK_EVENTS }
