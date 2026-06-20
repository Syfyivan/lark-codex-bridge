import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClaudeCodeArgs,
  createClaudeCodeRunner,
  parseClaudeCodeOutput,
} from '../src/runners/claude-code.mjs';
import {
  buildCocoChatArgs,
  buildCocoTaskSendArgs,
  createCocoRunner,
  parseCocoOutput,
} from '../src/runners/coco.mjs';
import { createRunner } from '../src/runners/index.mjs';

function baseConfig(patch = {}) {
  return {
    mode: 'codex',
    backend: 'codex',
    codexBin: 'codex',
    codexPromptPrefix: 'prefix',
    codexSandbox: 'read-only',
    codexCwd: '/repo',
    codexTimeoutMs: 1000,
    codexModel: '',
    codexRuntime: 'exec',
    codexAppServerRequestTimeoutMs: 1000,
    codexResume: '',
    codexSkipGitRepoCheck: true,
    codexEphemeral: true,
    claudeCodeBin: 'claude',
    claudeCodeOutputFormat: 'json',
    claudeCodePermissionMode: 'plan',
    claudeCodeMaxTurns: 3,
    claudeCodeNoSessionPersistence: true,
    claudeCodeTimeoutMs: 2000,
    claudeCodeExtraArgs: [],
    bytedCliBin: 'bytedcli',
    cocoRunMode: 'chat',
    cocoRepoId: '',
    cocoCommitId: '',
    cocoTimeoutMs: 3000,
    cocoTaskWait: false,
    cocoTaskSubscribe: true,
    jwtEndpoint: 'https://jwt.example',
    serviceAccountSecret: 'secret',
    taeTargetPsm: 'psm',
    taeAgentUrl: 'https://agent.example',
    bytecloudApiUrl: 'https://api.example',
    bytecloudApiMethod: 'POST',
    bytecloudApiBody: '{"ok":true}',
    ...patch,
  };
}

test('createRunner dispatches supported backend ids', () => {
  assert.equal(createRunner(baseConfig()).id, 'codex');
  assert.equal(createRunner(baseConfig({ mode: 'claude', backend: 'claude' })).id, 'claude');
  assert.equal(createRunner(baseConfig({ mode: 'claude-code', backend: 'claude-code' })).id, 'claude');
  assert.equal(createRunner(baseConfig({ mode: 'coco', backend: 'coco' })).id, 'coco');
  assert.equal(createRunner(baseConfig({ mode: 'agent', backend: 'agent' })).id, 'agent');
  assert.equal(createRunner(baseConfig({ mode: 'api', backend: 'api' })).id, 'api');
  assert.throws(() => createRunner(baseConfig({ mode: 'unknown', backend: 'unknown' })), /Unsupported/);
});

test('Codex auto runtime falls back to exec when app-server fails', async () => {
  let captured = null;
  const runner = createRunner(baseConfig({ codexRuntime: 'auto' }), {
    appServerClient: {
      on() {},
      async request() {
        throw new Error('app-server unavailable');
      },
    },
    clampReply: value => String(value).trim(),
    runProcessFn: async (command, args, options) => {
      captured = { command, args, options };
      const outputIndex = args.indexOf('--output-last-message') + 1;
      assert.ok(outputIndex > 0);
      await import('node:fs').then(fs => fs.writeFileSync(args[outputIndex], ' fallback answer '));
      return { stdout: '', stderr: '' };
    },
  });

  const result = await runner.run('hello', { contextKey: 'chat:oc_x' });
  assert.equal(result.text, 'fallback answer');
  assert.equal(result.raw.fallback_from, 'codex-app-server');
  assert.equal(captured.command, 'codex');
});

test('Claude Code runner builds non-interactive safe default args', () => {
  assert.deepEqual(
    buildClaudeCodeArgs(baseConfig(), 'hello'),
    [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'plan',
      '--max-turns',
      '3',
      '--no-session-persistence',
      'hello',
    ],
  );
});

test('parseClaudeCodeOutput handles json and stream-json style output', () => {
  assert.deepEqual(parseClaudeCodeOutput(JSON.stringify({
    result: 'final',
    session_id: 'sess-1',
  })), {
    text: 'final',
    raw: { result: 'final', session_id: 'sess-1' },
    sessionId: 'sess-1',
  });

  const stream = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'part 1' }] } }),
    JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'part 2' }] }),
  ].join('\n');
  assert.match(parseClaudeCodeOutput(stream).text, /part 1/);
  assert.match(parseClaudeCodeOutput(stream).text, /part 2/);
});

test('createClaudeCodeRunner invokes claude CLI and returns unified result', async () => {
  let captured = null;
  const runner = createClaudeCodeRunner(baseConfig(), {
    clampReply: value => String(value).trim(),
    runProcessFn: async (command, args, options) => {
      captured = { command, args, options };
      return { stdout: JSON.stringify({ result: ' done ', session_id: 'sess' }), stderr: '' };
    },
  });

  const result = await runner.run('prompt', { cwd: '/other' });
  assert.equal(result.text, 'done');
  assert.equal(result.sessionId, 'sess');
  assert.equal(captured.command, 'claude');
  assert.equal(captured.options.cwd, '/other');
  assert.equal(captured.args.at(-1), 'prompt');
});

test('Coco chat and task args use bytedcli global --json before coco', () => {
  assert.deepEqual(
    buildCocoChatArgs(baseConfig({ cocoRepoId: '123', cocoCommitId: 'abc' }), 'hello'),
    ['--json', 'coco', 'chat', '--message', 'hello', '--no-stream', '--repo-id', '123', '--commit-id', 'abc'],
  );
  assert.deepEqual(
    buildCocoTaskSendArgs(baseConfig({
      cocoRepoId: '123',
      cocoBranch: 'main',
      cocoMergeRequestNumber: '42',
      cocoAgentName: 'sandbox',
      cocoEnvironmentVars: ['A=B'],
    }), 'fix it'),
    [
      '--json',
      'coco',
      'task',
      'send',
      '--message',
      'fix it',
      '--repo-id',
      '123',
      '--branch',
      'main',
      '--merge-request-number',
      '42',
      '--agent-name',
      'sandbox',
      '--environment-var',
      'A=B',
    ],
  );
});

test('parseCocoOutput extracts task id and visible text', () => {
  const parsed = parseCocoOutput(JSON.stringify({
    status: 'success',
    data: {
      task_id: 'task-1',
      status: 'running',
      web_url: 'https://code.byted.org/copilot/task-1',
    },
  }));
  assert.equal(parsed.taskId, 'task-1');
  assert.match(parsed.text, /task-1/);
});

test('createCocoRunner supports chat mode', async () => {
  let captured = null;
  const runner = createCocoRunner(baseConfig({ mode: 'coco', backend: 'coco', cocoRepoId: '123' }), {
    clampReply: value => String(value).trim(),
    runProcessFn: async (command, args, options) => {
      captured = { command, args, options };
      return { stdout: JSON.stringify({ data: { answer: 'coco answer' } }), stderr: '' };
    },
  });

  const result = await runner.run('hello', { cwd: '/repo' });
  assert.equal(result.text, 'coco answer');
  assert.equal(captured.command, 'bytedcli');
  assert.deepEqual(captured.args.slice(0, 4), ['--json', 'coco', 'chat', '--message']);
});

test('createCocoRunner task mode can return submitted task id without waiting', async () => {
  const runner = createCocoRunner(baseConfig({
    mode: 'coco',
    backend: 'coco',
    cocoRunMode: 'task',
    cocoRepoId: '123',
    cocoTaskWait: false,
  }), {
    clampReply: value => String(value).trim(),
    runProcessFn: async () => ({
      stdout: JSON.stringify({ data: { task_id: 'task-2', status: 'created' } }),
      stderr: '',
    }),
  });

  const result = await runner.run('fix');
  assert.equal(result.taskId, 'task-2');
  assert.match(result.text, /task-2/);
});

test('agent and api runners preserve existing JWT-backed behavior', async () => {
  const jwtResponse = {
    ok: true,
    headers: { get: name => (name === 'x-jwt-token' ? 'jwt-token' : '') },
    text: async () => '',
  };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://jwt.example') return jwtResponse;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'agent answer' } }] }),
    };
  };
  const agent = createRunner(baseConfig({ mode: 'agent', backend: 'agent' }), { fetch });
  const result = await agent.run('hi');
  assert.equal(result.text, 'agent answer');
  assert.equal(calls[1].options.headers['x-agent-target-psm'], 'psm');

  const api = createRunner(baseConfig({ mode: 'api', backend: 'api' }), {
    fetch: async (url) => {
      if (url === 'https://jwt.example') return jwtResponse;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { answer: 'api answer' } }),
      };
    },
  });
  assert.equal((await api.run('hi')).text, 'api answer');
});
