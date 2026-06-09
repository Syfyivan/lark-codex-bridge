import assert from 'node:assert/strict';
import test from 'node:test';

import { closeUnclosedCodeFence } from '../src/lark-format.mjs';

test('closeUnclosedCodeFence leaves balanced fences unchanged', () => {
  assert.equal(closeUnclosedCodeFence('```js\n1\n```'), '```js\n1\n```');
});

test('closeUnclosedCodeFence closes an odd fence count', () => {
  assert.equal(closeUnclosedCodeFence('```js\n1'), '```js\n1\n```');
});

test('closeUnclosedCodeFence handles empty values', () => {
  assert.equal(closeUnclosedCodeFence(null), '');
});
