import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  authorizeCapabilityForActor,
  evaluateProfilePolicy,
  isProfileOwner,
  loadProfilePolicy,
  memberExecutionDenyMessage,
  resolveProfileForEvent,
  selectCapability,
  validateProfilePolicyConfig,
} from '../src/profile-policy.mjs';

const config = {
  version: 1,
  authority: {
    owners: ['ou_owner'],
    ownerBypassesCapabilities: true,
  },
  defaults: {
    groupBehavior: 'deny',
    p2pProfile: 'direct',
  },
  profiles: {
    direct: {
      id: 'direct',
      name: 'Direct',
      soul: 'direct soul',
      capabilities: [{
        id: 'chat',
        name: '普通对话',
        description: '一般问答',
        kind: 'chat',
        safeForMembers: true,
        match: ['.*'],
      }],
    },
    ops: {
      id: 'ops',
      name: 'Ops',
      soul: 'ops soul',
      denyMessage: '不在本群能力范围内。',
      capabilities: [
        {
          id: 'read_docs',
          name: '文档查询',
          description: '只读查询文档',
          kind: 'chat',
          safeForMembers: true,
          match: ['文档', '查一下'],
          allowedOpenIds: ['ou_member'],
          allowedChats: ['oc_ops'],
        },
        {
          id: 'deploy',
          name: '部署',
          description: '执行部署',
          kind: 'exec',
          safeForMembers: false,
          match: ['部署'],
        },
      ],
    },
  },
  chats: {
    oc_ops: { profile: 'ops' },
  },
};

test('validateProfilePolicyConfig rejects unsafe exec capabilities for members', () => {
  assert.throws(
    () => validateProfilePolicyConfig({
      ...config,
      profiles: {
        direct: {
          ...config.profiles.direct,
          capabilities: [{
            id: 'exec',
            name: 'exec',
            description: 'bad',
            kind: 'exec',
            safeForMembers: true,
          }],
        },
      },
    }),
    /cannot mark exec as safeForMembers/,
  );
});

test('loadProfilePolicy is opt-in and reads configured JSON when enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-policy-'));
  const file = join(dir, 'profiles.json');
  writeFileSync(file, `${JSON.stringify(config)}\n`);

  assert.equal(loadProfilePolicy({ enabled: false, configFile: file }).enabled, false);
  const loaded = loadProfilePolicy({ enabled: true, configFile: file });
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.config.profiles.ops.name, 'Ops');
});

test('resolveProfileForEvent binds chats and allows owner fallback in unconfigured groups', () => {
  assert.equal(
    resolveProfileForEvent(config, { chatId: 'oc_ops', chatType: 'group', senderId: 'ou_member' }).profile.id,
    'ops',
  );
  assert.equal(
    resolveProfileForEvent(config, { chatId: 'oc_unknown', chatType: 'group', senderId: 'ou_owner' }, {
      allowOwnerFallbackForUnconfiguredGroup: true,
    }).profile.id,
    'direct',
  );
  assert.equal(
    resolveProfileForEvent(config, { chatId: 'oc_unknown', chatType: 'group', senderId: 'ou_member' }).message,
    '这个群还没有配置 profile/capability 边界，暂不响应。',
  );
});

test('selectCapability matches allow and deny patterns', () => {
  const selected = selectCapability(config.profiles.ops, '查一下这个文档');
  assert.equal(selected.ok, true);
  assert.equal(selected.capability.id, 'read_docs');
  assert.deepEqual(selectCapability(config.profiles.ops, '天气怎么样'), {
    ok: false,
    message: '不在本群能力范围内。',
  });
});

test('authorizeCapabilityForActor enforces member and chat restrictions', () => {
  const capability = config.profiles.ops.capabilities[0];
  assert.deepEqual(authorizeCapabilityForActor(capability, 'member', {
    senderId: 'ou_member',
    chatId: 'oc_ops',
    content: '查一下文档',
  }), { ok: true });
  assert.match(authorizeCapabilityForActor(capability, 'member', {
    senderId: 'ou_other',
    chatId: 'oc_ops',
    content: '查一下文档',
  }).message, /没有被授权/);
  assert.match(authorizeCapabilityForActor(capability, 'member', {
    senderId: 'ou_member',
    chatId: 'oc_other',
    content: '查一下文档',
  }).message, /当前会话没有被授权/);
});

test('evaluateProfilePolicy blocks member execution-looking chat requests before Codex', () => {
  const policy = { enabled: true, loaded: true, path: '', config };
  const result = evaluateProfilePolicy(policy, {
    chatId: 'oc_ops',
    chatType: 'group',
    senderId: 'ou_member',
  }, '查一下文档，然后运行 `git status`');

  assert.equal(result.ok, false);
  assert.equal(result.message, memberExecutionDenyMessage);
});

test('evaluateProfilePolicy builds prompt context for allowed capability and owner bypass', () => {
  const policy = { enabled: true, loaded: true, path: '', config };
  const member = evaluateProfilePolicy(policy, {
    chatId: 'oc_ops',
    chatType: 'group',
    senderId: 'ou_member',
  }, '查一下文档');
  assert.equal(member.ok, true);
  assert.equal(member.actor, 'member');
  assert.match(member.promptContext, /当前允许能力：文档查询/);
  assert.match(member.promptContext, /ops soul/);
  assert.match(member.promptContext, /不代表提问者身份/);

  const owner = evaluateProfilePolicy(policy, {
    chatId: 'oc_ops',
    chatType: 'group',
    senderId: 'ou_owner',
  }, '部署一下');
  assert.equal(isProfileOwner(config, 'ou_owner'), true);
  assert.equal(owner.ok, true);
  assert.equal(owner.actor, 'owner');
  assert.equal(owner.capability.id, 'owner_directive');
});
