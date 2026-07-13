import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

let changelogPolicy = {};
try {
  changelogPolicy = await import('../src/changelog-policy.mjs');
} catch {
  // The first TDD run intentionally reaches the assertions below.
}

const packageDir = new URL('..', import.meta.url).pathname;

test('bridge package ships a Keep a Changelog file', () => {
  const changelog = join(packageDir, 'CHANGELOG.md');
  assert.equal(existsSync(changelog), true);
  assert.match(readFileSync(changelog, 'utf8'), /^# Changelog$/m);
  assert.match(readFileSync(changelog, 'utf8'), /^## \[Unreleased\]$/m);

  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(packageJson.files.includes('CHANGELOG.md'), true);
  assert.equal(typeof packageJson.scripts['changelog:check'], 'string');
});

test('changelog policy detects bridge changes without a matching entry', () => {
  assert.equal(typeof changelogPolicy.changelogRequiredButMissing, 'function');
  assert.equal(changelogPolicy.changelogRequiredButMissing([
    'packages/bridge/src/context-queue.mjs',
  ]), true);
  assert.equal(changelogPolicy.changelogRequiredButMissing([
    'packages/bridge/src/context-queue.mjs',
    'packages/bridge/CHANGELOG.md',
  ]), false);
  assert.equal(changelogPolicy.changelogRequiredButMissing([
    'packages/kodama/src/main.mjs',
  ]), false);
});

test('changelog policy validates the required headings', () => {
  assert.equal(typeof changelogPolicy.validateChangelog, 'function');
  assert.deepEqual(changelogPolicy.validateChangelog('# Changelog\n\n## [Unreleased]\n'), []);
  assert.deepEqual(changelogPolicy.validateChangelog('# Notes\n'), [
    'missing "# Changelog" heading',
    'missing "## [Unreleased]" section',
  ]);
});
