const os = require('os')
const path = require('path')

// Gemini CLI has its own hook event names. Keep the high-signal lifecycle and
// tool events only; renderer-side mapping still filters noisy tool calls.
const GEMINI_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'BeforeAgent',
  'AfterAgent',
  'BeforeTool',
  'AfterTool',
  'PreCompress',
  'Notification',
]

function matcherForEvent(event) {
  return /^(BeforeTool|AfterTool|SessionStart|SessionEnd|PreCompress|Notification)$/.test(event) ? '*' : ''
}

const geminiAgent = {
  id: 'gemini',
  label: 'Gemini CLI settings.json',
  hookConfig: {
    configFormat: 'gemini-settings-json',
    settingsPath(home = os.homedir()) {
      return path.join(home, '.gemini', 'settings.json')
    },
    allowCreate: true,
    optional: true,
    endpointPath: '/hooks/gemini',
    jsonAck: true,
    events: GEMINI_HOOK_EVENTS,
    matcherForEvent,
  },
}

module.exports = { geminiAgent, GEMINI_HOOK_EVENTS }
