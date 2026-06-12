# Lark Codex Bridge

A local Node.js bridge that connects Lark/Feishu bot events to `codex exec`.
It can also expose a small HTTP API for local automation.

The bridge is designed for a personal or team bot:

```text
Lark bot event -> lark-cli -> Codex CLI -> Lark reply or progress card
```

## Features

- Listen to Lark bot events through `lark-cli event +subscribe`.
- Reply only when the bot is mentioned in a group, unless configured otherwise.
- Run non-interactive Codex tasks with `codex exec`.
- Show an interactive progress card while Codex is working.
- Replace the progress card with the final answer when the task finishes.
- Render final answers with card Markdown so fenced code blocks display cleanly.
- Find local Codex sessions and generate snapshot links from a card button.
- Owner-only ops commands for health, version, and log tail checks from Lark.
- Optional delegated-user approval flow for messages that mention another user.
- Optional local HTTP endpoints: `POST /v1/codex/tasks` and
  `POST /v1/codex/session-shares`.
- Optional generic service/JWT and API gateway modes for custom backends.

## Requirements

- Node.js 20 or newer.
- `lark-cli` configured with a bot app.
- Codex CLI available on `PATH`, or set `CODEX_BIN`.

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
lark-codex-bridge.mjs   CLI entrypoint, Lark event loop, Codex execution, HTTP API
docs/architecture.md    Runtime boundaries and Codex cold-start roadmap
src/codex-runner.mjs    Codex runner interface, exec runner, sandbox policy, scratch guard
src/env.mjs             Environment parsing and option normalization
src/lark-format.mjs     Lark reply formatting helpers
src/process-manager.mjs Child process execution helper
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
BRIDGE_MODE=codex                 # codex | jwt-check | agent | api
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
LOOP_IGNORE_SENDER_IDS=
LOOP_ALLOW_SENDER_IDS=

CODEX_BIN=codex
CODEX_CWD=/path/to/workspace
CODEX_SANDBOX=read-only           # owner / approved sensitive operations use this sandbox
CODEX_NON_OWNER_SANDBOX=workspace-write  # non-owner ordinary queries run in a disposable scratch cwd
CODEX_NON_OWNER_SCRATCH_ROOT=     # defaults to the OS temp directory
CODEX_MODEL=
CODEX_TIMEOUT_MS=600000
CODEX_EPHEMERAL=1

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
```

## Owner Ops Commands

The owner can mention the bot in a group, or message it directly, with:

```text
/health
/version
/logs 40
/ops health
```

`/health` includes the configured sandbox modes, session-share output, and a
startup preflight for Codex app-server `turn/steer` and `turn/interrupt`
protocol support. It also reports the active Codex runner. The bridge still
runs normal tasks through the `exec` runner; this check is only readiness
information for the lower-latency app-server roadmap.

## Session Lookup

The bridge can find local Codex sessions from `CODEX_HOME` and show a result card.
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

Natural direct messages also work when they include a session ID, for example:

```text
019e7228-4b13-7c50-bbe4-f085e5c9b401 这个 session 帮我生成分享链接
```

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

Those exceptions are still bounded by `bridge_trace` and `LOOP_MAX_TURNS`, which
keeps bot-to-bot relay tests from running forever.

## Progress Cards

When `PROGRESS_CARD_ENABLED=1`, the bridge sends a card as soon as a Codex task
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

## Custom Service Modes

The script keeps two generic non-Codex modes for custom internal integrations:

- `BRIDGE_MODE=jwt-check`: call `SERVICE_JWT_ENDPOINT` using
  `SERVICE_ACCOUNT_SECRET` or `SERVICE_ACCOUNT_SECRET_FILE`.
- `BRIDGE_MODE=api`: mint a service JWT, then call `SERVICE_API_URL`.
- `BRIDGE_MODE=agent`: mint a service JWT, then call `AGENT_GATEWAY_URL`.
- `BRIDGE_MODE=tae`: compatibility alias for an agent gateway using
  `TAE_AGENT_URL` and `TAE_TARGET_PSM`.

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
- Do not upload logs, `.env`, token files, session exports, or approval stores.
- Review any custom prompt prefix before enabling write-capable tools.
