import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createTaskRecorder } from '../src/task-recorder.mjs';
import { renderTaskViewerHtml, writeTaskViewerSite } from '../src/task-viewer.mjs';

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
