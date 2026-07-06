import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIRECT_TASK_HEARTBEATS,
  DIRECT_TASK_RECEIVED_TEXT,
  DIRECT_TASK_STARTED_TEXT,
  formatDirectTaskFailureReply,
  formatDirectTaskStoppedReply,
  sanitizeBridgeStatusText,
} from '../src/progress-messages.mjs';

test('progress messages expose immediate receive, start, and bounded heartbeat text', () => {
  assert.equal(DIRECT_TASK_RECEIVED_TEXT, '已收到，正在判断任务范围和执行环境。');
  assert.equal(DIRECT_TASK_STARTED_TEXT, '已开始执行，我会在这里同步关键进展。');
  assert.ok(DIRECT_TASK_HEARTBEATS.length >= 3);
  assert.ok(DIRECT_TASK_HEARTBEATS.every(text => text.startsWith('仍在处理：')));
});

test('failure summary is structured and redacts sensitive details', () => {
  const reply = formatDirectTaskFailureReply(
    new Error('failed at /Users/bytedance/code/private token=abc123 user=a@example.com'),
  );

  assert.match(reply, /当前状态：失败/);
  assert.match(reply, /是否修改了代码：未知/);
  assert.doesNotMatch(reply, /\/Users\/bytedance/);
  assert.doesNotMatch(reply, /abc123/);
  assert.doesNotMatch(reply, /a@example\.com/);
  assert.match(reply, /\[local-path\]/);
  assert.match(reply, /token=\[redacted\]/);
  assert.match(reply, /\[email\]/);
});

test('stopped summary is structured as blocked', () => {
  const reply = formatDirectTaskStoppedReply();

  assert.match(reply, /当前状态：已阻断/);
  assert.match(reply, /验证结果：未完成/);
});

test('status sanitizer clamps long text', () => {
  const text = sanitizeBridgeStatusText('x'.repeat(100), 8);

  assert.equal(text, 'xxxxxxxx\n...');
});
