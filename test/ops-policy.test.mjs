import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkCodexAppServerSteerSupport,
  clampLogLines,
  formatHealthReport,
  parseOpsCommand,
} from '../src/ops-policy.mjs';

test('parseOpsCommand handles health version logs and help aliases', () => {
  assert.deepEqual(parseOpsCommand('/ops'), { action: 'help' });
  assert.deepEqual(parseOpsCommand('/admin 帮助'), { action: 'help' });
  assert.deepEqual(parseOpsCommand('/health'), { action: 'health' });
  assert.deepEqual(parseOpsCommand('/ops status'), { action: 'health' });
  assert.deepEqual(parseOpsCommand('/版本'), { action: 'version' });
  assert.deepEqual(parseOpsCommand('/ops 日志 200'), { action: 'logs', lines: 80 });
  assert.deepEqual(parseOpsCommand('/whatever'), null);
});

test('clampLogLines keeps log output bounded', () => {
  assert.equal(clampLogLines(), 30);
  assert.equal(clampLogLines('abc'), 30);
  assert.equal(clampLogLines('1'), 5);
  assert.equal(clampLogLines('80'), 80);
  assert.equal(clampLogLines('120'), 80);
});

test('checkCodexAppServerSteerSupport detects required protocol methods', async () => {
  const check = await checkCodexAppServerSteerSupport({
    codexBin: 'codex',
    now: () => 1000,
    runProcess: async (_command, args) => {
      assert.deepEqual(args.slice(0, 3), ['app-server', 'generate-ts', '--out']);
      const outDir = args[3];
      assert.equal(existsSync(outDir), true);
      writeFileSync(
        join(outDir, 'ClientRequest.ts'),
        [
          '{ "method": "turn/steer", id: RequestId, params: TurnSteerParams }',
          '{ "method": "turn/interrupt", id: RequestId, params: TurnInterruptParams }',
        ].join('\n'),
      );
      return { stdout: '', stderr: '' };
    },
  });
  assert.equal(check.state, 'pass');
  assert.equal(check.ok, true);
  assert.equal(check.detail, 'turn/steer + turn/interrupt available');
});

test('checkCodexAppServerSteerSupport reports missing protocol methods', async () => {
  const check = await checkCodexAppServerSteerSupport({
    runProcess: async (_command, args) => {
      writeFileSync(join(args[3], 'ClientRequest.ts'), '{ "method": "turn/steer" }');
      return { stdout: '', stderr: '' };
    },
  });
  assert.equal(check.state, 'fail');
  assert.match(check.detail, /turn\/interrupt/);
});

test('formatHealthReport includes startup checks', () => {
  const report = formatHealthReport({
    timeIso: '2026-06-12T00:00:00.000Z',
    version: '0.3.0',
    pid: 123,
    uptimeSec: 5,
    mode: 'codex',
    eventEnabled: true,
    httpHost: '127.0.0.1',
    httpPort: 8787,
    codexCwd: '/tmp/repo',
    codexRunner: 'exec',
    codexSandbox: 'danger-full-access',
    codexNonOwnerSandbox: 'workspace-write',
    sessionShareOutput: 'goofy',
    startupChecks: [{
      id: 'codex-app-server-steer',
      label: 'Codex app-server steer',
      state: 'pass',
      detail: 'turn/steer + turn/interrupt available',
    }],
  });
  assert.match(report, /Lark Codex Bridge Health/);
  assert.match(report, /codexRunner: exec/);
  assert.match(report, /\[OK\] Codex app-server steer/);
});
