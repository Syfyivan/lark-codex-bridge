import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  findClaudeSession,
  listClaudeSessions,
  parseClaudeSessionTranscript,
} from '../src/claude-session.mjs';

function writeJsonl(file, items) {
  writeFileSync(file, `${items.map(item => JSON.stringify(item)).join('\n')}\n`);
}

test('findClaudeSession can resolve the latest session without knowing an id', () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-session-test-'));
  const projectDir = join(root, '-Users-bytedance-code-byted-org');
  mkdirSync(projectDir, { recursive: true });

  writeJsonl(join(projectDir, 'older.jsonl'), [
    {
      type: 'user',
      sessionId: 'older',
      timestamp: '2026-06-12T01:00:00.000Z',
      cwd: '/Users/bytedance/code.byted.org',
      message: { role: 'user', content: 'old task' },
    },
  ]);
  writeJsonl(join(projectDir, 'newer.jsonl'), [
    { type: 'ai-title', sessionId: 'newer', aiTitle: 'New Claude task' },
    {
      type: 'user',
      sessionId: 'newer',
      timestamp: '2026-06-12T02:00:00.000Z',
      cwd: '/Users/bytedance/code.byted.org',
      message: { role: 'user', content: 'new task' },
    },
  ]);

  const result = findClaudeSession('最近', { projectsRoot: root, candidateLimit: 6 });
  assert.equal(result.status, 'ok');
  assert.equal(result.matchType, 'recent');
  assert.equal(result.session.id, 'newer');
});

test('findClaudeSession matches title, project path, and content', () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-session-test-'));
  const projectDir = join(root, '-Users-bytedance-code-byted-org');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'abc-123.jsonl');
  writeJsonl(file, [
    { type: 'ai-title', sessionId: 'abc-123', aiTitle: 'Game invasion collect card' },
    {
      type: 'user',
      sessionId: 'abc-123',
      timestamp: '2026-06-12T02:00:00.000Z',
      cwd: '/Users/bytedance/code.byted.org/magic-fan',
      message: { role: 'user', content: [{ type: 'text', text: 'please fix 横滑 animation' }] },
    },
  ]);

  assert.equal(findClaudeSession('collect card', { projectsRoot: root }).session.id, 'abc-123');
  assert.equal(findClaudeSession('magic-fan', { projectsRoot: root }).matchType, 'project-recent');
  assert.equal(findClaudeSession('横滑', { projectsRoot: root }).matchType, 'content');
});

test('parseClaudeSessionTranscript keeps visible text and images but omits tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-session-test-'));
  const file = join(root, 'session.jsonl');
  writeJsonl(file, [
    {
      type: 'user',
      sessionId: 'session',
      timestamp: '2026-06-12T02:00:00.000Z',
      cwd: '/Users/bytedance/code.byted.org',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', source: { media_type: 'image/png', data: 'aGVsbG8=' } },
        ],
      },
    },
    {
      type: 'assistant',
      sessionId: 'session',
      timestamp: '2026-06-12T02:00:01.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/a' } },
          { type: 'text', text: 'done' },
        ],
      },
    },
  ]);

  const sessions = listClaudeSessions({ projectsRoot: root });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].visibleTurnCount, 2);

  const transcript = parseClaudeSessionTranscript(file);
  assert.equal(transcript.turns.length, 2);
  assert.equal(transcript.turns[0].text, 'look at this\n\n[image]');
  assert.equal(transcript.turns[0].parts[1].type, 'image');
  assert.match(transcript.turns[0].parts[1].src, /^data:image\/png;base64,/);
  assert.equal(transcript.turns[1].text, 'done');
  assert.doesNotMatch(JSON.stringify(transcript), /hidden|tool_use|file_path/);
});
