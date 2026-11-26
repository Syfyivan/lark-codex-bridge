import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createTaskRecorder } from '../src/task-recorder.mjs';
import {
  filterTaskViewerTasks,
  normalizeTaskViewerScope,
  renderTaskViewerHtml,
  taskViewerTitleForScope,
  writeTaskViewerSite,
} from '../src/task-viewer.mjs';

test('task recorder persists safe bridge task timelines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-viewer-'));
  try {
    const recorder = createTaskRecorder({ storeDir: dir, maxTasks: 5 });
    const task = recorder.startTask({
      prompt: '看一下 bridge 进度',
      chatId: 'oc_demo',
      messageId: 'om_demo',
      contextKey: 'chat:oc_demo',
      cwd: '/tmp/repo',
      sandbox: 'read-only',
      backend: 'codex',
      runtime: 'exec',
    });
    recorder.addEvent(task.id, 'task_progress', { text: '运行命令：rg task' });
    recorder.addEvent(task.id, 'task_done', { text: '完成', tokens: 123 });
    recorder.finishTask(task.id, { finalText: '完成', tokens: 123 });

    const restored = createTaskRecorder({ storeDir: dir, maxTasks: 5 }).getTask(task.id);
    assert.equal(restored.status, 'done');
    assert.equal(restored.chatId, 'oc_demo');
    assert.equal(restored.tokens, 123);
    assert.equal(restored.events.some(event => event.type === 'task_progress'), true);

    const patched = createTaskRecorder({ storeDir: dir, maxTasks: 5 });
    patched.patchTask(task.id, {
      progressCardMessageId: 'om_card',
      chatType: 'group',
      sessionId: '019f-session',
    });
    const patchedTask = patched.getTask(task.id);
    assert.equal(patchedTask.progressCardMessageId, 'om_card');
    assert.equal(patchedTask.chatType, 'group');
    assert.equal(patchedTask.sessionId, '019f-session');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task recorder refreshes its index after external appends or replacement', t => {
  const dir = mkdtempSync(join(tmpdir(), 'task-viewer-index-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reader = createTaskRecorder({ storeDir: dir });
  const writer = createTaskRecorder({ storeDir: dir });
  writer.startTask({ id: 'existing' });
  assert.equal(reader.getTask('existing').status, 'running');
  writer.finishTask('existing', { finalText: 'completed elsewhere' });
  assert.equal(reader.getTask('existing').finalText, 'completed elsewhere');

  const replacement = join(dir, 'replacement.jsonl');
  writeFileSync(replacement, JSON.stringify({ id: 'replacement', status: 'done' }) + '\n');
  renameSync(replacement, join(dir, 'index.jsonl'));
  assert.deepEqual(reader.listTasks().map(task => task.id), ['replacement']);
  assert.equal(reader.getTask('existing'), null);
});

test('scoped export reads event logs only for tasks within the final result', t => {
  const dir = mkdtempSync(join(tmpdir(), 'task-viewer-scoped-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const recorder = createTaskRecorder({ storeDir: dir, maxTasks: 5 });
  recorder.startTask({ id: 'older-match', chatId: 'target' });
  t.mock.timers.tick(1000);
  recorder.startTask({ id: 'newest-match', chatId: 'target' });
  t.mock.timers.tick(1000);
  recorder.startTask({ id: 'other', chatId: 'other' });
  // A directory is deliberately unreadable as an event file. Neither record
  // can appear in the result, so the recorder must never try reading it.
  for (const id of ['older-match', 'other']) {
    const path = join(dir, 'tasks', id + '.jsonl');
    rmSync(path);
    mkdirSync(path);
  }
  const results = recorder.exportTasks({ limit: 1, scanLimit: 5, scope: { chatId: 'target' } });
  assert.deepEqual(results.map(task => task.id), ['newest-match']);
  assert.equal(results[0].events[0].type, 'task_started');
});

test('task recorder keeps running tasks after history reaches the retention limit', t => {
  const dir = mkdtempSync(join(tmpdir(), 'task-viewer-retention-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const recorder = createTaskRecorder({ storeDir: dir, maxTasks: 1 });
  const first = recorder.startTask({ id: 'first' });
  t.mock.timers.tick(1000);
  const second = recorder.startTask({ id: 'second' });
  recorder.finishTask(second.id);

  const restored = createTaskRecorder({ storeDir: dir, maxTasks: 1 });
  assert.ok(restored.getTask(first.id).events.some(event => event.type === 'task_started'));
  assert.equal(restored.addEvent(first.id, 'task_progress', { text: 'still running' }).text, 'still running');
  t.mock.timers.tick(1000);
  assert.equal(restored.finishTask(first.id).status, 'done');
  assert.deepEqual(restored.listTasks().map(task => task.id), [first.id]);
});

test('task recorder marks stale running tasks interrupted on startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-viewer-stale-'));
  try {
    const recorder = createTaskRecorder({ storeDir: dir, maxTasks: 5 });
    const task = recorder.startTask({
      prompt: '长任务',
      chatId: 'oc_demo',
      chatType: 'group',
      messageId: 'om_demo',
      contextKey: 'chat:oc_demo',
      cwd: '/tmp/repo',
      sandbox: 'read-only',
    });
    recorder.patchTask(task.id, { progressCardMessageId: 'om_progress_card' });

    const restored = createTaskRecorder({ storeDir: dir, maxTasks: 5 });
    const interrupted = restored.interruptRunningTasks('Bridge restarted before final reply.');
    const stale = restored.getTask(task.id);

    assert.equal(interrupted.length, 1);
    assert.equal(interrupted[0].id, task.id);
    assert.equal(interrupted[0].chatType, 'group');
    assert.equal(interrupted[0].progressCardMessageId, 'om_progress_card');
    assert.equal(stale.status, 'failed');
    assert.match(stale.errorText, /Bridge restarted/);
    assert.equal(stale.events.some(event => event.reason === 'bridge_restart'), true);

    const count = restored.markRunningTasksInterrupted('Bridge restarted before final reply.');
    assert.equal(count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task viewer renders a static visual timeline', () => {
  const tasks = [{
    id: 'task_demo',
    status: 'done',
    title: '看一下 bridge 进度',
    prompt: '看一下 bridge 进度',
    chatId: 'oc_demo',
    messageId: 'om_demo',
    contextKey: 'chat:oc_demo',
    cwd: '/tmp/repo',
    sandbox: 'read-only',
    backend: 'codex',
    runtime: 'exec',
    sessionId: '019f-session',
    tokens: 123,
    startedAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:02.000Z',
    finishedAt: '2026-06-16T00:00:02.000Z',
    finalText: '完成',
    events: [
      { type: 'task_started', ts: '2026-06-16T00:00:00.000Z', text: '开始' },
      { type: 'task_progress', ts: '2026-06-16T00:00:01.000Z', text: '运行命令：rg task' },
      { type: 'task_done', ts: '2026-06-16T00:00:02.000Z', text: '完成' },
    ],
  }];
  const html = renderTaskViewerHtml({ tasks, title: 'Bridge Task Session Viewer' });
  assert.match(html, /Bridge Task Session Viewer/);
  assert.match(html, /看一下 bridge 进度/);
  assert.match(html, /运行命令：rg task/);
  assert.match(html, /可分享过程/);
  assert.match(html, /飞书用户请求/);
  assert.match(html, /机器人分析\/操作进度/);
  assert.match(html, /机器人最终回复/);
  assert.match(html, /Codex Session<\/b><code>019f-session/);
  assert.match(html, /chat-bubble/);
  assert.match(html, /复制气泡/);
});

test('task viewer filters exported tasks by task or conversation scope', () => {
  const tasks = [
    { id: 'task_one', chatId: 'oc_a', contextKey: 'chat:oc_a', messageId: 'om_a1' },
    { id: 'task_two', chatId: 'oc_a', contextKey: 'chat:oc_a', messageId: 'om_a2' },
    { id: 'task_three', chatId: 'oc_b', contextKey: 'chat:oc_b', messageId: 'om_b1' },
  ];

  assert.deepEqual(normalizeTaskViewerScope({ task_id: 'task_one' }), { taskId: 'task_one' });
  assert.deepEqual(
    filterTaskViewerTasks(tasks, { task_id: 'task_one' }).map(task => task.id),
    ['task_one'],
  );
  assert.deepEqual(
    filterTaskViewerTasks(tasks, { context_key: 'chat:oc_a' }).map(task => task.id),
    ['task_one', 'task_two'],
  );
  assert.deepEqual(
    filterTaskViewerTasks(tasks, { chatId: 'oc_b' }).map(task => task.id),
    ['task_three'],
  );
  assert.equal(
    taskViewerTitleForScope({ chat_id: 'oc_a' }),
    'Bridge Task Session Viewer - 飞书会话 oc_a',
  );
});

test('writeTaskViewerSite writes static index and json payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-viewer-site-'));
  try {
    const file = writeTaskViewerSite({ outDir: dir, tasks: [], title: 'Viewer' });
    assert.equal(file, join(dir, 'index.html'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
