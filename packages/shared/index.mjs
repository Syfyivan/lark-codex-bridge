// Shared pet-event contract between lark-codex-bridge (producer) and Kodama
// (consumer). This is the single source of truth for the event vocabulary that
// flows over the bridge's SSE stream (`GET /pet/events`). Keep it dependency-free
// and runtime-agnostic so it imports cleanly in Node (bridge, Kodama main) and
// the browser/renderer (Kodama renderer).

/**
 * Canonical pet-event types. The bridge emits a subset (task_* + lark_*);
 * Kodama additionally raises local-only types (pomodoro_completed, agent_done).
 * @type {Readonly<Record<string, string>>}
 */
export const PET_EVENT_TYPES = Object.freeze({
  TASK_STARTED: 'task_started',
  TASK_PROGRESS: 'task_progress',
  TASK_DONE: 'task_done',
  TASK_FAILED: 'task_failed',
  TASK_WAITING: 'task_waiting',
  LARK_MESSAGE_RECEIVED: 'lark_message_received',
  LARK_REPLY_SENT: 'lark_reply_sent',
  POMODORO_COMPLETED: 'pomodoro_completed',
  AGENT_DONE: 'agent_done',
});

const EVENT_TYPE_VALUES = Object.freeze(new Set(Object.values(PET_EVENT_TYPES)));

/**
 * Where an event originated. `lark` = the user's Feishu bot (via the bridge),
 * `local` = an agent running on this machine (Claude Code / Codex hooks).
 * @type {Readonly<Record<string, string>>}
 */
export const PET_SOURCES = Object.freeze({
  LARK: 'lark',
  LOCAL: 'local',
});

const SOURCE_VALUES = Object.freeze(new Set(Object.values(PET_SOURCES)));

/** Default source the bridge stamps on emitted events. */
export const DEFAULT_PET_SOURCE = PET_SOURCES.LARK;

/** @param {unknown} type */
export function isPetEventType(type) {
  return typeof type === 'string' && EVENT_TYPE_VALUES.has(type);
}

/** @param {unknown} source */
export function isPetSource(source) {
  return typeof source === 'string' && SOURCE_VALUES.has(source);
}

/**
 * Coerce an arbitrary source string to a known source, falling back to `local`
 * for anything unrecognized (an unknown source is, by definition, not the bot).
 * @param {unknown} source
 * @returns {string}
 */
export function normalizeSource(source) {
  return isPetSource(source) ? source : PET_SOURCES.LOCAL;
}

/**
 * Shape of an event on the wire. Producers should populate `type` + `source`;
 * the rest are optional and event-specific.
 * @typedef {Object} PetEvent
 * @property {string} type    one of PET_EVENT_TYPES
 * @property {string} source  one of PET_SOURCES
 * @property {string} [text]  short human-readable summary (redacted/clamped in SAFE mode)
 * @property {number} [tokens] token usage attributed to this event (cross-source accounting)
 * @property {string} [taskId] bridge task id, when the event belongs to a task
 * @property {number} [ts]     epoch millis the event was produced
 */

export const PET_CONTRACT_VERSION = '0.1.0';
