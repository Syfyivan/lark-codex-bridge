const os = require('os')
const path = require('path')

const { CLAUDE_HOOK_EVENTS } = require('./claude')

// Descriptor for Codex's local hook registration.
//
// Conceptually Codex surfaces turn events through its `notify` program (wired in
// ~/.codex/config.toml), but Kodama registers via the same JSON `hooks` map that
// Claude uses, materialised at ~/.codex/hooks.json. We keep that existing wiring
// here verbatim (same event list, same safe-merge) so behaviour does not regress;
// `configFormat` documents that this is the JSON-hooks shape, not raw TOML.
const codexAgent = {
  id: 'codex',
  label: 'Codex hooks.json',
  hookConfig: {
    configFormat: 'codex-hooks-json',
    // Resolve ~/.codex/hooks.json. `home` is injectable for tests.
    settingsPath(home = os.homedir()) {
      return path.join(home, '.codex', 'hooks.json')
    },
    // Codex has no settings file of its own to protect, so we may create it.
    allowCreate: true,
    // Codex reuses Claude's event surface (same payload contract downstream).
    events: CLAUDE_HOOK_EVENTS,
  },
}

module.exports = { codexAgent }
