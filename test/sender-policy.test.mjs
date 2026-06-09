import assert from 'node:assert/strict';
import test from 'node:test';

import { isKnownBotSender, shouldSkipSenderPolicy } from '../src/sender-policy.mjs';

test('isKnownBotSender recognizes Lark bot/app senders and configured ids', () => {
  assert.equal(isKnownBotSender({ senderType: 'bot' }), true);
  assert.equal(isKnownBotSender({ senderType: 'app' }), true);
  assert.equal(isKnownBotSender({ senderId: 'cli_demo' }), true);
  assert.equal(isKnownBotSender({ senderId: 'ou_bot', loopBotSenderIds: ['ou_bot'] }), true);
  assert.equal(isKnownBotSender({ senderType: 'user', senderId: 'ou_user' }), false);
});

test('shouldSkipSenderPolicy filters self, ignored, and non-allowed senders', () => {
  assert.equal(
    shouldSkipSenderPolicy({ senderId: 'ou_self', botOpenId: 'ou_self' }),
    'self_sender',
  );
  assert.equal(
    shouldSkipSenderPolicy({ senderId: 'ou_ignored', loopIgnoreSenderIds: ['ou_ignored'] }),
    'ignored_sender',
  );
  assert.equal(
    shouldSkipSenderPolicy({ senderId: 'ou_other', loopAllowSenderIds: ['ou_allowed'] }),
    'sender_not_allowed',
  );
});

test('shouldSkipSenderPolicy enforces trace turn caps', () => {
  assert.equal(
    shouldSkipSenderPolicy({ trace: { id: 't', turn: 3, maxTurns: 3 }, loopMaxTurns: 3 }),
    'max_turns_reached',
  );
});

test('shouldSkipSenderPolicy ignores ordinary bot senders by default', () => {
  assert.equal(
    shouldSkipSenderPolicy({ senderType: 'bot', hasActionableText: true }),
    'bot_sender_ignored',
  );
});

test('shouldSkipSenderPolicy allows explicit bot mentions from bot senders', () => {
  assert.equal(
    shouldSkipSenderPolicy({
      senderType: 'bot',
      hasActionableText: true,
      mentionsBot: true,
      loopRespondToBotSenders: false,
    }),
    '',
  );
});

test('shouldSkipSenderPolicy allows delegated mentions from bot senders when enabled', () => {
  assert.equal(
    shouldSkipSenderPolicy({
      senderType: 'bot',
      delegateAllowBotSenders: true,
      delegateMentionEnabled: true,
      hasActionableText: true,
      mentionsDelegate: true,
      loopRespondToBotSenders: false,
    }),
    '',
  );
});
