import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractMemoryCandidates } from '../src/memory-extractor.mjs';
import {
  canWriteMemory,
  parseMemoryCommand,
  shouldAutoWriteThreadSummary,
} from '../src/memory-policy.mjs';
import { buildMemoryPromptContext } from '../src/memory-prompt.mjs';
import {
  readVisibleMemoryBundle,
  resolveMemoryRoute,
} from '../src/memory-router.mjs';
import {
  approveMemoryCandidates,
  appendMemoryCandidate,
  appendJsonl,
  appendThreadExchange,
  compactMemoryRoute,
  memoryPaths,
  readJsonl,
  readMemoryCandidates,
  readTextFile,
  rejectMemoryCandidates,
  safeMemorySegment,
  writeTextFile,
} from '../src/memory-store.mjs';
import {
  primaryProjectId,
  resolveProjectAnchors,
} from '../src/project-resolver.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lark-bridge-memory-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('memory store sanitizes path segments and appends bounded thread exchanges', () => {
  withTempDir(rootDir => {
    assert.equal(safeMemorySegment('../chat id/../../'), '_chat_id_.._.._');
    const paths = memoryPaths(rootDir, { chatId: '../chat id/../../', threadId: 'thread/a' });
    assert.equal(paths.chatDir.startsWith(rootDir), true);
    assert.equal(paths.threadFile.includes('/../'), false);

    appendThreadExchange({
      rootDir,
      chatId: 'chat-1',
      threadId: 'thread-1',
      userText: 'hello',
      assistantText: 'world',
      maxChars: 80,
      now: () => '2026-06-12T00:00:00.000Z',
    });

    const text = readTextFile(memoryPaths(rootDir, { chatId: 'chat-1', threadId: 'thread-1' }).threadFile);
    assert.match(text, /User:\nhello/);
    assert.match(text, /Assistant:\nworld/);
    assert.ok(text.length <= 120);
  });
});

test('jsonl helpers keep newest readable records', () => {
  withTempDir(rootDir => {
    const file = join(rootDir, 'records.jsonl');
    appendJsonl(file, { text: 'old', createdAt: '2026-06-12T00:00:00.000Z' });
    appendJsonl(file, { text: 'new', createdAt: '2026-06-12T00:01:00.000Z' });
    assert.deepEqual(readJsonl(file, 1).map(item => item.text), ['new']);
  });
});

test('project resolver detects repo mr activity and configured fallback anchors', () => {
  const text = [
    'https://code.byted.org/pgcfe/novel_unify_admin_activity/merge_requests/42',
    'repo: owner/name',
    'activity_id: 123456',
  ].join('\n');
  const anchors = resolveProjectAnchors(text, { defaultProjectId: 'manual:default' });
  assert.equal(anchors[0].id, 'repo:pgcfe_novel_unify_admin_activity');
  assert.equal(anchors.some(anchor => anchor.id === 'repo:owner_name'), true);
  assert.equal(anchors.some(anchor => anchor.id === 'activity:123456'), true);
  assert.equal(anchors.some(anchor => anchor.id === 'manual:default'), true);
  assert.equal(primaryProjectId('MR #88'), 'mr:88');
});

test('memory router reads only route-visible layered memory', () => {
  withTempDir(rootDir => {
    const soulsDir = join(rootDir, 'souls');
    const baseSoulFile = join(soulsDir, 'base.md');
    const config = {
      memoryRootDir: join(rootDir, 'memory'),
      baseSoulFile,
      memoryDefaultProjectId: '',
      memoryJsonlItemLimit: 5,
    };
    const route = resolveMemoryRoute(
      config,
      { chatId: 'chat-1', threadId: 'thread-1' },
      'see https://github.com/acme/tooling',
    );
    const paths = memoryPaths(config.memoryRootDir, route);
    writeTextFile(baseSoulFile, 'Base behavior');
    writeTextFile(join(paths.globalDir, 'preferences.md'), 'Prefer concise replies');
    writeTextFile(join(paths.chatDir, 'summary.md'), 'Chat one summary');
    writeTextFile(paths.threadFile, 'Thread one summary');
    writeTextFile(join(paths.projectDir, 'shared-summary.md'), 'Project summary');
    appendJsonl(join(paths.chatDir, 'decisions.jsonl'), { text: 'Chat decision' });
    appendJsonl(join(paths.projectDir, 'risks.jsonl'), { text: 'Project risk' });
    appendJsonl(join(paths.chatDir, 'pending.jsonl'), { text: 'Chat pending' });
    appendJsonl(join(paths.projectDir, 'open-questions.jsonl'), { text: 'Project question' });

    const bundle = readVisibleMemoryBundle(config, route);
    const labels = bundle.entries.map(entry => entry.label);
    assert.deepEqual(labels, [
      'Base Soul',
      'Global Preferences',
      'Current Chat Summary',
      'Current Thread Summary',
      'Current Project Summary',
      'Relevant Decisions',
      'Relevant Risks',
      'Current Chat Pending Items',
      'Current Project Open Questions',
    ]);
    assert.match(buildMemoryPromptContext(bundle, 12_000), /Project risk/);
    assert.match(buildMemoryPromptContext(bundle, 12_000), /Project question/);
  });
});

test('memory prompt respects priority and hard character budget', () => {
  const context = buildMemoryPromptContext({
    route: { chatId: 'chat-1', threadId: 'thread-1', projectId: 'project-1' },
    entries: [
      { label: 'Low', priority: 1, text: 'low value' },
      { label: 'High', priority: 100, text: 'x'.repeat(200) },
    ],
  }, 140);
  assert.match(context, /## High/);
  assert.doesNotMatch(context, /## Low/);
  assert.ok(context.length <= 220);
});

test('memory policy parses owner-only commands and auto write gate', () => {
  assert.deepEqual(parseMemoryCommand('/memory'), { action: 'show', scope: 'chat' });
  assert.deepEqual(parseMemoryCommand('/memory-pending'), { action: 'pending', scope: 'chat' });
  assert.deepEqual(parseMemoryCommand('/memory-approve all'), { action: 'approve', scope: 'chat', selector: 'all' });
  assert.deepEqual(parseMemoryCommand('/memory-reject mem_123'), {
    action: 'reject',
    scope: 'chat',
    selector: 'mem_123',
  });
  assert.deepEqual(parseMemoryCommand('/memory-compact project'), { action: 'compact', scope: 'project' });
  assert.deepEqual(parseMemoryCommand('/remember hello'), { action: 'remember', scope: 'chat', text: 'hello' });
  assert.deepEqual(parseMemoryCommand('/remember-project decision'), {
    action: 'remember',
    scope: 'project',
    text: 'decision',
  });
  assert.equal(canWriteMemory(parseMemoryCommand('/remember hello'), 'member').ok, false);
  assert.equal(canWriteMemory(parseMemoryCommand('/remember hello'), 'owner').ok, true);
  assert.equal(shouldAutoWriteThreadSummary({
    memoryEnabled: true,
    memoryAutoThreadSummary: true,
  }, 'owner'), true);
  assert.equal(shouldAutoWriteThreadSummary({
    memoryEnabled: true,
    memoryAutoThreadSummary: true,
  }, 'member'), false);
});

test('memory extractor recognizes low-structure candidate lines', () => {
  assert.deepEqual(
    extractMemoryCandidates([
      '决定：上线前必须跑 npm test',
      'risk: bytedcli auth may expire',
      'todo: add project resolver tests',
      'question: should global memory require approval',
    ].join('\n'), { source: 'thread' }).map(item => [item.type, item.source]),
    [
      ['decision', 'thread'],
      ['risk', 'thread'],
      ['pending', 'thread'],
      ['question', 'thread'],
    ],
  );
});

test('memory candidates can be approved to project memory or rejected', () => {
  withTempDir(rootDir => {
    const route = { chatId: 'chat-1', threadId: 'thread-1', projectId: 'project-1' };
    const decision = appendMemoryCandidate(rootDir, route, {
      type: 'decision',
      scope: 'project',
      text: 'Ship only after tests pass',
      id: 'mem_decision',
    });
    const risk = appendMemoryCandidate(rootDir, route, {
      type: 'risk',
      scope: 'chat',
      text: 'Auth can expire',
      id: 'mem_risk',
    });
    assert.equal(decision.id, 'mem_decision');
    assert.equal(risk.id, 'mem_risk');
    assert.equal(readMemoryCandidates(rootDir, route).length, 2);

    const approved = approveMemoryCandidates(rootDir, route, 'mem_decision');
    assert.deepEqual(approved.selected.map(item => item.id), ['mem_decision']);
    const paths = memoryPaths(rootDir, route);
    assert.deepEqual(readJsonl(join(paths.projectDir, 'decisions.jsonl'), 10).map(item => item.text), [
      'Ship only after tests pass',
    ]);

    const rejected = rejectMemoryCandidates(rootDir, route, 'all');
    assert.deepEqual(rejected.selected.map(item => item.id), ['mem_risk']);
    assert.equal(readMemoryCandidates(rootDir, route).length, 0);
  });
});

test('compactMemoryRoute trims text and jsonl files by scope', () => {
  withTempDir(rootDir => {
    const route = { chatId: 'chat-1', threadId: 'thread-1', projectId: 'project-1' };
    const paths = memoryPaths(rootDir, route);
    writeTextFile(join(paths.chatDir, 'summary.md'), 'x'.repeat(200));
    for (let index = 0; index < 5; index += 1) {
      appendJsonl(join(paths.chatDir, 'decisions.jsonl'), { text: `decision ${index}` });
    }

    const result = compactMemoryRoute({
      rootDir,
      route,
      scope: 'chat',
      maxTextChars: 50,
      maxJsonlRecords: 2,
    });
    assert.equal(result.length, 6);
    assert.match(readTextFile(join(paths.chatDir, 'summary.md')), /memory_truncated/);
    assert.deepEqual(readJsonl(join(paths.chatDir, 'decisions.jsonl'), 10).map(item => item.text), [
      'decision 3',
      'decision 4',
    ]);
  });
});
