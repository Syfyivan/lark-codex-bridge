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

test('isReviewAutomationOnlySensitive ignores release and fix context inside a review request', () => {
  const rawText = [
    '@张涛-FE @宋一凡 游戏入侵 Lynx 共用分支准备上线，麻烦两位给 MR 个 A：',
    'https://code.byted.org/magic/fanqie/merge_requests/4345',
    '内容：赠卡/求卡口令回流修复，页面加载监控与诊断。',
    'CI 正在最新 HEAD 上重跑，通过后推进发布单。',
  ].join('\n');

  assert.equal(
    isReviewAutomationOnlySensitive(
      classifyDirectExecution(rawText, { reviewAutomation: true }),
    ),
    true,
  );
});

test('isReviewAutomationOnlySensitive ignores merge and release statements in a background section', () => {
  const rawText = [
    '@宋一凡 麻烦帮忙看下游戏入侵 4 张 MR 的 review：',
    'https://code.byted.org/novel/rpc_idl/merge_requests/29111',
    'https://code.byted.org/novel/domain_activity_base/merge_requests/189',
    'https://code.byted.org/novel/bff_platform_activity/merge_requests/109',
    'https://code.byted.org/pgcfe/novel_unify_admin_activity/merge_requests/117',
    '背景：功能已 PPE 验证，代码需合入走正式发布收口；今晚或明早看一眼即可。',
  ].join('\n');

  assert.equal(
    isReviewAutomationOnlySensitive(
      classifyDirectExecution(rawText, { reviewAutomation: true }),
    ),
    true,
  );
});

test('isReviewAutomationOnlySensitive still rejects explicit mixed review and release requests', () => {
  assert.equal(
    isReviewAutomationOnlySensitive(
      classifyDirectExecution(
        '麻烦 review https://code.byted.org/magic/fanqie/merge_requests/4345，顺便直接发布上线',
        { reviewAutomation: true },
      ),
    ),
    false,
  );
});
