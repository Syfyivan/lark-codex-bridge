import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDirectExecution,
  isReviewAutomationOnlySensitive,
  sensitiveOperationKeywordMatches,
} from '../src/sensitive-policy.mjs';

test('sensitiveOperationKeywordMatches detects destructive local operations', () => {
  assert.deepEqual(
    sensitiveOperationKeywordMatches('帮我把 novel_unify_admin_activity 这个代码仓库删除吧'),
    ['删除/移除'],
  );
});

test('sensitiveOperationKeywordMatches allows read-only investigation wording', () => {
  assert.deepEqual(
    sensitiveOperationKeywordMatches('查一下运营后台前端代码，总结一下活动期间哪些配置可以改'),
    [],
  );
});

test('classifyDirectExecution treats bridge send/share/review commands as sensitive', () => {
  assert.equal(classifyDirectExecution('发给机器人 知微 hello', { botSendCommand: {} }).sensitive, true);
  assert.deepEqual(
    classifyDirectExecution('分享会话 xxx', { sessionShareCommand: { intent: 'share' } }),
    {
      sensitive: true,
      labels: ['生成/部署会话快照'],
      executionKind: 'session_share',
    },
  );
  assert.deepEqual(
    classifyDirectExecution('找一下 xxx 的会话', { sessionShareCommand: { intent: 'find' } }),
    {
      sensitive: false,
      labels: [],
      executionKind: 'direct_codex',
    },
  );
  assert.equal(classifyDirectExecution('帮忙 review MR', { reviewAutomation: true }).sensitive, true);
});

test('isReviewAutomationOnlySensitive rejects review requests that include unrelated destructive actions', () => {
  assert.equal(
    isReviewAutomationOnlySensitive(
      classifyDirectExecution('可以给 A', { reviewAutomation: true }),
    ),
    true,
  );
  assert.equal(
    isReviewAutomationOnlySensitive(
      classifyDirectExecution('可以给 A，顺便删除本地仓库', { reviewAutomation: true }),
    ),
    false,
  );
});
