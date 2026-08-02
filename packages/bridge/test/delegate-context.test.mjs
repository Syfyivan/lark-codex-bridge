import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDelegateRecentChatContext } from '../src/delegate-context.mjs';

test('delegate recent chat context formats polled messages chronologically', () => {
  const context = buildDelegateRecentChatContext([
    {
      message_id: 'm3',
      content: '最新消息',
      create_time: '2026-07-08 16:34',
      sender: { name: '刘炳阳' },
    },
    {
      message_id: 'm2',
      content: '@宋一凡 ？',
      create_time: '2026-07-08 16:33',
      sender: { name: '刘炳阳' },
      reply_to: 'm1',
    },
    {
      message_id: 'm1',
      content: '前面这个预算是多少',
      create_time: '2026-07-08 16:32',
      sender: { name: '邱旻飞' },
    },
  ], {
    targetMessageId: 'm2',
    maxMessages: 3,
  });

  assert.match(context, /已由 bridge 预读取/);
  assert.ok(context.indexOf('邱旻飞: 前面这个预算是多少') < context.indexOf('刘炳阳: @宋一凡 ？'));
  assert.match(context, /message_id=m2, reply_to=m1, target=true/);
  assert.ok(context.indexOf('刘炳阳: @宋一凡 ？') < context.indexOf('刘炳阳: 最新消息'));
});

test('delegate recent chat context skips deleted messages and clamps long content', () => {
  const context = buildDelegateRecentChatContext([
    {
      message_id: 'deleted',
      content: '不要出现',
      deleted: true,
      sender: { name: 'A' },
    },
    {
      message_id: 'long',
      content: 'x'.repeat(120),
      create_time: '2026-07-08 16:35',
      sender: { name: 'B' },
    },
  ], {
    maxContentChars: 30,
  });

  assert.doesNotMatch(context, /不要出现/);
  assert.match(context, /B: x+/);
  assert.match(context, /\.\.\./);
});
