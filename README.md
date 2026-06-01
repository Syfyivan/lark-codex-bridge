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
- Optional delegated-user approval flow for messages that mention another user.
- Optional local HTTP endpoint: `POST /v1/codex/tasks`.
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
node lark-codex-bridge.mjs
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

CODEX_BIN=codex
CODEX_CWD=/path/to/workspace
CODEX_SANDBOX=read-only           # use a stricter sandbox by default
CODEX_MODEL=
CODEX_TIMEOUT_MS=600000
CODEX_EPHEMERAL=1

PROGRESS_CARD_ENABLED=1
PROGRESS_CARD_UPDATE_INTERVAL_MS=8000
PROGRESS_CARD_MAX_ITEMS=8
PROGRESS_CARD_FINAL_REPLY=0       # final answer stays in the card

SESSION_SHARE_ENABLED=1
SESSION_SHARE_OUTPUT=web
SESSION_SHARE_STORE_DIR=~/.lark-codex-bridge/session-shares
SESSION_SHARE_REPLY_STYLE=card
```

## Session Lookup

The bridge can find local Codex sessions from `CODEX_HOME` and show a result card.
Find-style commands such as `find session ...`, `找出 ... session`, `查找 ...
session`, or `搜索 ... 会话` do not export immediately. They return a card with
a `生成链接` button when `SESSION_SHARE_OUTPUT=web`, or a `生成文档` button when
`SESSION_SHARE_OUTPUT=doc`.

Clicking the button creates the snapshot and updates the same card with an open
button.

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
```

When someone mentions the delegated user, the bridge asks Codex to draft a reply
and sends an approval card to the approver. The draft is sent back to the
original conversation only after approval.

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

These modes are intentionally unconfigured by default. Do not commit service
secrets, token files, concrete internal URLs, or production chat IDs.

## Security Notes

- Prefer token files over inline environment variables for long-running agents.
- Keep `CODEX_SANDBOX=read-only` unless the bot is explicitly allowed to edit.
- Do not upload logs, `.env`, token files, session exports, or approval stores.
- Review any custom prompt prefix before enabling write-capable tools.
