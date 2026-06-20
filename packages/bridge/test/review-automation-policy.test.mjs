import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canDirectReviewAutomation,
  extractCodebaseMrUrls,
  hasApproveShorthand,
  isAiPolishedHumanRelayText,
  shouldTriggerReviewAutomation,
} from '../src/review-automation-policy.mjs';

const AI_POLISHED_APPROVE_REQUEST = [
  '（本条消息来自邵泽本人发出，只是经过 ai 润色）',
  '@宋一凡 rpc_id 已合，剩余两个 MR 可以继续 A 了，辛苦有空帮看下～',
  'domain_activity_base!153: https://code.byted.org/novel/domain_activity_base/merge_requests/153',
  'activity_scripts!140: https://code.byted.org/novel/activity_scripts/merge_requests/140',
].join('\n');

test('extractCodebaseMrUrls reads Codebase merge request links once', () => {
  assert.deepEqual(
    extractCodebaseMrUrls(`${AI_POLISHED_APPROVE_REQUEST}\n${AI_POLISHED_APPROVE_REQUEST}`),
    [
      'https://code.byted.org/novel/domain_activity_base/merge_requests/153',
      'https://code.byted.org/novel/activity_scripts/merge_requests/140',
    ],
  );
});

test('isAiPolishedHumanRelayText recognizes explicitly human-authored AI-polished relay messages', () => {
  assert.equal(isAiPolishedHumanRelayText(AI_POLISHED_APPROVE_REQUEST), true);
  assert.equal(isAiPolishedHumanRelayText('机器人自己总结：这个 MR 可以继续 A 了'), false);
});

test('hasApproveShorthand recognizes review shorthand A without matching URLs', () => {
  assert.equal(hasApproveShorthand('剩余两个 MR 可以继续 A 了'), true);
  assert.equal(hasApproveShorthand('https://code.byted.org/novel/a/merge_requests/1'), false);
});

test('shouldTriggerReviewAutomation allows AI-polished A shorthand only with MR links', () => {
  assert.equal(
    shouldTriggerReviewAutomation({
      rawText: AI_POLISHED_APPROVE_REQUEST,
      keywordText: AI_POLISHED_APPROVE_REQUEST,
      reviewKeywords: ['review', '给 A'],
    }),
    true,
  );
  assert.equal(
    shouldTriggerReviewAutomation({
      rawText: '（本条消息来自邵泽本人发出，只是经过 ai 润色）剩余两个 MR 可以继续 A 了',
      keywordText: '剩余两个 MR 可以继续 A 了',
      reviewKeywords: ['review', '给 A'],
    }),
    false,
  );
});

test('canDirectReviewAutomation trusts owners and explicit AI-polished bot relays only', () => {
  assert.equal(canDirectReviewAutomation({ requesterIsOwner: true }), true);
  assert.equal(
    canDirectReviewAutomation({
      senderIsKnownBot: true,
      rawText: AI_POLISHED_APPROVE_REQUEST,
    }),
    true,
  );
  assert.equal(
    canDirectReviewAutomation({
      senderIsKnownBot: false,
      rawText: AI_POLISHED_APPROVE_REQUEST,
    }),
    false,
  );
});
