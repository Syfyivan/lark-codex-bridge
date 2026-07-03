import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBridgeApprovalCardText,
  shouldSkipBridgeGeneratedMessage,
} from '../src/approval-message-policy.mjs';

test('isBridgeApprovalCardText detects sensitive operation approval cards', () => {
  const text = [
    '<card title="需要你确认本机操作">',
    '**请求 ID**：op-96d4e3b1',
    '确认前不会启动 Codex 执行；只有宋一凡本人点击按钮有效。',
    '按钮不可用时，在本话题 @机器人回复：同意执行 op-96d4e3b1 / 取消执行 op-96d4e3b1',
    '</card>',
  ].join('\n');

  assert.equal(isBridgeApprovalCardText(text), true);
});

test('isBridgeApprovalCardText detects delegate reply approval cards', () => {
  const text = [
    '<card title="有人 @ 你，已拟好回复">',
    '**请求 ID**：abc123',
    '同意后会回复到原消息话题/线程，不刷主群。',
    '按钮不可用时，直接回复：同意发送 abc123 / 取消发送 abc123',
    '</card>',
  ].join('\n');

  assert.equal(isBridgeApprovalCardText(text), true);
});

test('shouldSkipBridgeGeneratedMessage skips deleted messages and approval cards', () => {
  assert.equal(
    shouldSkipBridgeGeneratedMessage({ deleted: true }),
    'deleted_message',
  );
  assert.equal(
    shouldSkipBridgeGeneratedMessage({
      rawText: '确认前不会启动 Codex 执行。同意执行 op-a / 取消执行 op-a',
      senderId: 'cli_bridge',
      botAppId: 'cli_bridge',
    }),
    'bridge_approval_card',
  );
});

test('shouldSkipBridgeGeneratedMessage skips self-authored interactive messages', () => {
  assert.equal(
    shouldSkipBridgeGeneratedMessage({
      messageType: 'interactive',
      senderId: 'cli_bridge',
      botAppId: 'cli_bridge',
    }),
    'self_interactive_message',
  );

  assert.equal(
    shouldSkipBridgeGeneratedMessage({
      messageType: 'post',
      senderId: 'cli_other',
      botAppId: 'cli_bridge',
      rawText: '@宋一凡 麻烦 review 一下 MR',
    }),
    '',
  );
});
