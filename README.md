# kodama-suite

A pnpm monorepo for two loosely-coupled projects that work better together:

| Package | Name | What it is |
| --- | --- | --- |
| [`packages/bridge`](packages/bridge) | `@syfyivan/lark-codex-bridge` | Zero-dependency Feishu/Lark ↔ local-agent bridge. Runs headless; publishable to npm. |
| [`packages/kodama`](packages/kodama) | `kodama` | Live2D desktop pet (Electron) that reacts to your coding agents. |
| [`packages/shared`](packages/shared) | `@syfyivan/pet-contract` | The pet-event contract both sides agree on. |

## How they relate

The bridge and the pet stay **independent processes**, linked over loopback HTTP/SSE:

```
 lark-codex-bridge ──①  GET /pet/events (SSE)  ──▶ kodama (agent-sync → reactions/growth)
   (127.0.0.1:8787) ──②  task/session details   ──▶ kodama (bridge-tasks panel)
                    ──③  PET_AUTOLAUNCH spawn    ──▶ kodama process
        both sides import the event vocabulary from @syfyivan/pet-contract ──┘
```

The monorepo exists so the wire contract lives in one place (`packages/shared`)
instead of being hand-duplicated in each repo. Each package still builds,
tests, deploys and publishes on its own — the bridge stays headless-friendly and
Kodama stays a standalone Electron app.

## Develop

```bash
pnpm install            # install all workspaces
pnpm check              # run each package's check
pnpm test               # run each package's tests
pnpm bridge             # start the bridge (packages/bridge)
pnpm kodama             # start the desktop pet (packages/kodama)
```

Per-package docs: [bridge](packages/bridge/README.md) · [kodama](packages/kodama/README.md) · [contract](packages/shared/README.md).
