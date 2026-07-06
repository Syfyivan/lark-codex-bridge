import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cappedTimeoutMs,
  envFlag,
  envFlagValue,
  firstNonBlank,
  optionalTimeoutMs,
  parseReactionRules,
  splitCsv,
} from '../src/env.mjs';

test('splitCsv trims and removes empty items', () => {
  assert.deepEqual(splitCsv(' a, ,b,, c '), ['a', 'b', 'c']);
});

test('envFlagValue handles common false values and defaults', () => {
  assert.equal(envFlagValue(undefined, true), true);
  assert.equal(envFlagValue(null, false), false);
  assert.equal(envFlagValue('0'), false);
  assert.equal(envFlagValue('false'), false);
  assert.equal(envFlagValue('off'), false);
  assert.equal(envFlagValue('1'), true);
  assert.equal(envFlagValue('yes'), true);
});

test('envFlag reads from a provided env object', () => {
  assert.equal(envFlag({ FEATURE: '1' }, 'FEATURE'), true);
  assert.equal(envFlag({ FEATURE: 'no' }, 'FEATURE'), false);
  assert.equal(envFlag({}, 'FEATURE', true), true);
});

test('firstNonBlank returns the first configured value', () => {
  assert.equal(firstNonBlank('', undefined, '  ', '60000'), '60000');
  assert.equal(firstNonBlank('0', '60000'), '0');
  assert.equal(firstNonBlank('', null), undefined);
});

test('optionalTimeoutMs treats blank or non-positive values as no timeout', () => {
  assert.equal(optionalTimeoutMs(undefined), 0);
  assert.equal(optionalTimeoutMs(''), 0);
  assert.equal(optionalTimeoutMs('0'), 0);
  assert.equal(optionalTimeoutMs('-1'), 0);
  assert.equal(optionalTimeoutMs('60000'), 60000);
});

test('cappedTimeoutMs preserves short command caps when runner timeout is disabled', () => {
  assert.equal(cappedTimeoutMs(0, 60_000), 60_000);
  assert.equal(cappedTimeoutMs(undefined, 60_000), 60_000);
  assert.equal(cappedTimeoutMs(120_000, 60_000), 60_000);
  assert.equal(cappedTimeoutMs(30_000, 60_000), 30_000);
});

test('parseReactionRules normalizes supported rule shapes', () => {
  assert.deepEqual(
    parseReactionRules(
      JSON.stringify([
        { emoji: 'eyes', contains: [' review ', ''] },
        { emoji_type: 'rocket', regex: 'ship', case_sensitive: true },
        { emoji: '', contains: 'ignored' },
      ]),
    ),
    [
      {
        index: 0,
        emoji: 'eyes',
        contains: ['review'],
        pattern: '',
        flags: 'i',
        caseSensitive: false,
      },
      {
        index: 1,
        emoji: 'rocket',
        contains: [],
        pattern: 'ship',
        flags: 'i',
        caseSensitive: true,
      },
    ],
  );
});

test('parseReactionRules rejects non-array JSON', () => {
  assert.throws(() => parseReactionRules('{}'), /must be a JSON array/);
});
