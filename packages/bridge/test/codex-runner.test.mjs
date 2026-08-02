import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  createCodexExecRunner,
  createNonOwnerCodexExecutionContext,
  nonOwnerGuardNotice,
  normalizeNonOwnerSandboxMode,
  normalizeSandboxMode,
  parseCodexProgressLine,
  summarizeCommandForProgress,
} from '../src/codex-runner.mjs';

test('normalizeSandboxMode accepts only supported Codex sandbox modes', () => {
  assert.equal(normalizeSandboxMode('read-only'), 'read-only');
  assert.equal(normalizeSandboxMode('workspace-write'), 'workspace-write');
  assert.equal(normalizeSandboxMode('danger-full-access'), 'danger-full-access');
  assert.equal(normalizeSandboxMode('invalid', 'workspace-write'), 'workspace-write');
});

test('normalizeNonOwnerSandboxMode never returns danger-full-access', () => {
  assert.equal(normalizeNonOwnerSandboxMode(), 'workspace-write');
  assert.equal(normalizeNonOwnerSandboxMode('read-only'), 'read-only');
  assert.equal(normalizeNonOwnerSandboxMode('workspace-write'), 'workspace-write');
  assert.equal(normalizeNonOwnerSandboxMode('danger-full-access'), 'workspace-write');
});

test('createNonOwnerCodexExecutionContext creates and cleans a scratch cwd', () => {
  const context = createNonOwnerCodexExecutionContext({
    codexNonOwnerScratchRoot: tmpdir(),
    codexNonOwnerSandbox: 'workspace-write',
    codexCwd: '/real/workspace',
  });

  assert.equal(context.sandbox, 'workspace-write');
  assert.equal(context.realWorkspace, '/real/workspace');
  assert.match(context.cwd, /lark-codex-non-owner-/);
  assert.equal(existsSync(context.cwd), true);

  context.cleanup();
  assert.equal(existsSync(context.cwd), false);
});

test('createNonOwnerCodexExecutionContext can carry an oncall real workspace', () => {
  const context = createNonOwnerCodexExecutionContext(
    {
      codexNonOwnerScratchRoot: tmpdir(),
      codexNonOwnerSandbox: 'workspace-write',
      codexCwd: '/default/workspace',
    },
    { realWorkspace: '/oncall/workspace' },
  );

  assert.equal(context.realWorkspace, '/oncall/workspace');
  assert.notEqual(context.cwd, '/oncall/workspace');
  context.cleanup();
});

test('nonOwnerGuardNotice describes scratch and real workspaces', () => {
  const text = nonOwnerGuardNotice(
    { codexCwd: '/real/workspace' },
    { cwd: '/tmp/scratch', realWorkspace: '/real/workspace' },
  );

  assert.match(text, /真实工作区：\/real\/workspace/);
  assert.match(text, /一次性临时目录：\/tmp\/scratch/);
  assert.match(text, /禁止改真实仓库或真实文件/);
});

test('parseCodexProgressLine summarizes Codex JSON events', () => {
  assert.equal(parseCodexProgressLine(JSON.stringify({ type: 'turn.started' })), 'Codex 已开始分析。');
  assert.equal(
    parseCodexProgressLine(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'rg foo' }) },
      }),
    ),
    '搜索相关代码和调用关系',
  );
  assert.equal(
    parseCodexProgressLine(
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', content: [{ text: '阶段完成' }] },
      }),
    ),
    '阶段完成',
  );
});

test('summarizeCommandForProgress hides shell syntax behind readable progress text', () => {
  assert.equal(
    summarizeCommandForProgress(
      `/bin/zsh -lc 'TMP=$(cat /tmp/domain_activity_base_mr189_repo_path.txt); grep -RIn "withGameInvasionReadDB" "$TMP/service/activity"'`,
    ),
    '搜索相关代码和调用关系',
  );
  assert.equal(
    summarizeCommandForProgress(
      'bytedcli --json codebase mr diff 189 -R novel/domain_activity_base --file handler.go',
    ),
    '分析 MR 代码变更',
  );
  assert.equal(
    summarizeCommandForProgress('git rev-parse --show-toplevel && git status --short'),
    '确认仓库、分支与提交状态',
  );
  assert.equal(
    summarizeCommandForProgress('printf complicated-shell-syntax'),
    '执行下一步分析检查',
  );
});

test('createCodexExecRunner wraps codex exec behind a stable runner interface', async () => {
  let captured = null;
  const runner = createCodexExecRunner(
    {
      codexBin: 'codex-test',
      codexPromptPrefix: 'prefix',
      codexSandbox: 'read-only',
      codexCwd: '/workspace',
      codexTimeoutMs: 1234,
      codexModel: '',
      codexResume: '',
      codexSkipGitRepoCheck: true,
      codexEphemeral: true,
    },
    {
      clampReply: value => String(value).trim(),
      runProcessFn: async (command, args, options) => {
        captured = { command, args, options };
        const outputIndex = args.indexOf('--output-last-message') + 1;
        assert.ok(outputIndex > 0);
        writeFileSync(args[outputIndex], ' final reply \n');
        return { stdout: 'ignored stdout', stderr: '' };
      },
    },
  );

  const reply = await runner.run('hello', {
    cwd: '/other-workspace',
    sandbox: 'workspace-write',
  });

  assert.equal(runner.id, 'exec');
  assert.equal(reply, 'final reply');
  assert.equal(captured.command, 'codex-test');
  assert.deepEqual(captured.args.slice(0, 5), ['exec', '--cd', '/other-workspace', '--sandbox', 'workspace-write']);
  assert.equal(captured.args.includes('--skip-git-repo-check'), true);
  assert.equal(captured.args.includes('--ephemeral'), true);
  assert.equal(captured.options.cwd, '/other-workspace');
  assert.equal(captured.options.timeoutMs, 1234);
  assert.match(captured.options.stdin, /prefix/);
  assert.match(captured.options.stdin, /飞书用户消息：\nhello/);
});

test('codex exec receives capability-scoped config before starting', async () => {
  let capturedArgs = [];
  const runner = createCodexExecRunner(
    {
      codexBin: 'codex-test',
      codexPromptPrefix: 'prefix',
      codexSandbox: 'read-only',
      codexCwd: '/workspace',
      codexTimeoutMs: 1234,
      codexModel: '',
      codexResume: '',
      codexSkipGitRepoCheck: true,
      codexEphemeral: true,
    },
    {
      runProcessFn: async (_command, args) => {
        capturedArgs = args;
        const outputIndex = args.indexOf('--output-last-message') + 1;
        writeFileSync(args[outputIndex], 'done');
        return { stdout: '', stderr: '' };
      },
    },
  );

  await runner.run('hello', {
    codexApprovalPolicy: 'never',
    codexConfigArgs: [
      '--disable', 'plugins',
      '--config', 'mcp_servers={}',
      '--config', 'skills.include_instructions=false',
    ],
  });

  assert.equal(capturedArgs.includes('approval_policy="never"'), true);
  assert.equal(capturedArgs.includes('plugins'), true);
  assert.equal(capturedArgs.includes('mcp_servers={}'), true);
  assert.equal(capturedArgs.includes('skills.include_instructions=false'), true);
});
