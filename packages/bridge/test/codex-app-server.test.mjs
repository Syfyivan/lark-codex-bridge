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
import * as codexAppServer from '../src/codex-app-server.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    if (method === 'thread/resume') {
      return { thread: { id: params.threadId } };
    }
    if (method === 'thread/name/set') return {};
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

class NotificationItemsAppServerClient extends FakeAppServerClient {
  async request(method, params) {
    if (method !== 'turn/start') return super.request(method, params);
    this.calls.push({ method, params });
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    setImmediate(() => {
      this.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: params.threadId,
          turnId,
          item: { id: `agent-${turnId}`, type: 'agentMessage', text: `answer ${turnId}` },
        },
      });
      this.emit('notification', {
        method: 'turn/completed',
        params: {
          threadId: params.threadId,
          turn: { id: turnId, status: 'completed', items: [] },
        },
      });
    });
    return { turn: { id: turnId, status: 'inProgress' } };
  }
}

class CommentaryThenFinalAppServerClient extends FakeAppServerClient {
  async request(method, params) {
    if (method !== 'turn/start') return super.request(method, params);
    this.calls.push({ method, params });
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    setImmediate(() => {
      this.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: params.threadId,
          turnId,
          item: {
            id: `commentary-${turnId}`,
            type: 'agentMessage',
            text: 'I will inspect the remaining evidence.',
          },
        },
      });
      this.emit('notification', {
        method: 'turn/completed',
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: 'completed',
            items: [{
              id: `final-${turnId}`,
              type: 'agentMessage',
              text: '{"reply_text":"final review result"}',
            }],
          },
        },
      });
    });
    return { turn: { id: turnId, status: 'inProgress' } };
  }
}

class ConcurrentTurnDetectingClient extends FakeAppServerClient {
  constructor() {
    super();
    this.activeTurns = 0;
    this.maxActiveTurns = 0;
  }

  async request(method, params) {
    if (method !== 'turn/start') return super.request(method, params);
    this.calls.push({ method, params });
    this.turnCount += 1;
    this.activeTurns += 1;
    this.maxActiveTurns = Math.max(this.maxActiveTurns, this.activeTurns);
    const turnId = `turn-${this.turnCount}`;
    setTimeout(() => {
      this.activeTurns -= 1;
      this.emit('notification', {
        method: 'turn/completed',
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: 'completed',
            items: [{ id: `agent-${turnId}`, type: 'agentMessage', text: `answer ${turnId}` }],
          },
        },
      });
    }, 20);
    return { turn: { id: turnId, status: 'inProgress' } };
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
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      client.calls.find(call => call.method === 'thread/start').params,
      'runtimeWorkspaceRoots',
    ),
    false,
  );
  assert.equal(client.calls.filter(call => call.method === 'turn/start').length, 2);
  assert.equal(client.calls.find(call => call.method === 'turn/start').params.input[0].text.includes('prefix'), true);
  assert.deepEqual(progressItems, ['运行命令：rg bridge']);
});

test('Codex app-server runner keeps the final agent item emitted before turn completion', async () => {
  const client = new NotificationItemsAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig(), {
    appServerClient: client,
    clampReply: value => String(value).trim(),
  });

  const result = await runner.run('prompt', { contextKey: 'chat:oc_group' });

  assert.equal(result.text, 'answer turn-1');
});

test('Codex app-server runner prefers the completed turn answer over earlier commentary', async () => {
  const client = new CommentaryThenFinalAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig(), {
    appServerClient: client,
    clampReply: value => String(value).trim(),
  });

  const result = await runner.run('prompt', { contextKey: 'chat:oc_group' });

  assert.equal(result.text, '{"reply_text":"final review result"}');
});

test('Codex app-server runner serializes turns that share one session', async () => {
  const client = new ConcurrentTurnDetectingClient();
  const runner = createCodexAppServerRunner(baseConfig(), {
    appServerClient: client,
    clampReply: value => String(value).trim(),
  });

  const results = await Promise.all([
    runner.run('first', { contextKey: 'chat:oc_group' }),
    runner.run('second', { contextKey: 'chat:oc_group' }),
  ]);

  assert.deepEqual(results.map(result => result.text), ['answer turn-1', 'answer turn-2']);
  assert.equal(client.maxActiveTurns, 1);
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

test('Codex session store persists one active session per group and keeps reply bindings', () => {
  assert.equal(typeof codexAppServer.createCodexSessionStore, 'function');
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-sessions-'));
  const file = join(root, 'sessions.json');
  const first = codexAppServer.createCodexSessionStore({ file });

  first.record('chat:oc_group', { id: 'thread-1', title: '需求初始讨论', cwd: '/repo' });
  first.bindMessages('chat:oc_group', 'thread-1', ['om_first', 'omt_first']);
  first.record('chat:oc_group', { id: 'thread-2', title: '修复上传状态', cwd: '/repo' });

  const restored = codexAppServer.createCodexSessionStore({ file });
  assert.equal(restored.active('chat:oc_group').id, 'thread-2');
  assert.equal(restored.resolve('chat:oc_group', ['omt_first']).session.id, 'thread-1');
  assert.equal(restored.resolve('chat:oc_group', []).session.id, 'thread-2');
  assert.equal(
    restored.resolve('chat:oc_group', ['om_unbound'], { fallbackToActive: false }).session,
    null,
  );
  assert.deepEqual(restored.list('chat:oc_group').map(item => item.id), ['thread-2', 'thread-1']);

  assert.equal(restored.activate('chat:oc_group', '2').id, 'thread-1');
  assert.equal(restored.active('chat:oc_group').id, 'thread-1');
});

test('Codex app-server runner resumes the persisted group session after restart', async () => {
  assert.equal(typeof codexAppServer.createCodexSessionStore, 'function');
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-runner-'));
  const file = join(root, 'sessions.json');
  const firstClient = new FakeAppServerClient();
  const firstRunner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: firstClient,
    sessionStore: codexAppServer.createCodexSessionStore({ file }),
  });

  const first = await firstRunner.run('first prompt', {
    contextKey: 'chat:oc_group',
    sessionTitle: '需求群 · 首个任务',
    messageIds: ['om_first'],
  });
  assert.equal(first.sessionId, 'thread-1');
  assert.equal(firstClient.calls.some(call => call.method === 'thread/name/set'), true);

  const secondClient = new FakeAppServerClient();
  const secondRunner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: secondClient,
    sessionStore: codexAppServer.createCodexSessionStore({ file }),
  });
  const resumed = await secondRunner.run('second prompt', {
    contextKey: 'chat:oc_group',
    messageIds: ['om_second'],
  });

  assert.equal(resumed.sessionId, 'thread-1');
  assert.equal(secondClient.calls.filter(call => call.method === 'thread/start').length, 0);
  assert.equal(secondClient.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(secondClient.calls.find(call => call.method === 'turn/start').params.threadId, 'thread-1');
});

test('task-scoped sessions isolate new requests in one group and run them concurrently', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-task-sessions-'));
  const client = new ConcurrentTurnDetectingClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });
  const shared = {
    sessionScopeKey: 'chat:oc_group',
    sessionSafetyKey: 'member:read-only:project-a',
    resumeActiveSession: false,
    activateSession: false,
  };

  const results = await Promise.all([
    runner.run('query user 1001 points', {
      ...shared,
      contextKey: 'task:oc_group:om_points',
      messageIds: ['om_points'],
    }),
    runner.run('query user 2002 signup', {
      ...shared,
      contextKey: 'task:oc_group:om_signup',
      messageIds: ['om_signup'],
    }),
  ]);

  assert.equal(new Set(results.map(result => result.sessionId)).size, 2);
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 2);
  assert.equal(client.maxActiveTurns, 2);
  assert.equal(runner.listSessions(shared).length, 2);
});

test('turns stay serialized when two task bindings point to one Session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-shared-session-'));
  const client = new ConcurrentTurnDetectingClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });
  const shared = {
    sessionScopeKey: 'chat:oc_group',
    sessionSafetyKey: 'owner:read-only:project-a',
    resumeActiveSession: false,
    activateSession: false,
  };
  const first = await runner.run('seed task', {
    ...shared,
    contextKey: 'task:oc_group:om_first',
    messageIds: ['om_first'],
  });
  runner.useSession({
    ...shared,
    contextKey: 'task:oc_group:om_second',
    selector: first.sessionId,
    messageIds: ['om_second'],
  });

  await Promise.all([
    runner.run('continue first binding', {
      ...shared,
      contextKey: 'task:oc_group:om_first',
      messageIds: ['om_first'],
    }),
    runner.run('continue second binding', {
      ...shared,
      contextKey: 'task:oc_group:om_second',
      messageIds: ['om_second'],
    }),
  ]);

  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(client.maxActiveTurns, 1);
});

test('task-scoped session resumes by topic binding after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-task-resume-'));
  const file = join(root, 'sessions.json');
  const options = {
    contextKey: 'task:oc_group:omt_points',
    sessionScopeKey: 'chat:oc_group',
    sessionSafetyKey: 'member:read-only:project-a',
    resumeActiveSession: false,
    activateSession: false,
  };
  const firstClient = new FakeAppServerClient();
  const firstRunner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: firstClient,
    sessionStore: codexAppServer.createCodexSessionStore({ file }),
  });

  const first = await firstRunner.run('query points', {
    ...options,
    messageIds: ['om_first', 'omt_points'],
  });

  const secondClient = new FakeAppServerClient();
  const secondRunner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: secondClient,
    sessionStore: codexAppServer.createCodexSessionStore({ file }),
  });
  const second = await secondRunner.run('query point details', {
    ...options,
    messageIds: ['om_reply', 'omt_points'],
  });

  assert.equal(second.sessionId, first.sessionId);
  assert.equal(secondClient.calls.filter(call => call.method === 'thread/start').length, 0);
  assert.equal(secondClient.calls.filter(call => call.method === 'thread/resume').length, 1);
});

test('task-scoped routing migrates an existing group message binding on first use', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-task-migration-'));
  const file = join(root, 'sessions.json');
  const store = codexAppServer.createCodexSessionStore({ file });
  store.record('chat:oc_group', {
    id: 'thread-legacy',
    title: 'legacy group task',
    cwd: '/workspace',
    sandbox: 'read-only',
  });
  store.bindMessages('chat:oc_group', 'thread-legacy', ['omt_legacy']);

  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file }),
  });
  const result = await runner.run('continue legacy topic', {
    contextKey: 'task:oc_group:omt_legacy',
    sessionScopeKey: 'chat:oc_group',
    sessionSafetyKey: 'owner:read-only:workspace',
    messageIds: ['om_reply', 'omt_legacy'],
    resumeActiveSession: false,
    activateSession: false,
  });

  assert.equal(result.sessionId, 'thread-legacy');
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 0);
  assert.equal(client.calls.filter(call => call.method === 'thread/resume').length, 1);
  assert.equal(runner.listSessions({
    sessionScopeKey: 'chat:oc_group',
    sessionSafetyKey: 'owner:read-only:workspace',
  })[0].id, 'thread-legacy');
});

test('stable safety policy keeps a member task session across disposable cwd changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-member-scratch-'));
  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });
  const shared = {
    contextKey: 'task:oc_group:omt_points',
    sessionScopeKey: 'chat:oc_group',
    sessionSafetyKey: 'member:read-only:project-a',
    sandbox: 'workspace-write',
    resumeActiveSession: false,
    activateSession: false,
  };

  const first = await runner.run('first query', {
    ...shared,
    cwd: '/tmp/member-run-1',
    messageIds: ['om_first', 'omt_points'],
  });
  const second = await runner.run('follow-up query', {
    ...shared,
    cwd: '/tmp/member-run-2',
    messageIds: ['om_reply', 'omt_points'],
  });

  assert.equal(second.sessionId, first.sessionId);
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(client.calls.filter(call => call.method === 'thread/resume').length, 1);
});

test('persistent sessions isolate custom cwd and sandbox from the default group session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-safety-context-'));
  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });

  const owner = await runner.run('owner task', {
    contextKey: 'chat:oc_group',
    cwd: '/workspace',
    sandbox: 'read-only',
  });
  const delegated = await runner.run('delegated task', {
    contextKey: 'chat:oc_group',
    cwd: '/tmp/non-owner',
    sandbox: 'workspace-write',
  });

  assert.notEqual(owner.sessionId, delegated.sessionId);
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 2);
  assert.equal(client.calls.filter(call => call.method === 'thread/resume').length, 0);
  assert.equal(runner.activeSession({ contextKey: 'chat:oc_group' }).id, owner.sessionId);
});

test('persistent group sessions reject missing context before starting a thread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-missing-context-'));
  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });

  await assert.rejects(runner.run('missing context'), /missing Codex session context key/);
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 0);
});

test('Codex app-server runner can create and switch group sessions explicitly', async () => {
  assert.equal(typeof codexAppServer.createCodexSessionStore, 'function');
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-switch-'));
  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });

  await runner.run('first prompt', { contextKey: 'chat:oc_group' });
  const created = await runner.newSession({
    contextKey: 'chat:oc_group',
    title: '第二个需求',
    cwd: '/workspace',
    sandbox: 'read-only',
  });
  assert.equal(created.id, 'thread-2');
  assert.equal(runner.listSessions({ contextKey: 'chat:oc_group' })[0].id, 'thread-2');

  const selected = runner.useSession({ contextKey: 'chat:oc_group', selector: '2' });
  assert.equal(selected.id, 'thread-1');
  const result = await runner.run('back to first', { contextKey: 'chat:oc_group' });
  assert.equal(result.sessionId, 'thread-1');
});

test('persistent group sessions do not resume across different safety contexts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-codex-safety-'));
  const client = new FakeAppServerClient();
  const runner = createCodexAppServerRunner(baseConfig({ codexEphemeral: false }), {
    appServerClient: client,
    sessionStore: codexAppServer.createCodexSessionStore({ file: join(root, 'sessions.json') }),
  });

  await runner.run('owner task', {
    contextKey: 'chat:oc_group',
    cwd: '/workspace',
    sandbox: 'workspace-write',
  });
  const second = await runner.run('member task', {
    contextKey: 'chat:oc_group',
    cwd: '/scratch/member',
    sandbox: 'read-only',
  });

  assert.equal(second.sessionId, 'thread-2');
  assert.equal(client.calls.filter(call => call.method === 'thread/start').length, 2);
  assert.equal(client.calls.filter(call => call.method === 'thread/resume').length, 0);
});
