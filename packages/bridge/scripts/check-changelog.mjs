#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { changelogRequiredButMissing, validateChangelog } from '../src/changelog-policy.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '../..');
const changelogFile = resolve(packageDir, 'CHANGELOG.md');
const baseArgIndex = process.argv.indexOf('--base');
const baseRef = baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : process.env.CHANGELOG_BASE_REF;

const errors = validateChangelog(readFileSync(changelogFile, 'utf8'));
if (baseRef && !/^0+$/.test(baseRef)) {
  const changedFiles = execFileSync(
    'git',
    ['diff', '--name-only', `${baseRef}...HEAD`, '--', 'packages/bridge'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).split(/\r?\n/).filter(Boolean);
  if (changelogRequiredButMissing(changedFiles)) {
    errors.push('packages/bridge changed without an update to packages/bridge/CHANGELOG.md');
  }
}

if (errors.length) {
  for (const error of errors) console.error(`[changelog] ${error}`);
  process.exit(1);
}

console.log('[changelog] ok');

