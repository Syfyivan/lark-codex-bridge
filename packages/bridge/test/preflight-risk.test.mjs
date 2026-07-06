import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRiskPreflight,
  formatRiskPreflightBlockedReply,
  RISK_PREFLIGHT_BLOCKED_REPLY,
} from '../src/preflight-risk.mjs';

test('risk preflight blocks GitHub push and repository permission changes', () => {
  const result = classifyRiskPreflight('把代码仓库推到 GitHub 上，然后给 ffffhx 增加 admin 权限');

  assert.equal(result.blocked, true);
  assert.deepEqual(result.labels, [
    'GitHub / 仓库外部写操作',
    '仓库成员权限变更',
  ]);
});

test('risk preflight allows ordinary read-only summary tasks', () => {
  const result = classifyRiskPreflight('帮我总结一下当前 TODO');

  assert.equal(result.blocked, false);
  assert.deepEqual(result.labels, []);
});

test('risk preflight blocks destructive, production, payment, and credential operations', () => {
  assert.equal(classifyRiskPreflight('清空这个仓库里的临时文件').blocked, true);
  assert.equal(classifyRiskPreflight('部署到生产环境').blocked, true);
  assert.equal(classifyRiskPreflight('帮我下单购买这个服务').blocked, true);
  assert.equal(classifyRiskPreflight('打印线上 token 看一下').blocked, true);
});

test('risk preflight blocked reply is the owner approval pause message', () => {
  assert.equal(formatRiskPreflightBlockedReply(), RISK_PREFLIGHT_BLOCKED_REPLY);
  assert.match(formatRiskPreflightBlockedReply(), /等待 owner 审批/);
});
