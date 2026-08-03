import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDelegateCodexRunOptions } from '../src/delegate-run-options.mjs';

test('delegate Codex run options preserve persistent session context', () => {
  const progress = { add() {} };
  const signal = new AbortController().signal;
  const options = buildDelegateCodexRunOptions({
    progress,
    contextKey: 'chat:oc_group',
    cwd: '/workspace',
    sandbox: 'danger-full-access',
    signal,
    messageIds: ['om_message', 'omt_thread'],
    sessionTitle: 'Lark · MR review 自动化',
  });

  assert.deepEqual(options, {
    progress,
    contextKey: 'chat:oc_group',
    cwd: '/workspace',
    sandbox: 'danger-full-access',
    signal,
    messageIds: ['om_message', 'omt_thread'],
    sessionTitle: 'Lark · MR review 自动化',
  });
});

test('delegate Codex run options copy message ids and omit absent optional values', () => {
  const messageIds = ['om_message'];
  const options = buildDelegateCodexRunOptions({
    contextKey: 'chat:oc_group',
    cwd: '/scratch',
    sandbox: 'workspace-write',
    messageIds,
  });

  messageIds.push('om_later');
  assert.deepEqual(options, {
    contextKey: 'chat:oc_group',
    cwd: '/scratch',
    sandbox: 'workspace-write',
    messageIds: ['om_message'],
  });
});
