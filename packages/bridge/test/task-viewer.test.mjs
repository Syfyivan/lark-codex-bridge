import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
