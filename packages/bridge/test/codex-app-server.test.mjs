import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  appServerInputFromPrompt,
  createCodexAppServerRunner,
  extractFinalAgentText,
  normalizeCodexRuntime,
  summarizeAppServerNotification,
} from '../src/codex-app-server.mjs';

function baseConfig(patch = {}) {
  return {
    codexBin: 'codex',
    codexCwd: '/workspace',
    codexSandbox: 'read-only',
    codexModel: '',
    codexPromptPrefix: 'prefix',
    codexEphemeral: true,
    codexTimeoutMs: 1000,
    codexAppServerRequestTimeoutMs: 1000,
    ...patch,
  };
}

class FakeAppServerClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.threadCount = 0;
    this.turnCount = 0;
  }

  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') {
      this.threadCount += 1;
      return { thread: { id: `thread-${this.threadCount}` } };
    }
    if (method === 'turn/start') {
      this.turnCount += 1;
      const turnId = `turn-${this.turnCount}`;
      setImmediate(() => {
        this.emit('notification', {
          method: 'item/completed',
          params: {
            threadId: params.threadId,
            turnId,
            item: { type: 'commandExecution', command: 'rg bridge' },
          },
        });
        this.emit('notification', {
          method: 'turn/completed',
          params: {
            threadId: params.threadId,
            turn: {
              id: turnId,
              status: 'completed',
              items: [{ type: 'agentMessage', text: `answer ${turnId}` }],
            },
          },
        });
      });
      return { turn: { id: turnId, status: 'inProgress' } };
    }
    if (method === 'turn/interrupt') return {};
    throw new Error(`unexpected method ${method}`);
  }
}

test('normalizeCodexRuntime accepts exec app-server and auto', () => {
  assert.equal(normalizeCodexRuntime('exec'), 'exec');
  assert.equal(normalizeCodexRuntime('appserver'), 'app-server');
  assert.equal(normalizeCodexRuntime('app-server'), 'app-server');
  assert.equal(normalizeCodexRuntime('auto'), 'auto');
  assert.equal(normalizeCodexRuntime('unknown'), 'exec');
});

test('app-server helpers extract inputs and final assistant text', () => {
  assert.deepEqual(appServerInputFromPrompt('hello'), [{ type: 'text', text: 'hello', text_elements: [] }]);
  assert.equal(
    extractFinalAgentText({
      items: [
        { type: 'agentMessage', text: 'first' },
        { type: 'commandExecution', command: 'pwd' },
        { type: 'agentMessage', text: 'final' },
      ],
    }),
    'final',
  );
  assert.equal(
    summarizeAppServerNotification({
      method: 'item/completed',
      params: { item: { type: 'commandExecution', command: 'rg foo' } },
    }),
    '运行命令：rg foo',
  );
});

test('Codex app-server runner reuses a thread for the same context key', async () => {
  const client = new FakeAppServerClient();
  const progressItems = [];
  const runner = createCodexAppServerRunner(baseConfig(), {
    appServerClient: client,
    clampReply: value => String(value).trim(),
  });

  const first = await runner.run('first prompt', {
    contextKey: 'thread:oc_x:root',
    progress: { add: item => progressItems.push(item) },
  });
  const second = await runner.run('second prompt', {
    contextKey: 'thread:oc_x:root',
  });

  assert.equal(first.text, 'answer turn-1');
  assert.equal(second.text, 'answer turn-2');
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 2);
  assert.equal(client.calls.find(call => call.method === 'turn/start').params.input[0].text.includes('prefix'), true);
  assert.deepEqual(progressItems, ['运行命令：rg bridge']);
});

test('Codex app-server runner starts separate threads for different safety contexts', async () => {
  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig(), {
    appServerClient: client,
  });

  await runner.run('owner', { contextKey: 'chat:oc_x', cwd: '/workspace', sandbox: 'workspace-write' });
  await runner.run('readonly', { contextKey: 'chat:oc_x', cwd: '/scratch', sandbox: 'read-only' });

  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 2);
});
