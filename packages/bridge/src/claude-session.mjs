import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

function tryJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeQuery(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isRecentQuery(value) {
  const query = normalizeQuery(value)
    .replace(/^(?:claude\s*)?(?:session|会话)\s*/i, '')
    .replace(/\s*(?:claude\s*)?(?:session|会话)$/i, '')
    .trim();
  return (
    !query ||
    /^(?:recent|latest|last|current|now|最近|最新|当前|现在|刚才|最后|上一个|这个)$/.test(query)
  );
}

function findClaudeSessionFiles(projectsRoot) {
  if (!projectsRoot || !existsSync(projectsRoot)) return [];

  const files = [];
  const stack = [projectsRoot];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'subagents') continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  }
  return files;
}

function appendTextPart(parts, text) {
  const value = String(text || '');
  if (!value.trim()) return;
  const previous = parts[parts.length - 1];
  if (previous?.type === 'text') {
    previous.text = [previous.text, value].filter(Boolean).join('\n');
    return;
  }
  parts.push({ type: 'text', text: value });
}

function safeClaudeImageDataUrl(source) {
  if (!source || typeof source !== 'object') return '';
  const mediaType = String(source.media_type || source.mediaType || '').trim().toLowerCase();
  const data = String(source.data || '').replace(/\s+/g, '');
  if (!/^image\/(?:png|jpe?g|gif|webp)$/.test(mediaType)) return '';
  if (!/^[-_A-Za-z0-9+/=]+$/.test(data)) return '';
  return `data:${mediaType};base64,${data}`;
}

function extractClaudeContentParts(content) {
  const parts = [];
  if (typeof content === 'string') {
    appendTextPart(parts, content);
    return parts;
  }
  if (!Array.isArray(content)) return parts;

  for (const item of content) {
    if (typeof item === 'string') {
      appendTextPart(parts, item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text') {
      appendTextPart(parts, item.text);
      continue;
    }
    if (item.type === 'image') {
      const src = safeClaudeImageDataUrl(item.source);
      if (src) parts.push({ type: 'image', src, alt: 'Claude image attachment' });
    }
  }

  return parts;
}

function partsToText(parts) {
  return parts
    .map(part => {
      if (part.type === 'text') return part.text.trim();
      if (part.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function mergeParts(left, right) {
  const merged = [...left];
  if (merged.length && right.length) appendTextPart(merged, '\n\n');
  return [...merged, ...right];
}

function mergeAdjacentTurns(turns) {
  const merged = [];
  for (const turn of turns) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === turn.role) {
      previous.parts = mergeParts(previous.parts || [], turn.parts || []);
      previous.text = partsToText(previous.parts);
      if (!previous.timestamp && turn.timestamp) previous.timestamp = turn.timestamp;
      continue;
    }
    merged.push({ ...turn, parts: turn.parts || [] });
  }
  return merged;
}

function sessionTitleFromFallback(text, id) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return `Claude session ${id.slice(0, 8)}`;
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function summarizeClaudeSessionFile(file) {
  const id = basename(file, '.jsonl');
  const stat = statSync(file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let title = '';
  let firstUserText = '';
  let updatedAt = '';
  let cwd = '';
  let model = '';
  let visibleTurnCount = 0;
  let searchText = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    const item = tryJson(line);
    if (!item || typeof item !== 'object') continue;
    if (item.sessionId && String(item.sessionId) !== id) continue;

    if (item.type === 'ai-title' && item.aiTitle) {
      title = String(item.aiTitle).trim();
      continue;
    }

    if (item.timestamp) updatedAt = String(item.timestamp);
    if (item.cwd) cwd = String(item.cwd);
    if (item.message?.model) model = String(item.message.model);
    if (!['user', 'assistant'].includes(item.type)) continue;
    const role = item.message?.role || item.type;
    if (!['user', 'assistant'].includes(role)) continue;

    const parts = extractClaudeContentParts(item.message?.content);
    const text = partsToText(parts);
    if (!text) continue;

    visibleTurnCount += 1;
    if (role === 'user' && !firstUserText) firstUserText = text;
    if (searchText.length < 300_000) searchText += `\n${text.slice(0, 20_000)}`;
  }

  return {
    provider: 'claude',
    id,
    threadName: title || sessionTitleFromFallback(firstUserText, id),
    updatedAt: updatedAt || stat.mtime.toISOString(),
    projectPath: cwd,
    model,
    visibleTurnCount,
    searchText,
    file,
  };
}

export function listClaudeSessions(options = {}) {
  const projectsRoot = options.projectsRoot;
  return findClaudeSessionFiles(projectsRoot)
    .map(file => {
      try {
        return summarizeClaudeSessionFile(file);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt) || 0;
      const rightTime = Date.parse(right.updatedAt) || 0;
      return rightTime - leftTime;
    });
}

export function findClaudeSession(query, options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const sessions = listClaudeSessions(options);
  if (!sessions.length) return { status: 'not_found', matches: [] };

  if (isRecentQuery(normalizedQuery)) {
    return { status: 'ok', session: sessions[0], matchType: 'recent' };
  }

  const limit = Math.max(1, options.candidateLimit || 6);
  const rawQuery = String(query || '').trim();
  const byId = sessions.filter(
    session => session.id === rawQuery || session.id.startsWith(rawQuery),
  );
  if (byId.length === 1) return { status: 'ok', session: byId[0], matchType: 'id' };
  if (byId.length > 1) return { status: 'ambiguous', matches: byId.slice(0, limit) };

  const exactTitle = sessions.filter(
    session => normalizeQuery(session.threadName) === normalizedQuery,
  );
  if (exactTitle.length) return { status: 'ok', session: exactTitle[0], matchType: 'exact' };

  const fuzzyTitle = sessions.filter(session =>
    normalizeQuery(session.threadName).includes(normalizedQuery),
  );
  if (fuzzyTitle.length === 1) return { status: 'ok', session: fuzzyTitle[0], matchType: 'fuzzy' };
  if (fuzzyTitle.length > 1) return { status: 'ambiguous', matches: fuzzyTitle.slice(0, limit) };

  const projectMatches = sessions.filter(session =>
    normalizeQuery(session.projectPath).includes(normalizedQuery),
  );
  if (projectMatches.length) {
    return { status: 'ok', session: projectMatches[0], matchType: 'project-recent' };
  }

  const contentMatches = sessions.filter(session =>
    normalizeQuery(session.searchText).includes(normalizedQuery),
  );
  if (contentMatches.length === 1) {
    return { status: 'ok', session: contentMatches[0], matchType: 'content' };
  }
  if (contentMatches.length > 1) {
    return { status: 'ambiguous', matches: contentMatches.slice(0, limit) };
  }

  return { status: 'not_found', matches: sessions.slice(0, limit) };
}

export function parseClaudeSessionTranscript(sessionFile) {
  const transcript = {
    meta: {
      source: 'Claude',
    },
    turns: [],
  };

  const lines = readFileSync(sessionFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = tryJson(line);
    if (!item || typeof item !== 'object') continue;
    if (!['user', 'assistant'].includes(item.type)) continue;

    const role = item.message?.role || item.type;
    if (!['user', 'assistant'].includes(role)) continue;
    const parts = extractClaudeContentParts(item.message?.content);
    const text = partsToText(parts).trim();
    if (!text) continue;

    if (item.cwd) transcript.meta.cwd = String(item.cwd);
    if (item.message?.model) transcript.meta.model = String(item.message.model);
    transcript.turns.push({
      role,
      timestamp: item.timestamp || '',
      phase: '',
      text,
      parts,
    });
  }

  transcript.turns = mergeAdjacentTurns(transcript.turns);
  return transcript;
}
