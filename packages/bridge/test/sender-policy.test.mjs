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

test('shouldSkipSenderPolicy does not cap traced relay turns by default', () => {
  assert.equal(
    shouldSkipSenderPolicy({
      senderType: 'bot',
      trace: { id: 't', turn: 30, legacyMaxTurns: 3 },
      hasActionableText: true,
      mentionsBot: true,
    }),
    '',
  );
});

test('shouldSkipSenderPolicy enforces optional hard trace turn caps', () => {
  assert.equal(
    shouldSkipSenderPolicy({ senderType: 'bot', trace: { id: 't', turn: 50 }, loopHardMaxTurns: 50 }),
    'max_turns_reached',
  );
});

test('shouldSkipSenderPolicy rejects expired relay traces', () => {
  assert.equal(
    shouldSkipSenderPolicy({
      trace: { id: 't', turn: 8, startedAt: 1_000, ttlMs: 10_000 },
      senderType: 'bot',
      nowMs: 12_001,
    }),
    'trace_expired',
  );

  assert.equal(
    shouldSkipSenderPolicy({
      trace: { id: 't', turn: 8, startedAt: 1_000, ttlMs: 10_000 },
      senderType: 'user',
      nowMs: 12_001,
    }),
    '',
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

test('shouldSkipSenderPolicy can restrict bot relay to an allowlist', () => {
  assert.equal(
    shouldSkipSenderPolicy({
      senderType: 'bot',
      senderId: 'ou_other_bot',
      loopBotAllowSenderIds: ['ou_colleague_bot'],
      hasActionableText: true,
      mentionsBot: true,
    }),
    'bot_sender_not_allowed',
  );
});

test('shouldSkipSenderPolicy can require bridge_trace from bot senders', () => {
  assert.equal(
    shouldSkipSenderPolicy({
      senderType: 'bot',
      senderId: 'ou_colleague_bot',
      loopBotAllowSenderIds: ['ou_colleague_bot'],
      loopRequireTraceFromBotSenders: true,
      hasActionableText: true,
      mentionsBot: true,
    }),
    'bot_sender_missing_trace',
  );

  assert.equal(
    shouldSkipSenderPolicy({
      senderType: 'bot',
      senderId: 'ou_colleague_bot',
      loopBotAllowSenderIds: ['ou_colleague_bot'],
      loopRequireTraceFromBotSenders: true,
      trace: { id: 'relay', turn: 12, startedAt: 1_000, ttlMs: 10_000 },
      nowMs: 5_000,
      hasActionableText: true,
      mentionsBot: true,
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
