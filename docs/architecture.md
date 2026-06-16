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
  - Codex `exec` runner implementation
  - Codex sandbox normalization
  - non-owner scratch workspace guard
  - codex exec argument construction
  - Codex JSON progress summarization

src/runners/*.mjs
  - high-level backend runner interface
  - Codex exec, Claude Code, Coco, agent gateway, service API, and JWT-check adapters
  - backend-specific CLI/API argument construction and output parsing

src/memory-*.mjs
  - local file/JSONL memory storage
  - route-visible memory bundle selection
  - owner-only memory command policy
  - pending candidate approve/reject and route compaction
  - bounded prompt context rendering

src/project-resolver.mjs
  - repo, MR, and activity anchors for project memory routing

scripts/profile-replay.mjs
  - offline shadow-group replay for profile and memory prompts
  - fixture-based checks for PRD/Migo/design/code-map context injection
  - no Lark side effects

src/sensitive-policy.mjs
  - sensitive operation classification before the backend starts

src/session-markdown.mjs
  - session-share Markdown and table rendering

src/claude-session.mjs
  - Claude local JSONL session discovery
  - loose matching by recent session, title, project path, content, or id
  - visible transcript extraction for text and image messages

src/sender-policy.mjs
  - bot-loop and sender skip policy

src/ops-policy.mjs
  - owner ops command parsing and formatting
  - health/version report formatting
  - Codex app-server protocol preflight
```

## Execution Model

Owner or owner-approved sensitive operations use `CODEX_SANDBOX` for the Codex
backend and the equivalent runner-specific permission settings for other
backends.

Non-owner ordinary queries use `CODEX_NON_OWNER_SANDBOX` from a disposable
scratch cwd. This lets Codex inspect and diagnose while keeping writes away from
the real workspace. `danger-full-access` is never accepted for the non-owner
ordinary-query sandbox.

Sensitive non-owner requests are rejected before the backend starts and converted into
an owner approval card in the source thread.

Direct Lark tasks are routed through `createRunner(config)`. The Lark event
router, progress cards, profile policy, approval flow, and memory prompt
assembly do not need to know whether the selected backend is Codex, Claude Code,
Coco, Agent Gateway, or a generic service API.

Memory is local and opt-in. Runtime injection is route-visible and budgeted:
Base Soul, global summaries/preferences, current chat/thread memory, current
project summary, and a small number of decisions/risks. The bridge does not
inject the whole memory tree into a turn. Extracted memory is staged as
candidates first and requires explicit owner approval before it becomes chat or
project memory.

Session-share export is provider-aware. Codex sessions come from
`CODEX_HOME`; Claude sessions come from `CLAUDE_PROJECTS_ROOT`. Claude export
intentionally omits thinking blocks, tool calls, tool results, and hidden
metadata; only visible user/assistant text and images are rendered.

MR review automation has one narrow relay exception: when a known Lark bot/app
sender posts Codebase MR links and the message explicitly says it was sent by
the human本人 and only AI-polished, the bridge may run the configured review /
approve automation directly. This is limited to MR review automation; generic
file writes, deletes, deployments, bot sends, and session-share publishing still
use the normal owner approval path.

## Codex Runtime Model

The bridge no longer has a single hard-coded Codex execution model.
`CODEX_RUNTIME` selects the Codex adapter behind the existing runner interface:

- `exec`: the original one-process-per-turn `codex exec` behavior.
- `app-server`: a long-lived local app-server connection that creates one Codex
  thread per Lark context/cwd/sandbox tuple and runs turns with `turn/start`.
- `auto`: try app-server first, then fall back to `exec` if app-server startup
  or protocol calls fail.

The Lark event router still calls Codex through the generic backend runner
interface. The app-server implementation stays in `src/codex-app-server.mjs` and
does not leak into Lark event routing, profile policy, approval flow, progress
cards, or memory prompt assembly.

Startup still runs a lightweight app-server protocol preflight inspired by the
reference Feishu bridge. It verifies whether the installed Codex CLI exposes
`turn/steer` and `turn/interrupt` in generated app-server types, and reports the
result in `/health`, `/healthz`, and `doctor`.

The next deeper steps are durable session registry, `/adopt`, `/relay`, and Web
terminal support. Those should build on the app-server runner and context
binding rather than replacing the safety model.

## Oncall Binding Model

`/oncall bind <path>` maps the current `chat_id` to a local project directory in
`ONCALL_BINDINGS_FILE`. Owner requests use the bound directory as `cwd`.
Non-owner requests keep the disposable scratch cwd and non-owner sandbox, while
the bound directory is passed as the real workspace in the prompt. This borrows
Botmux's "group bound to project" workflow without giving shared-chat members
write access to the real repo.

## Refactor Rules

- Keep `lark-codex-bridge.mjs` as the packaged entrypoint until a dedicated
  `src/main.mjs` migration is planned.
- Extract pure policy and formatting first.
- Keep side-effect modules small and dependency-injected where practical.
- Add `node:test` coverage for each extracted module.
- Do not add runtime dependencies just for structure.
