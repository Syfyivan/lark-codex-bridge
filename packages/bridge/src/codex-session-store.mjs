import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_MAX_SESSIONS = 20;
const DEFAULT_MAX_MESSAGE_BINDINGS = 500;

export function defaultCodexSessionStoreFile() {
  return join(homedir(), '.lark-codex-bridge', 'codex-sessions.json');
}

export function createCodexSessionStore(options = {}) {
  const file = options.file || defaultCodexSessionStoreFile();
  const maxSessions = Math.max(1, Number(options.maxSessions || DEFAULT_MAX_SESSIONS));
  const maxMessageBindings = Math.max(
    maxSessions,
    Number(options.maxMessageBindings || DEFAULT_MAX_MESSAGE_BINDINGS),
  );
  const now = options.now || (() => new Date().toISOString());
  let state = loadState(file);

  function context(contextKey, create = false) {
    if (!contextKey) return null;
    let value = state.contexts[contextKey];
    if (!value && create) {
      value = { activeSessionId: '', sessions: [], messageBindings: {} };
      state.contexts[contextKey] = value;
    }
    return value || null;
  }

  function save() {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporary, file);
  }

  function list(contextKey) {
    return (context(contextKey)?.sessions || []).map(item => ({ ...item }));
  }

  function active(contextKey) {
    const value = context(contextKey);
    if (!value?.activeSessionId) return null;
    const session = value.sessions.find(item => item.id === value.activeSessionId);
    return session ? { ...session } : null;
  }

  function record(contextKey, session, recordOptions = {}) {
    if (!contextKey) throw new Error('missing Codex session context key');
    if (!session?.id) throw new Error('missing Codex session id');
    const value = context(contextKey, true);
    const existing = value.sessions.find(item => item.id === session.id);
    const timestamp = now();
    const next = {
      id: session.id,
      title: session.title || existing?.title || '',
      cwd: session.cwd || existing?.cwd || '',
      sandbox: session.sandbox || existing?.sandbox || '',
      model: session.model || existing?.model || '',
      createdAt: existing?.createdAt || session.createdAt || timestamp,
      updatedAt: timestamp,
    };
    value.sessions = [next, ...value.sessions.filter(item => item.id !== session.id)]
      .slice(0, maxSessions);
    if (recordOptions.activate !== false) value.activeSessionId = session.id;
    pruneBindings(value);
    save();
    return { ...next };
  }

  function bindMessages(contextKey, sessionId, messageIds = []) {
    const value = context(contextKey, true);
    if (!value.sessions.some(item => item.id === sessionId)) return 0;
    let changed = 0;
    for (const rawId of messageIds) {
      const id = String(rawId || '').trim();
      if (!id || value.messageBindings[id] === sessionId) continue;
      value.messageBindings[id] = sessionId;
      changed += 1;
    }
    const entries = Object.entries(value.messageBindings);
    if (entries.length > maxMessageBindings) {
      value.messageBindings = Object.fromEntries(entries.slice(-maxMessageBindings));
    }
    if (changed) save();
    return changed;
  }

  function resolveSession(contextKey, messageIds = [], resolveOptions = {}) {
    const value = context(contextKey);
    if (!value) return { session: null, source: 'none' };
    for (const rawId of messageIds) {
      const id = String(rawId || '').trim();
      const sessionId = id ? value.messageBindings[id] : '';
      const session = value.sessions.find(item => item.id === sessionId);
      if (session) return { session: { ...session }, source: 'message' };
    }
    if (resolveOptions.fallbackToActive === false) {
      return { session: null, source: 'none' };
    }
    const session = value.sessions.find(item => item.id === value.activeSessionId);
    return session
      ? { session: { ...session }, source: 'active' }
      : { session: null, source: 'none' };
  }

  function activate(contextKey, selector) {
    const value = context(contextKey);
    if (!value) return null;
    const query = String(selector || '').trim();
    let selected = null;
    if (/^\d+$/.test(query)) {
      selected = value.sessions[Number(query) - 1] || null;
    } else if (query) {
      selected = value.sessions.find(item => item.id === query) || null;
      if (!selected) {
        const matches = value.sessions.filter(item =>
          String(item.title || '').toLowerCase().includes(query.toLowerCase()),
        );
        if (matches.length === 1) selected = matches[0];
      }
    }
    if (!selected) return null;
    value.activeSessionId = selected.id;
    selected.updatedAt = now();
    value.sessions = [selected, ...value.sessions.filter(item => item.id !== selected.id)];
    save();
    return { ...selected };
  }

  return {
    file,
    active,
    activate,
    bindMessages,
    list,
    record,
    resolve: resolveSession,
  };
}

function emptyState() {
  return { version: 1, contexts: {} };
}

function loadState(file) {
  if (!file || !existsSync(file)) return emptyState();
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return {
    version: 1,
    contexts: parsed?.contexts && typeof parsed.contexts === 'object' && !Array.isArray(parsed.contexts)
      ? parsed.contexts
      : {},
  };
}

function pruneBindings(value) {
  const sessionIds = new Set(value.sessions.map(item => item.id));
  value.messageBindings = Object.fromEntries(
    Object.entries(value.messageBindings || {}).filter(([, sessionId]) => sessionIds.has(sessionId)),
  );
  if (!sessionIds.has(value.activeSessionId)) value.activeSessionId = value.sessions[0]?.id || '';
}
