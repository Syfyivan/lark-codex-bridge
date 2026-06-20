import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export function safeMemorySegment(value, fallback = 'unknown') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^\.+_?/, '_')
    .slice(0, 160) || fallback;
}

export function memoryPaths(rootDir, input = {}) {
  const chatId = safeMemorySegment(input.chatId);
  const threadId = safeMemorySegment(input.threadId || input.chatId);
  const projectId = safeMemorySegment(input.projectId);
  return {
    rootDir,
    globalDir: join(rootDir, 'global'),
    projectDir: join(rootDir, 'projects', projectId),
    chatDir: join(rootDir, 'chats', chatId),
    threadFile: join(rootDir, 'threads', chatId, `${threadId}.md`),
  };
}

export function readTextFile(file, fallback = '') {
  if (!file || !existsSync(file)) return fallback;
  return readFileSync(file, 'utf8');
}

export function writeTextFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, String(text || ''));
}

export function appendTextFile(file, text) {
  const existing = readTextFile(file, '');
  writeTextFile(file, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${String(text || '')}`);
}

export function readJsonl(file, limit = 20) {
  if (!file || !existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const selected = limit > 0 ? lines.slice(-limit) : lines;
  return selected
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function writeJsonl(file, records) {
  mkdirSync(dirname(file), { recursive: true });
  const text = (records || [])
    .map(record => JSON.stringify(record))
    .join('\n');
  writeFileSync(file, text ? `${text}\n` : '');
}

export function appendJsonl(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  const line = `${JSON.stringify({
    ...record,
    createdAt: record.createdAt || new Date().toISOString(),
  })}\n`;
  appendTextFile(file, line);
}

export function compactJsonlFile(file, maxRecords = 100) {
  const records = readJsonl(file, 0);
  const selected = maxRecords > 0 ? records.slice(-maxRecords) : records;
  if (records.length !== selected.length) writeJsonl(file, selected);
  return {
    file,
    before: records.length,
    after: selected.length,
  };
}

export function compactText(text, maxChars) {
  const raw = String(text || '').trim();
  if (!maxChars || raw.length <= maxChars) return raw;
  return [
    '<memory_truncated>',
    raw.slice(Math.max(0, raw.length - maxChars)),
  ].join('\n');
}

export function compactTextFile(file, maxChars) {
  const compacted = compactText(readTextFile(file), maxChars);
  if (compacted) writeTextFile(file, `${compacted}\n`);
  return compacted;
}

export function appendThreadExchange(input) {
  const {
    rootDir,
    chatId,
    threadId,
    userText,
    assistantText,
    maxChars = 20_000,
    now = () => new Date().toISOString(),
  } = input || {};
  const paths = memoryPaths(rootDir, { chatId, threadId });
  const block = [
    `## ${now()}`,
    '',
    'User:',
    String(userText || '').trim(),
    '',
    'Assistant:',
    String(assistantText || '').trim(),
    '',
  ].join('\n');
  appendTextFile(paths.threadFile, block);
  return compactTextFile(paths.threadFile, maxChars);
}

export function memoryCandidateFile(rootDir, route) {
  return join(memoryPaths(rootDir, route).chatDir, 'memory-candidates.jsonl');
}

export function appendMemoryCandidate(rootDir, route, candidate = {}) {
  const record = {
    id: candidate.id || `mem_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    type: normalizeMemoryRecordType(candidate.type),
    scope: normalizeMemoryScope(candidate.scope || (route?.projectId ? 'project' : 'chat')),
    text: String(candidate.text || '').trim(),
    projectId: candidate.projectId || route?.projectId || '',
    chatId: candidate.chatId || route?.chatId || '',
    threadId: candidate.threadId || route?.threadId || '',
    source: candidate.source || 'manual',
    sourceMessageId: candidate.sourceMessageId || '',
    confidence: candidate.confidence || 'medium',
  };
  if (!record.text) return null;
  appendJsonl(memoryCandidateFile(rootDir, route), record);
  return record;
}

export function readMemoryCandidates(rootDir, route, limit = 20) {
  return readJsonl(memoryCandidateFile(rootDir, route), limit)
    .filter(candidate => candidate?.text && !candidate.status);
}

export function approveMemoryCandidates(rootDir, route, selector = '') {
  return resolveMemoryCandidateSelection(rootDir, route, selector, 'approve');
}

export function rejectMemoryCandidates(rootDir, route, selector = '') {
  return resolveMemoryCandidateSelection(rootDir, route, selector, 'reject');
}

function resolveMemoryCandidateSelection(rootDir, route, selector, action) {
  const file = memoryCandidateFile(rootDir, route);
  const records = readJsonl(file, 0);
  const pending = records.filter(candidate => candidate?.text && !candidate.status);
  const wanted = selectCandidates(pending, selector);
  if (!wanted.length) {
    return { selected: [], remaining: pending, file };
  }
  const wantedIds = new Set(wanted.map(candidate => candidate.id));
  const kept = records.filter(candidate => !wantedIds.has(candidate.id));
  writeJsonl(file, kept);
  if (action === 'approve') {
    for (const candidate of wanted) appendApprovedMemoryRecord(rootDir, route, candidate);
  }
  return {
    selected: wanted,
    remaining: kept.filter(candidate => candidate?.text && !candidate.status),
    file,
  };
}

function selectCandidates(candidates, selector) {
  const key = String(selector || '').trim();
  if (!key) return candidates.slice(0, 1);
  if (key.toLowerCase() === 'all') return candidates;
  return candidates.filter(candidate => candidate.id === key || candidate.id?.startsWith(key));
}

function appendApprovedMemoryRecord(rootDir, route, candidate) {
  const targetRoute = {
    ...route,
    projectId: candidate.projectId || route?.projectId || '',
  };
  const paths = memoryPaths(rootDir, targetRoute);
  const scope = normalizeMemoryScope(candidate.scope);
  const dir = scope === 'project' && targetRoute.projectId ? paths.projectDir : paths.chatDir;
  appendJsonl(join(dir, fileNameForMemoryRecordType(candidate.type)), {
    text: candidate.text,
    source: candidate.source || 'candidate',
    sourceMessageId: candidate.sourceMessageId || '',
    approvedFromCandidateId: candidate.id,
    confidence: candidate.confidence || 'medium',
  });
}

function fileNameForMemoryRecordType(type) {
  const normalized = normalizeMemoryRecordType(type);
  if (normalized === 'risk') return 'risks.jsonl';
  if (normalized === 'pending') return 'pending.jsonl';
  if (normalized === 'question') return 'open-questions.jsonl';
  return 'decisions.jsonl';
}

function normalizeMemoryRecordType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (['decision', 'risk', 'pending', 'question'].includes(normalized)) return normalized;
  return 'decision';
}

function normalizeMemoryScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  if (['chat', 'project'].includes(normalized)) return normalized;
  return 'chat';
}

export function compactMemoryRoute(input = {}) {
  const {
    rootDir,
    route,
    scope = 'chat',
    maxTextChars = 20_000,
    maxJsonlRecords = 100,
  } = input;
  const paths = memoryPaths(rootDir, route);
  const result = [];
  if (scope === 'thread') {
    result.push(compactTextResult(paths.threadFile, maxTextChars));
    return result;
  }
  if (scope === 'global') {
    for (const fileName of ['business-summary.md', 'repo-map-summary.md', 'preferences.md']) {
      result.push(compactTextResult(join(paths.globalDir, fileName), maxTextChars));
    }
    return result;
  }
  const dir = scope === 'project' && route?.projectId ? paths.projectDir : paths.chatDir;
  result.push(compactTextResult(join(dir, 'summary.md'), maxTextChars));
  for (const fileName of ['decisions.jsonl', 'risks.jsonl', 'pending.jsonl', 'open-questions.jsonl', 'memory-candidates.jsonl']) {
    result.push(compactJsonlFile(join(dir, fileName), maxJsonlRecords));
  }
  return result;
}

function compactTextResult(file, maxChars) {
  const before = readTextFile(file, '').length;
  const compacted = compactTextFile(file, maxChars);
  return {
    file,
    before,
    after: compacted.length,
  };
}
