import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { filterTaskViewerTasks } from './task-viewer.mjs';

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
  let indexStamp;

  function ensureStore() {
    mkdirSync(tasksDir, { recursive: true });
  }

  function loadIndex() {
    const stat = statSync(indexFile, { throwIfNoEntry: false });
    if (!stat) {
      tasks.clear();
      indexStamp = undefined;
      return;
    }
    const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (stamp === indexStamp) return;
    let text;
    try {
      text = readFileSync(indexFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      tasks.clear();
      indexStamp = undefined;
      return;
    }
    tasks.clear();
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const task = JSON.parse(line);
        if (task?.id) tasks.set(task.id, task);
      } catch {
        /* ignore corrupt index rows */
      }
    }
    trimMemory();
    indexStamp = stamp;
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
    // Active tasks must remain writable even when history is full.
    let slots = maxTasks - sorted.filter(task => task.status === 'running').length;
    tasks.clear();
    for (const task of sorted) {
      if (task.status === 'running') tasks.set(task.id, task);
      else if (slots > 0) {
        tasks.set(task.id, task);
        slots--;
      }
    }
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
      chatType: input.chatType || '',
      messageId: input.messageId || '',
      senderId: input.senderId || '',
      contextKey: input.contextKey || '',
      cwd: input.cwd || '',
      sandbox: input.sandbox || '',
      backend: input.backend || '',
      runtime: input.runtime || '',
      sessionId: input.sessionId || '',
      progressCardMessageId: input.progressCardMessageId || '',
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

  function patchTask(id, patch = {}) {
    const task = tasks.get(id);
    if (!task) return null;
    const now = new Date().toISOString();
    for (const key of [
      'title',
      'prompt',
      'chatId',
      'chatType',
      'messageId',
      'senderId',
      'contextKey',
      'cwd',
      'sandbox',
      'backend',
      'runtime',
      'sessionId',
      'progressCardMessageId',
      'finalText',
      'errorText',
    ]) {
      if (Object.hasOwn(patch, key)) task[key] = patch[key] || '';
    }
    if (Object.hasOwn(patch, 'tokens')) task.tokens = Number(patch.tokens || 0);
    task.updatedAt = now;
    appendIndex(task);
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

  function interruptRunningTasks(reason = 'Bridge restarted before this task reported final status.') {
    loadIndex();
    const interrupted = [];
    for (const task of tasks.values()) {
      if (task.status !== 'running') continue;
      addEvent(task.id, 'task_failed', {
        text: reason,
        reason: 'bridge_restart',
      });
      failTask(task.id, {
        status: 'failed',
        errorText: reason,
      });
      interrupted.push({ ...tasks.get(task.id) });
    }
    return interrupted;
  }

  function markRunningTasksInterrupted(reason = 'Bridge restarted before this task reported final status.') {
    return interruptRunningTasks(reason).length;
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

  function exportTasks({ limit = maxTasks, scanLimit = limit, scope } = {}) {
    return filterTaskViewerTasks(listTasks({ limit: scanLimit }), scope)
      .slice(0, Math.max(1, Number(limit || maxTasks)))
      .map(task => ({ ...task, events: readEvents(task.id) }));
  }

  loadIndex();
  return {
    storeDir,
    startTask,
    patchTask,
    addEvent,
    finishTask,
    failTask,
    interruptRunningTasks,
    markRunningTasksInterrupted,
    listTasks,
    getTask,
    exportTasks,
  };
}

export function writeFileEnsured(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
