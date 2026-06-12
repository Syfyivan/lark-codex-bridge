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
  - HTTP health/task/session-share endpoints

src/process-manager.mjs
  - child process execution with timeout and output capture

src/codex-runner.mjs
  - Codex runner interface
  - current `exec` runner implementation
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

src/ops-policy.mjs
  - owner ops command parsing and formatting
  - health/version report formatting
  - Codex app-server protocol preflight
```

## Execution Model

Owner or owner-approved sensitive operations use `CODEX_SANDBOX`.

Non-owner ordinary queries use `CODEX_NON_OWNER_SANDBOX` from a disposable
scratch cwd. This lets Codex inspect and diagnose while keeping writes away from
the real workspace. `danger-full-access` is never accepted for the non-owner
ordinary-query sandbox.

Sensitive non-owner requests are rejected before Codex starts and converted into
an owner approval card in the source thread.

MR review automation has one narrow relay exception: when a known Lark bot/app
sender posts Codebase MR links and the message explicitly says it was sent by
the human本人 and only AI-polished, the bridge may run the configured review /
approve automation directly. This is limited to MR review automation; generic
file writes, deletes, deployments, bot sends, and session-share publishing still
use the normal owner approval path.

## Cold Start Roadmap

The current runtime still launches `codex exec` per turn. That is simple and
robust, but each turn pays process startup and session bootstrap cost.

Startup now runs a lightweight app-server protocol preflight inspired by the
reference Feishu bridge: it verifies whether the installed Codex CLI exposes
`turn/steer` and `turn/interrupt` in generated app-server types. This is
reported in `/health`, `/healthz`, and `doctor`; it does not change execution
behavior.

The Lark event router now calls Codex through a small runner object. The only
production runner is still `exec`, but this keeps future `app-server` work out
of the Lark routing and approval code.

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
