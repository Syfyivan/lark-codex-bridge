import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';

const fixture = join(process.cwd(), 'test/fixtures/profile-replay/product-group-lottery-progress');

test('profile replay validates product group shadow context fixture', () => {
  const output = execFileSync(process.execPath, [
    'scripts/profile-replay.mjs',
    '--fixture',
    fixture,
    '--mode',
    'check',
  ], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.profile, 'product_group_test');
  assert.equal(result.capability, 'product_group_shadow');
  assert.equal(result.checks.ok, true);
  assert.deepEqual(result.checks.failures, []);
  assert.equal(result.memoryBlocks.includes('Current Project Summary'), true);
});

test('profile replay can render engineering profile prompt without product marker', () => {
  const output = execFileSync(process.execPath, [
    'scripts/profile-replay.mjs',
    '--fixture',
    fixture,
    '--profile',
    'engineering_group_test',
    '--question',
    '这个需求落代码先看哪里？',
    '--mode',
    'prompt',
    '--json',
  ], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.profile, 'engineering_group_test');
  assert.equal(result.prompt.includes('工程群 Profile 测试'), true);
  assert.equal(result.prompt.includes('产品群 Profile 测试'), false);
  assert.deepEqual(result.checks.failures, []);
});
