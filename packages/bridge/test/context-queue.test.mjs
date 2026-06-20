import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conversationKeyForEvent,
  createContextQueueRuntime,
  createStopRegistry,
  isStopCommand,
  parseQueueCommand,
} from '../src/context-queue.mjs';

test('parseQueueCommand and isStopCommand recognize control commands', () => {
  assert.deepEqual(parseQueueCommand('/queue 继续查第二个问题'), { text: '继续查第二个问题' });
  assert.deepEqual(parseQueueCommand('/queue'), { text: '' });
  assert.equal(parseQueueCommand('queue hello'), null);
  assert.equal(isStopCommand('/stop'), true);
  assert.equal(isStopCommand('/停止 当前任务'), true);
  assert.equal(isStopCommand('/logs 20'), false);
});

test('conversationKeyForEvent prefers thread-level context when present', () => {
  assert.equal(
    conversationKeyForEvent({ chatId: 'oc_1', chatType: 'group' }),
    'chat:oc_1',
  );
  assert.equal(
    conversationKeyForEvent({ chatId: 'oc_1', chatType: 'topic_group', threadId: 'omt_1' }),
    'thread:oc_1:omt_1',
  );
  assert.equal(
    conversationKeyForEvent({ chatId: 'oc_p2p', chatType: 'p2p', senderId: 'ou_1' }),
    'p2p:oc_p2p',
  );
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
