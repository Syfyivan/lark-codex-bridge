// Pet event bus: mirrors the Lark bot's live activity to a local desktop pet
// (Kodama). One local owner == one pet, so this is a single GLOBAL stream
// rather than per-context. Dependency-free; safe to instantiate only when
// PET_SYNC is enabled.
//
// Event types (the pet maps these to animations + bubbles):
//   lark_message_received  - bot accepted an @mention / DM        -> looking
//   task_started           - a Codex task began                   -> working
//   task_progress          - intermediate progress text           -> working
//   lark_reply_sent        - bot sent a reply/card to Lark         -> replying
//   task_done              - task finished, final reply summary    -> done
//   task_failed            - task failed                           -> failed

const DEFAULT_MAX_BUFFER = 100;

const STATUS_BY_TYPE = {
  lark_message_received: 'looking',
  task_started: 'working',
  task_progress: 'working',
  lark_reply_sent: 'replying',
  task_done: 'done',
  task_failed: 'failed',
};

export function createPetEventBus({ maxBuffer = DEFAULT_MAX_BUFFER } = {}) {
  const subscribers = new Set();
  const recent = [];
  let seq = 0;
  let state = { status: 'idle', updatedAt: 0, lastEvent: null };

  function emit(type, payload = {}) {
    seq += 1;
    const event = { seq, type, ts: Date.now(), ...payload };
    recent.push(event);
    if (recent.length > maxBuffer) recent.shift();

    const status = STATUS_BY_TYPE[type] || state.status;
    state = { status, updatedAt: event.ts, lastEvent: event };

    for (const fn of subscribers) {
      // A misbehaving subscriber must never break the bus or the bridge.
      try {
        fn(event);
      } catch {
        /* ignore */
      }
    }
    return event;
  }

  // Subscribe to the live stream. `replay` re-sends the last N buffered events
  // immediately so a freshly-connected pet can catch up on current state.
  function subscribe(fn, { replay = 0 } = {}) {
    if (replay > 0) {
      for (const e of recent.slice(-replay)) {
        try {
          fn(e);
        } catch {
          /* ignore */
        }
      }
    }
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function getState() {
    return { ...state, subscribers: subscribers.size, seq };
  }

  function getRecent(n = 20) {
    return recent.slice(-n);
  }

  return { emit, subscribe, getState, getRecent };
}
