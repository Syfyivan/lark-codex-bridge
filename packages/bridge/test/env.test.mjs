import assert from 'node:assert/strict';
import test from 'node:test';

import { envFlag, envFlagValue, parseReactionRules, splitCsv } from '../src/env.mjs';

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
