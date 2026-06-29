const os = require('os')
const path = require('path')

// Hook events Kodama wires into Claude Code. Mirrors the richer surface Flux
// Island listens to; the renderer-side filtering stays narrow so we don't spam
// every tool call. Keep this list in sync with mapHookToEvent in hook-events.js.
const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PermissionDenied',
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

// Descriptor for Claude Code's local hook registration. `hookConfig` carries
// everything registerLocalCliHooks needs to safely merge the Kodama hook into
// the user's settings file without hard-coding Claude specifics.
const claudeAgent = {
  id: 'claude',
  label: 'Claude Code settings.json',
  hookConfig: {
    // JSON `hooks` map keyed by event name (the native Claude settings format).
    configFormat: 'claude-settings',
    // Resolve ~/.claude/settings.json. `home` is injectable for tests.
    settingsPath(home = os.homedir()) {
      return path.join(home, '.claude', 'settings.json')
    },
    // Never create Claude's settings.json from scratch — only augment an existing one.
    allowCreate: false,
    events: CLAUDE_HOOK_EVENTS,
  },
}

module.exports = { claudeAgent, CLAUDE_HOOK_EVENTS }
