# @syfyivan/pet-contract

Single source of truth for the **pet-event contract** shared by
[`@syfyivan/lark-codex-bridge`](../bridge) (producer) and
[`kodama`](../kodama) (consumer).

The bridge emits these events on its SSE stream (`GET /pet/events`); Kodama's
`agent-sync` consumes them and maps each to a reaction / growth gain / token
accounting entry. Keeping the vocabulary here prevents the two repos from
drifting apart (e.g. a renamed `task_*` type silently breaking the pet).

```js
import { PET_EVENT_TYPES, PET_SOURCES, normalizeSource } from '@syfyivan/pet-contract'
```

- `PET_EVENT_TYPES` — canonical event-type strings (`task_started`, `task_done`, …).
- `PET_SOURCES` / `DEFAULT_PET_SOURCE` — `lark` (Feishu bot via bridge) vs `local` (on-machine agent).
- `isPetEventType` / `isPetSource` / `normalizeSource` — guards.
- `PetEvent` — JSDoc typedef for the wire shape.

Dependency-free and runtime-agnostic: imports cleanly in Node and the browser/renderer.
