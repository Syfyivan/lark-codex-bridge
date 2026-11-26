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

test('inline backticks and shorter fences inside code do not toggle a block', () => {
  const reply = 'Use inline ```code``` here.\n````markdown\n```\nexample';
  assert.equal(closeUnclosedCodeFence(reply), reply + '\n````');
  assert.equal(closeUnclosedCodeFence('Use the literal ``` in prose.'), 'Use the literal ``` in prose.');
});

test('the closing fence uses the opening character and requires a clean line', () => {
  assert.equal(closeUnclosedCodeFence('~~~text\r\n```\r\n~~~ still code'), '~~~text\r\n```\r\n~~~ still code\n~~~');
  assert.equal(closeUnclosedCodeFence('  ```text\nx\n  ````  '), '  ```text\nx\n  ````  ');
});
