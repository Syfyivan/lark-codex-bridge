# Kodama desktop-pet capability matrix

Last research pass: 2026-06-17.

This document is the product backlog for making Kodama match common open-source desktop pet features, then exceed them through Feishu bot + local agent integration.

## Sources reviewed

- GitHub desktop-pet topic: https://github.com/topics/desktop-pet
- VPet: https://github.com/LorisYounger/VPet
- Clawd on Desk: https://github.com/rullerzhou-afk/clawd-on-desk
- OpenPets: https://github.com/alvinunreal/openpets
- Shimeji-ee: https://github.com/gil/shimeji-ee
- Shijima-Qt: https://github.com/pixelomer/Shijima-Qt
- Desktop Goose ResourceHub: https://desktopgooseunofficial.github.io/ResourceHub/
- Agentic Desktop Pet: https://github.com/jihe520/Agentic-Desktop-Pet
- AgentPet: https://github.com/ntd4996/agentpet

## What other desktop pets generally do

| Capability | Examples | Kodama status | Next action |
| --- | --- | --- | --- |
| Transparent always-on-top desktop companion | Shimeji, VPet, Clawd, BongoCat | Done | Keep improving macOS fullscreen with NSPanel if needed |
| Click-through / small hitbox | Clawd, many Electron pets | Done | Keep hitbox configurable |
| Drag, position memory, size settings | Clawd, VPet, OpenPets | Done | Add snap-to-edge / mini dock mode later |
| Idle / thinking / working / done / failed states | Clawd, VPet | Done | Add more state-specific animations as assets improve |
| User interaction: click, right-click, petting, lifting | VPet, Shimeji | Partial | Add petting/lifting as optional interactions, not disruptive defaults |
| Screen behavior: walking, climbing, multi-monitor | Shimeji, VPet, Shijima-Qt | Partial | Add wander/snap modes after window edge handling is stable |
| Mod/theme system | VPet Workshop, Shimeji image sets, OpenPets plugins, Clawd themes | Partial | Local accessory pack exists; add import/export UI and renderer theme manifest |
| Items / foods / outfits / accessories | VPet, virtual-pet projects | Partial | Accessories + local placement pack exist; add inventory/food items later |
| Growth / stats / leveling | AgentPet, VPet-like pets | Done | Add visible stats tab and optional leaderboard only after privacy review |
| Focus timer / reminders / hydration | OpenPets, productivity pets | Done | Durations are configurable; add hydration presets later |
| Do Not Disturb / sleep mode | Clawd-style agent pets | Done in current pass | Add schedule-based DND later |
| Sound effects | Clawd-style agent pets | Done in current pass | Replace synthetic cue with theme-provided audio assets later |
| System tray controls | Shimeji, Clawd | Done | Keep menu discoverable with text title and hotkeys |
| Auto-start / launch if missing | Clawd, bridge PET_AUTOLAUNCH | Done | OS login item + bridge PET_AUTOLAUNCH + CLI show/panel recovery |
| Auto-update / packaged installers | Clawd | Partial | electron-builder DMG works; add signing, notarization, auto-update |
| Cross-platform packaging | Clawd, Shijima-Qt, OpenPets | Partial | Windows/Linux config exists; still needs real device QA |
| Plugin SDK | OpenPets, VPet plugin model | Not started | Design after core event schema settles |
| AI coding agent state tracking | Clawd, AgentPet | Partial | Claude/Codex done; add Cursor/Gemini/Copilot only if user needs them |
| Permission bubbles / approve-deny controls | Clawd | Partial | We detect waiting; add one-click approval only per-agent when safe |
| Remote SSH / remote agent relay | Clawd | Not started | Possible via bridge relay; needs security design |
| Long-term memory / emotion / RPG | Agentic Desktop Pet | Partial | Growth exists; add emotion/memory only as optional local feature |
| Feishu bot desktop mirror | Kodama-specific | Advantage | Keep as the main differentiator |
| Bridge task detail / task viewer | Kodama-specific | Advantage | Done in Kodama: local Electron detail page with task list, prompt/final/error/timeline, Feishu jump, Goofy share |
| Session share / Goofy internal link | Kodama-specific | Advantage | Done for local session bubbles and Bridge task viewer; keep hardening jump/share UX |

## Positioning

Kodama should not merely copy traditional pets. The durable product shape is:

1. A normal desktop pet: visible, cute, configurable, safe to hide and restore.
2. A developer status surface: local Claude/Codex and future coding agents become readable at a glance.
3. A Feishu bot mirror: bot conversations and local agent runs share one visual event stream.
4. A private control plane: session jump, internal sharing, pending interaction surfacing, and token/growth accounting.

## Implementation backlog

### P0 reliability

- Keep hide/show recovery obvious: tray, hotkey, `pnpm run show`, local `/pet/show`.
- Add NSPanel/electron-panel-window if fullscreen still fails.
- Keep packaged launch / quit / relaunch flows verified after signing.

### P1 parity with mature desktop pets

- Theme pack manifest: name, renderer backend, idle/working/done/failed assets, optional audio cues.
- Asset import/export for local-only themes. Local accessory overrides already exist.
- Petting/lifting/wander modes behind settings.
- Edge mini mode: dock half-visible at screen edge instead of disappearing.
- Presets for focus/break/reminder durations beyond the current manual controls.

### P2 parity with Agent pets

- Agent integrations registry: Claude, Codex, Cursor, Gemini, Copilot, opencode.
- Installation doctor: detect missing hooks and offer install commands.
- Permission action adapters: approve/deny only when the underlying agent supports safe local action.
- Remote relay mode for devboxes/SSH.

### P3 beyond parity

- Feishu bot + local agent correlation: group related Feishu and local sessions into one timeline. Bridge task detail is done; correlation across local/Feishu tasks is next.
- Shareable internal session pages with redaction presets. Bridge task viewer sharing and local session bubble sharing exist; redaction presets are next.
- Memory/emotion layer: local-only summary memory, mood derived from user-visible workload, not private chat leakage.
- Privacy-first leaderboard or streaks only if user explicitly opts in.

## Blog series plan

1. `01-bridge`: why the desktop pet should subscribe to bridge events instead of raw Feishu events.
2. `02-interaction`: click-through, hitbox, bubbles, panel tabs, and why hiding needs a recovery path.
3. `03-session-share`: why opening JSONL is wrong; jump targets, previews, and internal share links.
4. `04-open-source-audit`: VPet/Shimeji/Clawd/OpenPets/Agentic Pet capability comparison.
5. `05-dnd-and-control-plane`: DND, sound, recovery commands, and event-control semantics.
6. `06-theme-and-plugin-roadmap`: theme packs, local-only assets, plugin SDK boundaries.
7. `07-packaging-and-autostart`: electron-builder, login items, signing/notarization, and cross-platform QA.
