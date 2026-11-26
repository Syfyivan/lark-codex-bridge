import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conversationKeyForEvent,
  createContextQueueRuntime,
  createStopRegistry,
  isStopCommand,
  parseQueueCommand,
} from '../src/context-queue.mjs';
import * as contextQueue from '../src/context-queue.mjs';

test('parseQueueCommand and isStopCommand recognize control commands', () => {
  assert.deepEqual(parseQueueCommand('/queue 继续查第二个问题'), { text: '继续查第二个问题' });
  assert.deepEqual(parseQueueCommand('/queue'), { text: '' });
  assert.equal(parseQueueCommand('queue hello'), null);
  assert.equal(isStopCommand('/stop'), true);
  assert.equal(isStopCommand('/停止 当前任务'), true);
  assert.equal(isStopCommand('/logs 20'), false);
});

test('conversationKeyForEvent can isolate group tasks while keeping p2p continuity', () => {
  assert.equal(
    conversationKeyForEvent({ chatId: 'oc_1', chatType: 'group' }),
    'chat:oc_1',
  );
  assert.equal(
    conversationKeyForEvent({ chatId: 'oc_1', chatType: 'topic_group', threadId: 'omt_1' }),
    'chat:oc_1',
  );
  assert.equal(
    conversationKeyForEvent({
      chatId: 'oc_1',
      chatType: 'topic_group',
      threadId: 'omt_1',
      groupScoped: false,
    }),
    'task:oc_1:omt_1',
  );
  assert.equal(
    conversationKeyForEvent({
      chatId: 'oc_1',
      chatType: 'group',
      messageId: 'om_new_task',
      groupScoped: false,
    }),
    'task:oc_1:om_new_task',
  );
  assert.equal(
    conversationKeyForEvent({
      chatId: 'oc_1',
      chatType: 'group',
      messageId: 'om_reply',
      threadId: 'omt_generated',
      rootId: 'om_new_task',
      groupScoped: false,
    }),
    'task:oc_1:om_new_task',
  );
  assert.equal(
    conversationKeyForEvent({
      chatId: 'oc_1',
      chatType: 'topic_group',
      messageId: 'om_reply',
      threadId: 'omt_topic',
      rootId: 'om_topic_root',
      groupScoped: false,
    }),
    'task:oc_1:omt_topic',
  );
  assert.equal(
    conversationKeyForEvent({
      chatId: 'oc_p2p',
      chatType: 'p2p',
      senderId: 'ou_1',
      messageId: 'om_p2p',
      groupScoped: false,
    }),
    'p2p:oc_p2p',
  );
});

test('parseCodexSessionCommand recognizes group session controls', () => {
  assert.equal(typeof contextQueue.parseCodexSessionCommand, 'function');
  assert.deepEqual(contextQueue.parseCodexSessionCommand('/new 修复上传状态'), {
    action: 'new',
    title: '修复上传状态',
  });
  assert.deepEqual(contextQueue.parseCodexSessionCommand('新建一个 session'), {
    action: 'new',
    title: '',
  });
  assert.deepEqual(contextQueue.parseCodexSessionCommand('/sessions'), { action: 'list' });
  assert.deepEqual(contextQueue.parseCodexSessionCommand('/session'), { action: 'status' });
  assert.deepEqual(contextQueue.parseCodexSessionCommand('/use 2'), { action: 'use', selector: '2' });
  assert.equal(contextQueue.parseCodexSessionCommand('/queue hello'), null);
});

test('codexSessionMessageIds keeps stable message and topic references once', () => {
  assert.equal(typeof contextQueue.codexSessionMessageIds, 'function');
  assert.deepEqual(contextQueue.codexSessionMessageIds({
    messageId: 'om_message',
    rootId: 'omt_root',
    parentId: 'om_parent',
    replyToMessageId: 'om_parent',
  }), ['om_message', 'omt_root', 'om_parent']);
});

test('executeCodexSessionCommand enforces owner and running-task boundaries', async () => {
  assert.equal(typeof contextQueue.executeCodexSessionCommand, 'function');
  let newSessionCalls = 0;
  const runner = {
    async newSession() {
      newSessionCalls += 1;
      return { id: 'thread-new', title: '新需求' };
    },
    listSessions() {
      return [];
    },
    activeSession() {
      return null;
    },
    useSession() {
      return null;
    },
  };

  const denied = await contextQueue.executeCodexSessionCommand({
    command: { action: 'new', title: '新需求' },
    runner,
    contextKey: 'chat:oc_1',
    isOwner: false,
  });
  assert.match(denied.message, /只有 bridge owner/);

  const busy = await contextQueue.executeCodexSessionCommand({
    command: { action: 'new', title: '新需求' },
    runner,
    contextKey: 'chat:oc_1',
    isOwner: true,
    activeCount: 1,
  });
  assert.match(busy.message, /\/stop/);

  const ephemeral = await contextQueue.executeCodexSessionCommand({
    command: { action: 'new', title: '新需求' },
    runner: { ...runner, persistentSessions: false },
    contextKey: 'chat:oc_1',
    isOwner: true,
  });
  assert.match(ephemeral.message, /CODEX_EPHEMERAL=0/);
  assert.equal(newSessionCalls, 0);
});

test('executeCodexSessionCommand creates, lists, reports, and switches group sessions', async () => {
  assert.equal(typeof contextQueue.executeCodexSessionCommand, 'function');
  const sessions = [
    { id: 'thread-2', title: '第二个需求', cwd: '/repo', updatedAt: '2026-07-13T02:00:00.000Z' },
    { id: 'thread-1', title: '第一个需求', cwd: '/repo', updatedAt: '2026-07-13T01:00:00.000Z' },
  ];
  let active = sessions[0];
  let newOptions = null;
  let useOptions = null;
  const runner = {
    async newSession(options) {
      newOptions = options;
      active = { id: 'thread-3', title: options.title, cwd: options.cwd };
      sessions.unshift(active);
      return active;
    },
    listSessions() {
      return sessions;
    },
    activeSession() {
      return active;
    },
    resolveSession({ messageIds }) {
      return messageIds.includes('om_new') ? active : null;
    },
    useSession(options) {
      useOptions = options;
      active = options.selector === '2' ? sessions[1] : null;
      return active;
    },
  };

  const created = await contextQueue.executeCodexSessionCommand({
    command: { action: 'new', title: '' },
    runner,
    contextKey: 'task:oc_1:om_new',
    sessionScopeKey: 'chat:oc_1',
    sessionSafetyKey: 'owner:project-a',
    isOwner: true,
    cwd: '/repo',
    sandbox: 'workspace-write',
    messageIds: ['om_new'],
    defaultTitle: '需求群 · 新会话',
  });
  assert.equal(newOptions.title, '需求群 · 新会话');
  assert.deepEqual(newOptions.messageIds, ['om_new']);
  assert.equal(newOptions.contextKey, 'task:oc_1:om_new');
  assert.equal(newOptions.sessionScopeKey, 'chat:oc_1');
  assert.match(created.message, /thread-3/);

  const listed = await contextQueue.executeCodexSessionCommand({
    command: { action: 'list' },
    runner,
    contextKey: 'chat:oc_1',
    messageIds: ['om_new'],
  });
  assert.match(listed.message, /\[当前话题\]/);
  assert.match(listed.message, /第二个需求/);

  const status = await contextQueue.executeCodexSessionCommand({
    command: { action: 'status' },
    runner,
    contextKey: 'chat:oc_1',
    messageIds: ['om_new'],
  });
  assert.match(status.message, /thread-3/);

  const selected = await contextQueue.executeCodexSessionCommand({
    command: { action: 'use', selector: '2' },
    runner,
    contextKey: 'task:oc_1:om_use',
    sessionScopeKey: 'chat:oc_1',
    messageIds: ['om_use'],
    isOwner: true,
  });
  assert.match(selected.message, /thread-2/);
  assert.deepEqual(useOptions.messageIds, ['om_use']);
  assert.equal(useOptions.sessionScopeKey, 'chat:oc_1');
});

test('createContextQueueRuntime serializes tasks per context only', async () => {
  const running = [];
  const started = [];
  const release = {};
  const runtime = createContextQueueRuntime({
    contextKeyForItem: item => item.context,
    runItem: async item => {
      running.push(item.id);
      started.push(item.id);
      await new Promise(resolve => {
        release[item.id] = resolve;
      });
      running.splice(running.indexOf(item.id), 1);
    },
  });

  const first = runtime.dispatch({ id: 'a1', context: 'a' });
  const second = runtime.dispatch({ id: 'a2', context: 'a' });
  const other = runtime.dispatch({ id: 'b1', context: 'b' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(first.status, 'started');
  assert.equal(second.status, 'queued');
  assert.equal(second.position, 1);
  assert.equal(other.status, 'started');
  assert.deepEqual(started.sort(), ['a1', 'b1']);
  assert.equal(runtime.activeCount('a'), 1);
  assert.equal(runtime.queuedCount('a'), 1);

  release.a1();
  await first.done;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.activeCount('a'), 1);
  assert.equal(runtime.queuedCount('a'), 0);
  assert.deepEqual(started.sort(), ['a1', 'a2', 'b1']);

  release.a2();
  release.b1();
  await Promise.all([second.done, other.done]);
});

test('createContextQueueRuntime runs independent task contexts up to the global limit', async () => {
  const started = [];
  const release = {};
  const runtime = createContextQueueRuntime({
    maxConcurrent: 2,
    contextKeyForItem: item => item.context,
    runItem: async item => {
      started.push(item.id);
      await new Promise(resolve => {
        release[item.id] = resolve;
      });
    },
  });

  const first = runtime.dispatch({ id: 'task-1', context: 'task:chat:1' });
  const second = runtime.dispatch({ id: 'task-2', context: 'task:chat:2' });
  const third = runtime.dispatch({ id: 'task-3', context: 'task:chat:3' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(first.status, 'started');
  assert.equal(second.status, 'started');
  assert.equal(third.status, 'queued');
  assert.equal(runtime.maxConcurrent, 2);
  assert.equal(runtime.activeTotal(), 2);
  assert.deepEqual(started.sort(), ['task-1', 'task-2']);

  release['task-1']();
  await first.done;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.activeTotal(), 2);
  assert.deepEqual(started.sort(), ['task-1', 'task-2', 'task-3']);

  release['task-2']();
  release['task-3']();
  await Promise.all([second.done, third.done]);
});

test('queue totals track bypassed, cleared, and failed tasks', async () => {
  const gate = Promise.withResolvers();
  const errors = [];
  const runtime = createContextQueueRuntime({
    maxConcurrent: 1,
    contextKeyForItem: item => item.context,
    runItem: ({ id }) => {
      if (id === 'fail') throw new Error(id);
      return gate.promise;
    },
    onError: (_, error) => errors.push(error.message),
  });
  const running = runtime.dispatch({ id: 'running', context: 'same' });
  const cleared = runtime.dispatch({ id: 'cleared', context: 'same' });
  const next = runtime.dispatch({ id: 'fail', context: 'other' });
  const bypassed = runtime.dispatch({ id: 'bypass', context: 'same' }, { bypassQueue: true });
  assert.equal(runtime.activeTotal(), 2);
  assert.equal(runtime.queuedTotal(), 2);
  assert.equal(runtime.clearQueued('same'), 1);
  await cleared.done;
  assert.equal(runtime.queuedTotal(), 1);
  gate.resolve();
  await Promise.all([running.done, bypassed.done, next.done]);
  assert.deepEqual(errors, ['fail']);
  assert.equal(runtime.activeTotal(), 0);
  assert.equal(runtime.queuedTotal(), 0);
});

test('queue concurrency remains a positive integer for fractional or invalid configuration', () => {
  for (const [value, expected] of [
    [undefined, 4], ['', 4], ['  ', 4], ['invalid', 4], [NaN, 4], [Infinity, 4],
    ['Infinity', 4], [-1, 1], [0, 1], [0.5, 1], ['2.9', 2], [3, 3],
  ]) {
    const runtime = createContextQueueRuntime({ maxConcurrent: value, runItem: async () => {} });
    assert.equal(runtime.maxConcurrent, expected, String(value));
  }
});

test('invalid concurrency keeps excess tasks queued until a slot becomes available', async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const runtime = createContextQueueRuntime({
    maxConcurrent: 'invalid',
    contextKeyForItem: item => item.id,
    runItem: () => blocked,
  });
  const tasks = Array.from({ length: 5 }, (_, id) => runtime.dispatch({ id }));
  assert.deepEqual(tasks.map(task => task.status), ['started', 'started', 'started', 'started', 'queued']);
  assert.equal(runtime.activeTotal(), 4);
  assert.equal(runtime.queuedTotal(), 1);
  release();
  await Promise.all(tasks.map(task => task.done));
  assert.equal(runtime.activeTotal(), 0);
  assert.equal(runtime.queuedTotal(), 0);
});

test('clearQueued resolves queued tasks without running them', async () => {
  const started = [];
  const release = {};
  const runtime = createContextQueueRuntime({
    contextKeyForItem: item => item.context,
    runItem: async item => {
      started.push(item.id);
      await new Promise(resolve => {
        release[item.id] = resolve;
      });
    },
  });

  const first = runtime.dispatch({ id: 'a1', context: 'a' });
  const second = runtime.dispatch({ id: 'a2', context: 'a' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.clearQueued('a'), 1);
  await second.done;
  assert.deepEqual(started, ['a1']);
  release.a1();
  await first.done;
});

for (const front of [false, true]) {
  test(`clearQueued discards the old scheduling position when requeued with front=${front}`, async t => {
    const started = [];
    let release;
    const blocked = new Promise(resolve => {
      release = resolve;
    });
    t.after(() => release());
    const runtime = createContextQueueRuntime({
      maxConcurrent: 1,
      contextKeyForItem: item => item.context,
      runItem: async item => {
        started.push(item.id);
        if (item.id === 'active') await blocked;
      },
    });

    const active = runtime.dispatch({ id: 'active', context: 'active' });
    const cancelled = runtime.dispatch({ id: 'cancelled', context: 'retry' });
    const waiting = runtime.dispatch({ id: 'waiting', context: 'waiting' });
    assert.equal(runtime.clearQueued('retry'), 1);
    assert.equal(runtime.clearQueued('retry'), 0);
    await cancelled.done;
    assert.deepEqual(started, ['active']);

    const retried = runtime.dispatch({ id: 'retried', context: 'retry' }, { front });
    assert.equal(retried.status, 'queued');
    assert.equal(runtime.queuedTotal(), 2);
    release();
    await Promise.all([active.done, waiting.done, retried.done]);

    assert.deepEqual(started, front
      ? ['active', 'retried', 'waiting']
      : ['active', 'waiting', 'retried']);
    assert.equal(runtime.activeTotal(), 0);
    assert.equal(runtime.queuedTotal(), 0);
  });
}

test('createStopRegistry aborts active controllers and records cancellation', () => {
  let now = 100;
  const registry = createStopRegistry({ now: () => now });
  const controller = new AbortController();
  const unregister = registry.register('chat:1', controller);

  assert.equal(registry.activeCount('chat:1'), 1);
  const result = registry.cancel('chat:1', 'manual stop');
  assert.equal(result.cancelledAt, 100);
  assert.equal(result.aborted, 1);
  assert.equal(controller.signal.aborted, true);
  assert.equal(registry.isCancelled('chat:1', 99), true);
  assert.equal(registry.isCancelled('chat:1', 101), false);

  unregister();
  assert.equal(registry.activeCount('chat:1'), 0);
});

test('createStopRegistry can stop one task without aborting its context neighbors', () => {
  const registry = createStopRegistry();
  const first = new AbortController();
  const second = new AbortController();
  const unregisterFirst = registry.register('chat:1', first, { taskId: 'task-1' });
  const unregisterSecond = registry.register('chat:1', second, { taskId: 'task-2' });

  assert.equal(registry.activeTaskCount('task-1'), 1);
  assert.equal(registry.activeTaskCount('task-2'), 1);
  assert.deepEqual(registry.cancelTask('task-1', 'card stop'), { aborted: 1 });
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(registry.activeCount('chat:1'), 2);

  unregisterFirst();
  unregisterSecond();
  assert.equal(registry.activeTaskCount('task-1'), 0);
  assert.equal(registry.activeTaskCount('task-2'), 0);
});
