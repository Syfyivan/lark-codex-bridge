import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createCodexSessionTitleResolver,
  defaultIndexPath,
  readCodexSessionTitles,
} from '../src/main/codex-session-index.js'

test('reads Codex session titles from session_index.jsonl', () => {
  const titles = readCodexSessionTitles('/tmp/session_index.jsonl', {
    readFileSync: () => [
      '{"id":"session-a","thread_name":"旧标题"}',
      'not-json',
      '{"id":"019f361d-b8bb-7562-ac2c-fa6dd07618f1","thread_name":"查找未回复原因"}',
      '{"id":"session-a","thread_name":"新标题"}',
    ].join('\n'),
  })
  assert.equal(titles.get('019f361d-b8bb-7562-ac2c-fa6dd07618f1'), '查找未回复原因')
  assert.equal(titles.get('session-a'), '新标题')
})

test('resolver reloads Codex session titles when the index changes', () => {
  let text = '{"id":"session-a","thread_name":"查找未回复原因"}'
  let size = text.length
  const resolveTitle = createCodexSessionTitleResolver({
    indexPath: '/tmp/session_index.jsonl',
    statSync: () => ({ mtimeMs: 1, size }),
    readFileSync: () => text,
  })

  assert.equal(resolveTitle('session-a'), '查找未回复原因')
  text = '{"id":"session-a","thread_name":"修复气泡标题"}'
  size = text.length
  assert.equal(resolveTitle('session-a'), '修复气泡标题')
})

test('default index path points at the Codex session index', () => {
  assert.equal(defaultIndexPath('/Users/bytedance'), '/Users/bytedance/.codex/session_index.jsonl')
})
