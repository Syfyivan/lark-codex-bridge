import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearOncallBinding,
  getOncallBinding,
  normalizeOncallPath,
  parseOncallCommand,
  readOncallBindings,
  setOncallBinding,
} from '../src/oncall-policy.mjs';

test('parseOncallCommand handles bind status unbind and help', () => {
  assert.deepEqual(parseOncallCommand('/oncall'), { action: 'status' });
  assert.deepEqual(parseOncallCommand('/oncall status'), { action: 'status' });
  assert.deepEqual(parseOncallCommand('/oncall 状态'), { action: 'status' });
  assert.deepEqual(parseOncallCommand('/oncall bind ~/repo'), { action: 'bind', path: '~/repo' });
  assert.deepEqual(parseOncallCommand('/oncall 绑定 /repo'), { action: 'bind', path: '/repo' });
  assert.deepEqual(parseOncallCommand('/oncall unbind'), { action: 'unbind' });
  assert.deepEqual(parseOncallCommand('/oncall 解绑'), { action: 'unbind' });
  assert.deepEqual(parseOncallCommand('/oncall nope'), { action: 'help' });
  assert.equal(parseOncallCommand('/health'), null);
});

test('normalizeOncallPath resolves home absolute and relative paths', () => {
  assert.equal(normalizeOncallPath('~/repo', { home: '/home/user' }), '/home/user/repo');
  assert.equal(normalizeOncallPath('/repo', { cwd: '/tmp' }), '/repo');
  assert.equal(normalizeOncallPath('repo', { cwd: '/tmp' }), '/tmp/repo');
});

test('oncall bindings are read set queried and cleared', () => {
  const missing = readOncallBindings('/missing.json', { exists: () => false });
  const bound = setOncallBinding(missing, 'oc_x', {
    cwd: '/repo',
    ownerOpenId: 'ou_owner',
    createdAt: '2026-06-15T00:00:00.000Z',
  });

  assert.equal(getOncallBinding(bound, 'oc_x').cwd, '/repo');
  assert.equal(getOncallBinding(bound, 'oc_x').ownerOpenId, 'ou_owner');
  assert.equal(getOncallBinding(clearOncallBinding(bound, 'oc_x'), 'oc_x'), null);
});
