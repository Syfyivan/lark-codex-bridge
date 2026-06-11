import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  createNonOwnerCodexExecutionContext,
  nonOwnerGuardNotice,
  normalizeNonOwnerSandboxMode,
  normalizeSandboxMode,
  parseCodexProgressLine,
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
    '运行命令：rg foo',
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
