import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_TASKS = 200;
const DEFAULT_MAX_EVENTS = 240;

export function defaultTaskViewerStoreDir() {
  return join(homedir(), '.lark-codex-bridge', 'task-runs');
}

export function makeTaskId(prefix = 'task') {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().split('-')[0]}`;
}

export function createTaskRecorder(options = {}) {
  const storeDir = options.storeDir || defaultTaskViewerStoreDir();
  const maxTasks = Math.max(1, Number(options.maxTasks || DEFAULT_MAX_TASKS));
  const maxEventsPerTask = Math.max(20, Number(options.maxEventsPerTask || DEFAULT_MAX_EVENTS));
  const tasksDir = join(storeDir, 'tasks');
  const indexFile = join(storeDir, 'index.jsonl');
  const tasks = new Map();

  function ensureStore() {
    mkdirSync(tasksDir, { recursive: true });
  }

  function loadIndex() {
    if (!existsSync(indexFile)) return;
    const lines = readFileSync(indexFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const task = JSON.parse(line);
        if (task?.id) tasks.set(task.id, task);
      } catch {
        /* ignore corrupt index rows */
      }
    }
    trimMemory();
  }

  function appendIndex(task) {
    ensureStore();
    writeFileSync(indexFile, `${JSON.stringify(task)}\n`, { flag: 'a' });
  }

  function taskFile(id) {
    return join(tasksDir, `${id}.jsonl`);
  }

  function appendEvent(id, event) {
    ensureStore();
    writeFileSync(taskFile(id), `${JSON.stringify(event)}\n`, { flag: 'a' });
  }

  function trimMemory() {
    const sorted = [...tasks.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    tasks.clear();
    for (const task of sorted.slice(0, maxTasks)) tasks.set(task.id, task);
  }

  function pruneFiles() {
    if (!existsSync(tasksDir)) return;
    const keep = new Set(tasks.keys());
    for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const id = entry.name.slice(0, -'.jsonl'.length);
      if (!keep.has(id)) rmSync(join(tasksDir, entry.name), { force: true });
    }
  }

  function startTask(input = {}) {
    const now = new Date().toISOString();
    const id = input.id || makeTaskId();
    const task = {
      id,
      status: 'running',
      title: input.title || input.prompt || 'Bridge task',
      prompt: input.prompt || '',
      source: input.source || 'lark',
      chatId: input.chatId || '',
      messageId: input.messageId || '',
      senderId: input.senderId || '',
      contextKey: input.contextKey || '',
      cwd: input.cwd || '',
      sandbox: input.sandbox || '',
      backend: input.backend || '',
      runtime: input.runtime || '',
      tokens: 0,
      eventCount: 0,
      startedAt: now,
      updatedAt: now,
      finishedAt: '',
      finalText: '',
      errorText: '',
    };
    tasks.set(id, task);
    appendIndex(task);
    addEvent(id, 'task_started', {
      text: input.prompt || '',
      cwd: task.cwd,
      sandbox: task.sandbox,
      backend: task.backend,
      runtime: task.runtime,
    });
    trimMemory();
    pruneFiles();
    return task;
  }

  function addEvent(id, type, payload = {}) {
    if (!id) return null;
    const task = tasks.get(id);
    if (!task) return null;
    const event = {
      id: randomUUID(),
      taskId: id,
      type,
      ts: new Date().toISOString(),
      ...payload,
    };
    task.eventCount = Math.min(maxEventsPerTask, Number(task.eventCount || 0) + 1);
    task.updatedAt = event.ts;
    if (type === 'task_done') task.status = 'done';
    if (type === 'task_failed') task.status = 'failed';
    if (type === 'task_cancelled') task.status = 'cancelled';
    appendEvent(id, event);
    appendIndex(task);
    return event;
  }

  function finishTask(id, patch = {}) {
    const task = tasks.get(id);
    if (!task) return null;
    const now = new Date().toISOString();
    task.status = patch.status || 'done';
    task.finishedAt = now;
    task.updatedAt = now;
    task.finalText = patch.finalText || task.finalText || '';
    task.tokens = Number(patch.tokens || task.tokens || 0);
    appendIndex(task);
    return task;
  }

  function failTask(id, patch = {}) {
    const task = tasks.get(id);
    if (!task) return null;
    const now = new Date().toISOString();
    task.status = patch.status || 'failed';
    task.finishedAt = now;
    task.updatedAt = now;
    task.errorText = patch.errorText || task.errorText || '';
    appendIndex(task);
    return task;
  }

  function listTasks({ limit = maxTasks } = {}) {
    loadIndex();
    return [...tasks.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, Math.max(1, Number(limit || maxTasks)));
  }

  function readEvents(id) {
    const file = taskFile(id);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-maxEventsPerTask)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function getTask(id) {
    loadIndex();
    const task = tasks.get(id);
    if (!task) return null;
    return { ...task, events: readEvents(id) };
  }

  function exportTasks({ limit = maxTasks } = {}) {
    return listTasks({ limit }).map(task => ({ ...task, events: readEvents(task.id) }));
  }

  loadIndex();
  return { storeDir, startTask, addEvent, finishTask, failTask, listTasks, getTask, exportTasks };
}

export function writeFileEnsured(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
