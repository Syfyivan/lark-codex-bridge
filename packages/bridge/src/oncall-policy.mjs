import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export function parseOncallCommand(content) {
  const trimmed = String(content || '').trim();
  if (!/^\/oncall(?:\s|$)/iu.test(trimmed)) return null;
  if (/^\/oncall(?:\s+(?:status|状态))?$/iu.test(trimmed)) return { action: 'status' };
  if (/^\/oncall\s+(?:unbind|解绑)$/iu.test(trimmed)) return { action: 'unbind' };
  const bind = trimmed.match(/^\/oncall\s+(?:bind|绑定)\s+(.+)$/iu);
  if (bind?.[1]?.trim()) return { action: 'bind', path: bind[1].trim() };
  return { action: 'help' };
}

export function normalizeOncallPath(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const home = options.home || homedir();
  if (raw === '~') return home;
  if (raw.startsWith('~/')) return resolve(home, raw.slice(2));
  return resolve(options.cwd || process.cwd(), raw);
}

export function readOncallBindings(file, deps = {}) {
  const exists = deps.exists || existsSync;
  const readFile = deps.readFile || readFileSync;
  if (!file || !exists(file)) return { version: 1, chats: {} };
  const parsed = JSON.parse(readFile(file, 'utf8'));
  return {
    version: 1,
    chats: parsed?.chats && typeof parsed.chats === 'object' && !Array.isArray(parsed.chats)
      ? parsed.chats
      : {},
  };
}

export function writeOncallBindings(file, bindings, deps = {}) {
  const mkdir = deps.mkdir || mkdirSync;
  const writeFile = deps.writeFile || writeFileSync;
  mkdir(dirname(file), { recursive: true });
  writeFile(file, `${JSON.stringify({
    version: 1,
    chats: bindings?.chats || {},
  }, null, 2)}\n`);
}

export function getOncallBinding(bindings, chatId) {
  if (!chatId) return null;
  const binding = bindings?.chats?.[chatId];
  if (!binding?.cwd) return null;
  return binding;
}

export function setOncallBinding(bindings, chatId, binding) {
  if (!chatId) throw new Error('missing chat_id');
  const next = {
    version: 1,
    chats: { ...(bindings?.chats || {}) },
  };
  next.chats[chatId] = {
    cwd: binding.cwd,
    ownerOpenId: binding.ownerOpenId || '',
    createdAt: binding.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export function clearOncallBinding(bindings, chatId) {
  const next = {
    version: 1,
    chats: { ...(bindings?.chats || {}) },
  };
  delete next.chats[chatId];
  return next;
}
