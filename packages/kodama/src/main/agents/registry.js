const { claudeAgent } = require('./claude')
const { codexAgent } = require('./codex')
const { geminiAgent } = require('./gemini')
const { qwenAgent } = require('./qwen')
const { traeAgent, traeCnAgent, traeCliAgent } = require('./trae')

// Single source of truth for which local coding agents Kodama knows how to wire
// hooks into. registerLocalCliHooks iterates this list instead of hard-coding
// product names. Add a new agent by dropping a descriptor file in ./agents and
// appending it here.
const HOOK_AGENTS = [claudeAgent, codexAgent, traeAgent, traeCnAgent, traeCliAgent, geminiAgent, qwenAgent]

// Convenience lookup by agent id (e.g. 'claude', 'codex').
const HOOK_AGENTS_BY_ID = new Map(HOOK_AGENTS.map(agent => [agent.id, agent]))

module.exports = { HOOK_AGENTS, HOOK_AGENTS_BY_ID }
