# Lark Codex Bridge Architecture

This bridge is intentionally small, but the runtime should not keep growing as
one monolithic script. The entrypoint owns wiring and lifecycle; modules own
testable policy and execution details.

## Current Boundaries

```text
lark-codex-bridge.mjs
  - CLI/env loading
  - Lark event routing
  - approval card orchestration
  - session-share workflow
  - HTTP health/task endpoints

src/process-manager.mjs
  - child process execution with timeout and output capture

src/codex-runner.mjs
  - Codex sandbox normalization
  - non-owner scratch workspace guard
  - codex exec argument construction
  - Codex JSON progress summarization

src/sensitive-policy.mjs
  - sensitive operation classification before Codex starts

src/session-markdown.mjs
  - session-share Markdown and table rendering

src/sender-policy.mjs
  - bot-loop and sender skip policy
```

## Execution Model

Owner or owner-approved sensitive operations use `CODEX_SANDBOX`.

Non-owner ordinary queries use `CODEX_NON_OWNER_SANDBOX` from a disposable
scratch cwd. This lets Codex inspect and diagnose while keeping writes away from
the real workspace. `danger-full-access` is never accepted for the non-owner
ordinary-query sandbox.

Sensitive non-owner requests are rejected before Codex starts and converted into
an owner approval card in the source thread.

## Cold Start Roadmap

The current runtime still launches `codex exec` per turn. That is simple and
robust, but each turn pays process startup and session bootstrap cost.

The next performance step is a separate Codex runtime module that can choose
between:

- `exec`: current one-process-per-turn behavior.
- `app-server`: start Codex app-server, then use `thread/start`,
  `thread/resume`, and `turn/steer` JSON-RPC calls for lower-latency follow-up
  turns.

Do not wire app-server directly into the Lark event router. First add a
`src/codex-app-server.mjs` adapter behind the same high-level runner interface,
then switch by config after tests cover startup, timeout, stop, and fallback to
`exec`.

## Refactor Rules

- Keep `lark-codex-bridge.mjs` as the packaged entrypoint until a dedicated
  `src/main.mjs` migration is planned.
- Extract pure policy and formatting first.
- Keep side-effect modules small and dependency-injected where practical.
- Add `node:test` coverage for each extracted module.
- Do not add runtime dependencies just for structure.
