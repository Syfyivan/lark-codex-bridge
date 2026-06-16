# Lark Codex Bridge

A local Node.js bridge that connects Lark/Feishu bot events to an AI backend
runner. The default runner is `codex exec`, and the same event/progress/reply
flow can also target Claude Code, Coco, Agent Gateway, or a generic API. It can
also expose a small HTTP API for local automation.

The bridge is designed for a personal or team bot:

```text
Lark bot event -> lark-cli -> backend runner -> Lark reply or progress card
```

## Features

- Listen to Lark bot events through `lark-cli event +subscribe`.
- Reply only when the bot is mentioned in a group, unless configured otherwise.
- Run Codex through `codex exec`, a persistent app-server connection, or
  `auto` fallback mode.
- Select first-class backend runners with `BRIDGE_BACKEND=codex|claude|coco|agent|api`.
- Show an interactive progress card while the selected backend is working.
- Replace the progress card with the final answer when the task finishes.
- Record safe bridge task timelines and export a visual Task Session Viewer.
- Render final answers with card Markdown so fenced code blocks display cleanly.
- Find local Codex sessions and generate snapshot links from a card button.
- Owner-only ops commands for health, version, and log tail checks from Lark.
- Per-chat direct backend task queue with `/queue` and owner-only `/stop`.
- Bind oncall chats to local project directories with owner-only `/oncall bind`.
- Optional profile/capability policy so configured chats can restrict what
  non-owners may ask Codex to do before a Codex process is started.
- Optional layered Soul/Memory MVP with chat/thread/project/global storage and
  owner-only `/remember` commands.
- Optional delegated-user approval flow for messages that mention another user.
- Optional local HTTP endpoints: `POST /v1/codex/tasks` and
  `POST /v1/codex/session-shares`.
- Optional generic service/JWT and API gateway modes for custom backends.

## Requirements

- Node.js 20 or newer.
- `lark-cli` configured with a bot app.
- The selected backend CLI available on `PATH`, or set its binary option:
  `CODEX_BIN`, `CLAUDE_CODE_BIN`, or `BYTEDCLI_BIN`.

Required Lark bot scopes depend on which features you enable. A minimal Codex
reply bot usually needs:

```text
im:message.group_at_msg:readonly
im:message.p2p_msg:readonly
im:message:send_as_bot
```

For interactive progress cards and approval buttons, also subscribe to:

```text
im.message.receive_v1
card.action.trigger
```

## Quick Start

The easiest path is to run the bridge directly from GitHub. This does not
require a published npm package.

Use a dedicated run directory so your `.env`, token files, logs, and generated
session-share pages stay separate from other projects:

```bash
mkdir -p ~/lark-codex-bridge-run
cd ~/lark-codex-bridge-run

npm exec --yes --package github:Syfyivan/lark-codex-bridge#main -- lark-codex-bridge init
nano .env
npm exec --yes --package github:Syfyivan/lark-codex-bridge#main -- lark-codex-bridge doctor
npm exec --yes --package github:Syfyivan/lark-codex-bridge#main -- lark-codex-bridge
```

`npm exec` downloads a temporary copy each time. If you want a stable command for
long-running usage, install it globally from GitHub:

```bash
npm install -g github:Syfyivan/lark-codex-bridge#main

mkdir -p ~/lark-codex-bridge-run
cd ~/lark-codex-bridge-run

lark-codex-bridge init
nano .env
lark-codex-bridge doctor
lark-codex-bridge
```

To update a global GitHub install later, reinstall it:

```bash
npm install -g github:Syfyivan/lark-codex-bridge#main
```

Only run one bridge process for each Lark/Feishu bot app. `lark-cli` allows a
single active `event +subscribe` consumer per app to avoid competing message
handlers. If you already run the bridge as a background service, do not start a
second foreground copy for the same app.

For local development from this repository:

```bash
cp .env.example .env
nano .env
npm run check
npm test
node lark-codex-bridge.mjs
```

## Project Layout

```text
lark-codex-bridge.mjs   CLI entrypoint, Lark event loop, backend execution, HTTP API
docs/architecture.md    Runtime boundaries and Codex cold-start roadmap
src/codex-runner.mjs    Codex exec runner, sandbox policy, scratch guard
src/claude-session.mjs  Claude local session lookup and visible transcript parsing
src/context-queue.mjs   Per-chat/thread backend task queue and stop cancellation state
src/env.mjs             Environment parsing and option normalization
src/lark-format.mjs     Lark reply formatting helpers
src/memory-*.mjs        Layered Soul/Memory storage, routing, policy, prompt helpers
src/process-manager.mjs Child process execution helper
src/profile-policy.mjs  Optional profile/capability policy helpers
src/project-resolver.mjs Project anchor detection for shared project memory
src/runners/*.mjs       Backend runner adapters for Codex, Claude, Coco, agent, API
src/sender-policy.mjs   Sender filtering and bot-loop policy
src/sensitive-policy.mjs Sensitive operation classification
src/session-markdown.mjs Session-share Markdown rendering
test/*.test.mjs         Node.js unit tests for extracted bridge policy helpers
```

The entrypoint still owns the runtime workflow, while reusable pure logic lives
under `src/`. Keep new policy or formatting behavior in small modules when it
can be tested without starting `lark-cli`, Codex, or the HTTP server.

Recommended local verification before pushing:

```bash
npm run check
npm test
npm run pack:dry
```

For a local HTTP-only smoke test:

```bash
BRIDGE_MODE=codex \
BRIDGE_EVENT_ENABLED=0 \
BRIDGE_HTTP_HOST=127.0.0.1 \
BRIDGE_HTTP_PORT=8787 \
CODEX_BIN=codex \
CODEX_CWD="$PWD" \
CODEX_SANDBOX=read-only \
npm exec --yes --package github:Syfyivan/lark-codex-bridge#main -- lark-codex-bridge
```

Then:

```bash
curl http://127.0.0.1:8787/healthz
```

If `BRIDGE_HTTP_TOKEN` or `BRIDGE_HTTP_TOKEN_FILE` is configured, task requests
must include:

```text
Authorization: Bearer <token>
```

Example task request:

```bash
curl -sS http://127.0.0.1:8787/v1/codex/tasks \
  -H 'Content-Type: application/json' \
  -d '{"source":"local-test","prompt":"Reply with one short sentence."}'
```

Example session-share lookup or export request:

```bash
TOKEN="$(cat ~/.lark-codex-bridge-http-token)"

curl -sS http://127.0.0.1:8787/v1/codex/session-shares \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"019eb645-44a8-7df2-8221-0366d880dd80","find_only":true}'
```

Set `find_only` to `false` or omit it to export using the configured
`SESSION_SHARE_OUTPUT`.

## Troubleshooting

If startup fails with:

```text
another event +subscribe instance is already running for app cli_xxx
```

another bridge or `lark-cli event +subscribe` process is already consuming
events for the same bot app. Stop the existing process before starting a new
one, or keep using the existing bridge instance.

For a foreground terminal run, press `Ctrl-C` in the terminal that started it.
For a macOS LaunchAgent, unload it with:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.example.lark-codex-bridge.plist
```

Then start the new copy, or reload the LaunchAgent after updating its
configuration.

## Important Options

```text
BRIDGE_BACKEND=codex              # codex | claude | coco | agent | api | jwt-check
BRIDGE_MODE=codex                 # backward-compatible alias when BRIDGE_BACKEND is empty
BRIDGE_EVENT_ENABLED=1            # listen to Lark events
BRIDGE_HTTP_HOST=127.0.0.1
BRIDGE_HTTP_PORT=8787             # 0 disables the HTTP server unless events are on
BRIDGE_HTTP_TOKEN_FILE=/path/to/token

LARK_CLI_BIN=lark-cli
LARK_EVENT_TYPES=im.message.receive_v1,card.action.trigger

BOT_OPEN_ID=ou_xxx
BOT_MENTION_NAMES=Codex Bot
REQUIRE_MENTION_IN_GROUP=1
BRIDGE_REPLY_MARKDOWN=1           # send normal replies as Lark post Markdown
BOT_SEND_COMMANDS=/bot-send,/send-bot,发给机器人
BOT_SEND_TARGET_OPEN_IDS=         # optional aliases, such as 知微=ou_xxx
BOT_SEND_TARGET_APP_IDS=          # app-id hints only; real @ still needs open_id
BOT_SEND_ALLOW_PLAINTEXT_MENTION=0

LOOP_MAX_TURNS=3                  # cap bridge_trace bot-to-bot turns
LOOP_RESPOND_TO_BOT_SENDERS=0     # ignore bot senders unless they explicitly @ this bot/delegate
LOOP_BOT_SENDER_IDS=
LOOP_BOT_ALLOW_SENDER_IDS=        # optional bot sender allowlist for relay/canary tests
LOOP_REQUIRE_TRACE_FROM_BOT_SENDERS=0
LOOP_IGNORE_SENDER_IDS=
LOOP_ALLOW_SENDER_IDS=

CONTEXT_QUEUE_ENABLED=1           # serialize direct backend tasks per chat/thread
ONCALL_BINDINGS_FILE=~/.lark-codex-bridge/oncall-bindings.json
PROFILE_POLICY_ENABLED=0          # enable profile/capability gate before direct backend runs
PROFILE_CONFIG_FILE=~/.lark-codex-bridge/profiles.json

CODEX_BIN=codex
CODEX_CWD=/path/to/workspace
CODEX_SANDBOX=read-only           # owner / approved sensitive operations use this sandbox
CODEX_NON_OWNER_SANDBOX=workspace-write  # non-owner ordinary queries run in a disposable scratch cwd
CODEX_NON_OWNER_SCRATCH_ROOT=     # defaults to the OS temp directory
CODEX_MODEL=
CODEX_RUNTIME=auto                # exec | app-server | auto
CODEX_APP_SERVER_START_TIMEOUT_MS=10000
CODEX_APP_SERVER_REQUEST_TIMEOUT_MS=30000
CODEX_TIMEOUT_MS=600000
CODEX_EPHEMERAL=1

CLAUDE_CODE_BIN=claude
CLAUDE_CODE_OUTPUT_FORMAT=json    # json | stream-json | text
CLAUDE_CODE_PERMISSION_MODE=plan  # keep write-capable modes owner/approval-gated
CLAUDE_CODE_MAX_TURNS=3
CLAUDE_CODE_NO_SESSION_PERSISTENCE=1
CLAUDE_CODE_TIMEOUT_MS=600000
CLAUDE_CODE_EXTRA_ARGS=

COCO_RUN_MODE=chat                # chat | task
COCO_REPO_ID=
COCO_COMMIT_ID=
COCO_BRANCH=
COCO_MERGE_REQUEST_NUMBER=
COCO_TASK_WAIT=0                  # task mode returns after submit unless enabled
COCO_TASK_SUBSCRIBE=1
COCO_TIMEOUT_MS=600000
COCO_TASK_WAIT_TIMEOUT_MS=1200000

CLAUDE_HOME=~/.claude
CLAUDE_PROJECTS_ROOT=~/.claude/projects

MEMORY_ENABLED=0
MEMORY_ROOT_DIR=~/.lark-codex-bridge/memory
SOULS_DIR=~/.lark-codex-bridge/souls
BASE_SOUL_FILE=~/.lark-codex-bridge/souls/base.md
MEMORY_PROMPT_BUDGET_CHARS=12000
MEMORY_DEFAULT_PROJECT_ID=
MEMORY_AUTO_THREAD_SUMMARY=0
MEMORY_THREAD_MAX_CHARS=20000
MEMORY_EXTRACTOR_ENABLED=0
MEMORY_PENDING_LIMIT=20
MEMORY_COMPACT_MAX_TEXT_CHARS=20000
MEMORY_COMPACT_MAX_JSONL_RECORDS=100

PROGRESS_CARD_ENABLED=1
PROGRESS_CARD_UPDATE_INTERVAL_MS=8000
PROGRESS_CARD_MAX_ITEMS=8
PROGRESS_CARD_FINAL_REPLY=0       # final answer stays in the card

SESSION_SHARE_ENABLED=1
SESSION_SHARE_OUTPUT=goofy              # goofy deploys snapshots to Goofy Preview; web uses local 10.* links
SESSION_SHARE_STORE_DIR=~/.lark-codex-bridge/session-shares
SESSION_SHARE_GOOFY_ALIAS=codex-session-shares-syf
SESSION_SHARE_GOOFY_DESCRIPTION="Codex session share snapshots"
SESSION_SHARE_GOOFY_EXPIRY_DAYS=365
SESSION_SHARE_GOOFY_TIMEOUT_MS=180000
BYTEDCLI_BIN=bytedcli
SESSION_SHARE_REPLY_STYLE=card

TASK_VIEWER_ENABLED=1
TASK_VIEWER_STORE_DIR=~/.lark-codex-bridge/task-runs
TASK_VIEWER_MAX_TASKS=200
TASK_VIEWER_GOOFY_ALIAS=bridge-task-viewer-syf
TASK_VIEWER_GOOFY_DESCRIPTION="Bridge Task Session Viewer"
TASK_VIEWER_GOOFY_EXPIRY_DAYS=365
TASK_VIEWER_GOOFY_TIMEOUT_MS=180000
```

## Owner Ops Commands

The owner can mention the bot in a group, or message it directly, with:

```text
/health
/version
/logs 40
/ops health
/stop
```

`/health` includes the configured sandbox modes, session-share output, selected
backend runner, profile policy status, memory status, and direct task queue
counts. For the Codex backend it also includes a startup preflight for
app-server `turn/steer` and `turn/interrupt` protocol support. That preflight is
readiness information for the lower-latency app-server runtime.

When `CONTEXT_QUEUE_ENABLED=1`, direct backend tasks are serialized per chat or
thread. A normal new request in the same context waits for the current backend
task to finish. Use `/queue <message>` to explicitly append a follow-up request
to the same context queue. Use `/stop` as a bridge owner to abort the active
Codex child process for the current context and clear pending queued tasks.

## Oncall Chat Binding

The bridge can bind a Lark chat or topic to a local project directory, inspired
by Botmux-style oncall groups:

```text
/oncall bind /path/to/project
/oncall status
/oncall unbind
```

Only a bridge owner can bind or unbind. Once bound, owner requests in that chat
run with the bound directory as `cwd`. Non-owner requests still run in a
disposable scratch directory with `CODEX_NON_OWNER_SANDBOX`; the bound project
is only exposed in the prompt as the real workspace to inspect. This keeps the
oncall convenience without letting shared-chat members mutate the real repo
without approval.

## Profile Capability Policy

The profile policy is optional. It is disabled unless
`PROFILE_POLICY_ENABLED=1` or `PROFILE_CONFIG_FILE` is set. When enabled, the
bridge evaluates direct backend requests against `profiles.json` before starting
the runner. This is intentionally a lightweight subset of the internal
`codex-feishu-bridge` model: no Bun, no business catalog, and no skill injection.

Minimal example:

```json
{
  "version": 1,
  "authority": {
    "owners": ["ou_owner_open_id"],
    "ownerBypassesCapabilities": true
  },
  "defaults": {
    "groupBehavior": "ignore",
    "p2pProfile": "direct"
  },
  "profiles": {
    "direct": {
      "id": "direct",
      "name": "Direct Codex",
      "soul": "你是个人 Codex 助手。",
      "capabilities": [
        {
          "id": "chat",
          "name": "普通对话",
          "description": "回答一般问题。",
          "kind": "chat",
          "safeForMembers": true,
          "match": [".*"]
        }
      ]
    },
    "ops_readonly": {
      "id": "ops_readonly",
      "name": "只读运维问答",
      "soul": "只处理本群允许的只读查询。",
      "denyMessage": "这个群没有授权处理这类请求。",
      "capabilities": [
        {
          "id": "docs",
          "name": "文档查询",
          "description": "只读查询和总结文档。",
          "kind": "chat",
          "effect": "read",
          "safeForMembers": true,
          "match": ["文档", "查一下", "总结"],
          "allowedOpenIds": ["ou_member_open_id"],
          "allowedChats": ["oc_group_chat_id"]
        }
      ]
    }
  },
  "chats": {
    "oc_group_chat_id": { "profile": "ops_readonly" }
  }
}
```

Configured `authority.owners` are treated as bridge owners for direct execution,
ops commands, and `/stop`. Approval-card clicks still use
`DELEGATE_APPROVER_OPEN_ID`, so enabling profile owners does not silently change
who can approve existing delegated requests.

Profiles may use either inline `soul` text or `soulFile`. Relative `soulFile`
paths are resolved from the directory containing `profiles.json` and must stay
under its `souls/` subdirectory.

## Backend Runners

`BRIDGE_BACKEND` selects the runner used by direct Lark tasks and local task API
requests. If it is empty, `BRIDGE_MODE` is still accepted for older `.env`
files.

- `codex`: uses `CODEX_RUNTIME`:
  - `exec` runs one `codex exec` process per turn with the existing sandbox,
    cwd, model, timeout, and ephemeral-session behavior.
  - `app-server` starts a local Codex app-server client, creates one Codex
    thread per Lark context/cwd/sandbox tuple, and uses `turn/start` plus
    `turn/interrupt`.
  - `auto` tries app-server first and falls back to `exec` if app-server is
    unavailable.
- `claude`: runs Claude Code as a first-class CLI adapter with `claude -p`,
  configurable output format, permission mode, max turns, timeout, and optional
  `--no-session-persistence`.
- `coco`: runs `bytedcli coco` as a Coco-specific adapter. `COCO_RUN_MODE=chat`
  uses `coco chat --no-stream`; `COCO_RUN_MODE=task` submits a Coco task and can
  optionally subscribe/wait for completion.
- `agent`: mints a service JWT and calls `AGENT_GATEWAY_URL`.
- `api`: mints a service JWT and calls `SERVICE_API_URL`.
- `tae`: compatibility alias for the agent runner using `TAE_AGENT_URL`.
- `jwt-check`: only checks the service JWT flow and returns token metadata.

Claude Code and Coco are not treated as `CODEX_BIN` replacements because their
CLI flags, permission controls, output formats, and session/task semantics are
different. Keep write-capable Claude permission modes and Coco task mode behind
the existing owner/sensitive-operation gates.

## Soul / Memory MVP

Memory is disabled by default. Enable it with `MEMORY_ENABLED=1`. The current
MVP uses local files only and injects a bounded prompt context before the user
request:

```text
~/.lark-codex-bridge/
  souls/base.md
  memory/global/preferences.md
  memory/global/business-summary.md
  memory/projects/<project_id>/shared-summary.md
  memory/projects/<project_id>/decisions.jsonl
  memory/projects/<project_id>/risks.jsonl
  memory/chats/<chat_id>/summary.md
  memory/chats/<chat_id>/decisions.jsonl
  memory/chats/<chat_id>/pending.jsonl
  memory/chats/<chat_id>/memory-candidates.jsonl
  memory/threads/<chat_id>/<thread_id>.md
```

The bridge reads Base Soul, global summaries/preferences, the current chat
summary, the current thread file, the resolved project summary, and a small
number of recent decisions/risks. It never injects the whole memory tree.
`MEMORY_PROMPT_BUDGET_CHARS` defaults to `12000`; when the bundle is too large,
higher-priority entries are kept first.

Owner-only commands:

```text
/memory
/project-memory
/remember <chat memory>
/remember-project <project decision>
/remember-global <global preference>
/memory-pending
/memory-approve <id|all>
/memory-reject <id|all>
/memory-compact [thread|chat|project|global]
```

Project memory is selected from repo/MR/activity anchors in the message, or from
`MEMORY_DEFAULT_PROJECT_ID`. Automatic thread recording is off unless
`MEMORY_AUTO_THREAD_SUMMARY=1`, and the MVP only auto-records owner turns. Treat
cross-chat/global/Base Soul changes as policy changes: review them before
enabling broader automation.

When `MEMORY_EXTRACTOR_ENABLED=1`, lines beginning with `决定:`, `风险:`,
`待办:`, or `问题:` in the user/assistant turn are stored as
`memory-candidates.jsonl` instead of being applied immediately. Use
`/memory-pending` to inspect candidates, then approve or reject them explicitly.
Approval writes decisions/risks/pending/open-questions to the current chat or
resolved project scope.

## Profile Replay

Use `scripts/profile-replay.mjs` to test a profile with shadow product-group
context without sending messages to a real Lark group. A fixture can include
`profiles.json`, Base Soul, chat summary, thread summary, project memory,
decisions, risks, and open questions.

```bash
node scripts/profile-replay.mjs \
  --fixture test/fixtures/profile-replay/product-group-lottery-progress \
  --mode check
```

Render the exact prompt that would be sent to the backend:

```bash
node scripts/profile-replay.mjs \
  --fixture test/fixtures/profile-replay/product-group-lottery-progress \
  --profile engineering_group_test \
  --question "这个需求落代码先看哪里？" \
  --mode prompt
```

The bundled fixture models a product collaboration group with PRD, Migo,
design-state, code-map, risks, decisions, and open questions. It checks that the
prompt contains the route-visible business/project context and the identity
guard that says a group profile does not rewrite the requester's role.

## Session Lookup

The bridge can find local Codex sessions from `CODEX_HOME` and Claude sessions
from `CLAUDE_PROJECTS_ROOT`, then show a result card.
Find-style commands such as `find session ...`, `找出 ... session`, `查找 ...
session`, or `搜索 ... 会话` do not export immediately. They return a card with
a `生成链接` button when `SESSION_SHARE_OUTPUT=web` or `goofy`, or a `生成文档`
button when `SESSION_SHARE_OUTPUT=doc`.

Clicking the button creates the snapshot and updates the same card with an open
button.

For company-intranet sharing, prefer `SESSION_SHARE_OUTPUT=goofy`. The bridge
still writes a local HTML snapshot first, then runs:

```text
bytedcli --json goofy preview deploy <snapshot-dir> --alias <alias> --override
```

The returned card points to a Goofy Preview HTTPS URL instead of a local
`http://10.*:8787` URL, so coworkers do not need to reach your Mac directly.

## Bridge Task Session Viewer

Codex bridge tasks are often `CODEX_EPHEMERAL=1`, so they do not appear in
`~/.codex/sessions`. The bridge keeps its own safe task timeline instead:

```text
~/.lark-codex-bridge/task-runs/
  index.jsonl
  tasks/<task-id>.jsonl
```

The recorder stores safe summaries only: request summary, context, cwd/sandbox,
public progress items, final reply summary, failure reason, and token totals when
the backend exposes them. It does not export hidden reasoning or raw tool output.

Local viewer:

```bash
curl -H "Authorization: Bearer $(cat ~/.lark-codex-bridge-http-token)" \
  http://127.0.0.1:8787/task-viewer
```

Share a static visual viewer to Goofy Preview:

```bash
TOKEN="$(cat ~/.lark-codex-bridge-http-token)"
curl -sS -X POST http://127.0.0.1:8787/v1/bridge/task-viewer/share \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":100}'
```

You can also deploy from the checkout without hitting the running bridge:

```bash
TASK_VIEWER_GOOFY_ALIAS=bridge-task-viewer-syf \
  npm run task-viewer:share -- --deploy
```

Natural direct messages also work when they include a session ID, for example:

```text
019e7228-4b13-7c50-bbe4-f085e5c9b401 这个 session 帮我生成分享链接
```

Claude sessions usually have no obvious title in the UI, so the bridge accepts
looser hints:

```text
分享 Claude 最近会话
分享 Claude 当前会话
分享 Claude code.byted.org 的会话
找一下 Claude game invasion 的 session
找一下 Claude 包含 横滑 的会话
```

For Claude, matching order is: session id/prefix, generated title, project path,
then visible user/assistant content. If only a project path matches multiple
sessions, the newest session in that project is used. If content or title
matching is ambiguous, the bot returns recent candidates for you to narrow down
or click.

## Reply Rendering And Bot Loops

Normal bot replies use `BRIDGE_REPLY_MARKDOWN=1` by default. The bridge sends
the final text through `lark-cli --markdown`, which lets Lark render headings,
lists, links, and fenced code blocks as a post-format rich text message. If that
send fails, the bridge falls back to plain `--text` so the reply is not lost.

Bot-authored messages are ignored by default when
`LOOP_RESPOND_TO_BOT_SENDERS=0`. There are two explicit exceptions:

- a bot message mentions the delegated user and the delegated flow allows bot
  senders;
- a bot message explicitly mentions this bot and has non-empty actionable text.

Those exceptions are still bounded by `bridge_trace` and `LOOP_MAX_TURNS` when a
trace is present, which keeps `/bot-send` relay tests from running forever.

For controlled bot-to-bot integration with a colleague's bot, use the stricter
relay settings:

```bash
LOOP_RESPOND_TO_BOT_SENDERS=0
LOOP_BOT_ALLOW_SENDER_IDS=ou_colleague_bot
LOOP_REQUIRE_TRACE_FROM_BOT_SENDERS=1
LOOP_MAX_TURNS=3
```

Then start the exchange with `/bot-send`. The bridge-generated message carries a
`bridge_trace`; each bridge reply increments the turn, and messages from bot
senders without that trace are ignored. This lets two bots relay a bounded test
conversation without letting unrelated bot messages or untraced replies start an
open-ended loop.

## Progress Cards

When `PROGRESS_CARD_ENABLED=1`, the bridge sends a card as soon as a backend task
starts. While the task is running, the card shows a small list of public progress
items. When the task finishes, the same card is updated to show only the final
answer and metadata.

The final answer uses the card `markdown` component, so Markdown code fences such
as:

````markdown
```js
const value = buffer.toString('utf8');
```
````

render as a code block in clients that support Lark card Markdown.

## Delegated Approval Flow

The delegated flow is optional and disabled by default.

```text
DELEGATE_MENTION_ENABLED=1
DELEGATE_USER_OPEN_ID=ou_xxx
DELEGATE_USER_NAMES=Alice
DELEGATE_APPROVER_OPEN_ID=ou_xxx
DELEGATE_POLL_ENABLED=0
DELEGATE_WATCH_CHAT_IDS=oc_xxx
DELEGATE_ALLOW_BOT_SENDERS=1
DELEGATE_REPLY_IN_THREAD=1
DELEGATE_AUTO_REPLY_ENABLED=0
DELEGATE_AUTO_REPLY_MIN_CONFIDENCE=high
DELEGATE_REVIEW_AUTOMATION_ENABLED=0
DELEGATE_REVIEW_AUTO_APPROVE_ENABLED=0
DELEGATE_REVIEW_COMMENT_ON_ISSUES=1
DELEGATE_REVIEW_REQUIRE_CI_PASS=1
DELEGATE_REVIEW_REPLY_TO_GROUP=1
DELEGATE_REVIEW_PROGRESS_CARD_ENABLED=0
DELEGATE_REVIEW_KEYWORDS=review,code review,cr,代码review,代码 review,看下代码,帮忙看下,approve,给a,给 A,给一下 a,lgtm,LGTM,评审

REVIEW_FOLLOWUP_ENABLED=0
REVIEW_FOLLOWUP_STORE_FILE=~/.lark-codex-bridge/review-followups.json
REVIEW_FOLLOWUP_MAX_ROUNDS=5
REVIEW_FOLLOWUP_MAX_AGE_MS=86400000
REVIEW_FOLLOWUP_REQUESTER_IDS=
REVIEW_FOLLOWUP_REVIEWER_SENDER_IDS=
REVIEW_FOLLOWUP_PROGRESS_CARD_ENABLED=0
```

When someone mentions the delegated user, the bridge asks Codex to draft a reply
and sends an approval card to the approver. The draft is sent back to the
original conversation only after approval. With `DELEGATE_REPLY_IN_THREAD=1`,
approved replies are sent inside the original-message thread/topic instead of
as a normal main-stream group reply. `DELEGATE_ALLOW_BOT_SENDERS=1` allows
app/bot-authored messages to trigger the delegated workflow when they explicitly
mention the delegated user.

Keep `DELEGATE_AUTO_REPLY_ENABLED=0` unless the delegated user has explicitly
chosen to let the bridge send on their behalf. In the default state, the bridge
only drafts and sends a private approval card; nothing is posted to the group or
thread until the approver clicks the card button or replies `同意发送 <id>`.

When `DELEGATE_REVIEW_AUTOMATION_ENABLED=1`, delegate mentions that contain a
Codebase MR URL and a configured review keyword can bypass the normal approval
draft and run a constrained MR review automation prompt. Auto-approve is still
separately gated by `DELEGATE_REVIEW_AUTO_APPROVE_ENABLED=1` and the prompt's CI
and confidence checks.

When `REVIEW_FOLLOWUP_ENABLED=1`, polling can watch replies under previous
bridge-authored MR review requests. If a reviewer bot replies with required
changes, the bridge asks Codex to fix, verify, commit, push, and re-mention the
reviewer in the same thread. Keep this disabled unless the watched chats,
requester IDs, and write permissions are intentionally scoped.

## LaunchAgent

`launchagent.example.plist` is a template for running the bridge on macOS.
Replace every `/Users/YOUR_USER/...` placeholder before loading it:

```bash
cp launchagent.example.plist ~/Library/LaunchAgents/com.example.lark-codex-bridge.plist
plutil -lint ~/Library/LaunchAgents/com.example.lark-codex-bridge.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.example.lark-codex-bridge.plist
launchctl print "gui/$(id -u)/com.example.lark-codex-bridge"
```

To reload after edits:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.example.lark-codex-bridge.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.example.lark-codex-bridge.plist
```

If you installed globally, use `which lark-codex-bridge` to find the
absolute CLI path and put that path in `ProgramArguments` instead of the local
repository script path.

## Publishing to npm

Publishing to npm is optional. GitHub install works without it. If you do want a
public npm package, this repository is prepared as a scoped package:

```bash
npm login
npm whoami
npm run check
npm test
npm run pack:dry
npm publish --access public
```

Users can then run:

```bash
npx @syfyivan/lark-codex-bridge init
npx @syfyivan/lark-codex-bridge doctor
npx @syfyivan/lark-codex-bridge
```

If your npm account or organization is not `syfyivan`, change the `name` field
in `package.json` to your own scope, such as `@your-npm-name/lark-codex-bridge`,
and publish with `npm publish --access public`.

## Custom Service Runner Notes

The script keeps generic non-local-runner modes for custom internal
integrations:

- `BRIDGE_BACKEND=jwt-check`: call `SERVICE_JWT_ENDPOINT` using
  `SERVICE_ACCOUNT_SECRET` or `SERVICE_ACCOUNT_SECRET_FILE`.
- `BRIDGE_BACKEND=api`: mint a service JWT, then call `SERVICE_API_URL`.
- `BRIDGE_BACKEND=agent`: mint a service JWT, then call `AGENT_GATEWAY_URL`.
- `BRIDGE_BACKEND=tae`: compatibility alias for an agent gateway using
  `TAE_AGENT_URL` and `TAE_TARGET_PSM`.

Older `BRIDGE_MODE=jwt-check|api|agent|tae` values still work when
`BRIDGE_BACKEND` is unset.

These modes are intentionally unconfigured by default. Do not commit service
secrets, token files, concrete internal URLs, or production chat IDs.

## Security Notes

- Prefer token files over inline environment variables for long-running agents.
- Use `CODEX_SANDBOX` for owner-approved execution. If it is `danger-full-access`,
  non-owner sensitive requests must still pass the owner approval card first.
- Non-owner ordinary queries run with `CODEX_NON_OWNER_SANDBOX=workspace-write`
  from a disposable scratch directory, so they can inspect and diagnose but
  should not be able to write directly into the real workspace.
- `CODEX_NON_OWNER_SANDBOX=danger-full-access` is intentionally downgraded to
  `workspace-write`.
- When `PROFILE_POLICY_ENABLED=1`, non-owner direct Codex requests must match a
  configured capability before the backend starts. `kind: "exec"` cannot be marked
  `safeForMembers: true`.
- Treat `PROFILE_CONFIG_FILE` as policy, not user content. Review owner IDs,
  allowed member IDs, allowed chats, and regex patterns before enabling it for a
  bot used in shared groups.
- Treat `MEMORY_ROOT_DIR`, `SOULS_DIR`, and `BASE_SOUL_FILE` as local policy and
  context. Do not store secrets there, and keep global/project memory writes
  owner-approved unless the policy model is expanded deliberately.
- Do not upload logs, `.env`, token files, session exports, or approval stores.
- Review any custom prompt prefix before enabling write-capable tools.
