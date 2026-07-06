import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DIRECT_TASK_HEARTBEATS,
  DIRECT_TASK_RECEIVED_TEXT,
  DIRECT_TASK_STARTED_TEXT,
  formatDirectTaskFailureReply,
  formatDirectTaskStoppedReply,
  sanitizeBridgeStatusText,
} from '../src/progress-messages.mjs';

const here = rel => fileURLToPath(new URL(rel, import.meta.url));

test('progress messages expose immediate receive, start, and bounded heartbeat text', () => {
  assert.equal(DIRECT_TASK_RECEIVED_TEXT, '已收到，正在判断任务范围和执行环境。');
  assert.equal(DIRECT_TASK_STARTED_TEXT, '已开始执行，我会在这里同步关键进展。');
  assert.ok(DIRECT_TASK_HEARTBEATS.length >= 3);
  assert.ok(DIRECT_TASK_HEARTBEATS.every(text => text.startsWith('仍在处理：')));
});

test('failure summary is structured and redacts sensitive details', () => {
  const reply = formatDirectTaskFailureReply(
    new Error('failed at /Users/bytedance/code/private token=abc123 user=a@example.com'),
  );

  assert.match(reply, /当前状态：失败/);
  assert.match(reply, /是否修改了代码：未知/);
  assert.doesNotMatch(reply, /\/Users\/bytedance/);
  assert.doesNotMatch(reply, /abc123/);
  assert.doesNotMatch(reply, /a@example\.com/);
  assert.match(reply, /\[local-path\]/);
  assert.match(reply, /token=\[redacted\]/);
  assert.match(reply, /\[email\]/);
});

test('failure summary marks dirty worktrees as recoverable', () => {
  const reply = formatDirectTaskFailureReply(
    new Error('npm run lint failed at /Users/bytedance/code/buy-together'),
    {
      cwd: '/Users/bytedance/code/buy-together',
      gitStatus: [
        '## main...origin/main',
        ' M TODO.md',
        '?? src/app/page.tsx',
      ].join('\n'),
      changedCount: 2,
      hasWorktreeChanges: true,
    },
  );

  assert.match(reply, /当前状态：失败（可恢复）/);
  assert.match(reply, /是否修改了代码：是，检测到 2 条未提交变更/);
  assert.match(reply, /当前 git 状态/);
  assert.match(reply, /M TODO\.md/);
  assert.match(reply, /不要重写整个任务/);
  assert.doesNotMatch(reply, /\/Users\/bytedance/);
});

test('stopped summary is structured as blocked', () => {
  const reply = formatDirectTaskStoppedReply();

  assert.match(reply, /当前状态：已阻断/);
  assert.match(reply, /验证结果：未完成/);
});

test('status sanitizer clamps long text', () => {
  const text = sanitizeBridgeStatusText('x'.repeat(100), 8);

  assert.equal(text, 'xxxxxxxx\n...');
});

test('thread progress replies surface as task progress, not Feishu reply bubbles', () => {
  const source = readFileSync(here('../lark-codex-bridge.mjs'), 'utf8');

  assert.match(source, /function emitReplyPetEvent/);
  assert.match(source, /petEventType:\s*'task_progress'/);
  assert.match(source, /taskId:\s*taskRun\?\.id \|\| ''/);
  assert.match(source, /replyChannel:\s*'lark_thread'/);
  assert.match(source, /recordBridgeTaskEvent\(options\.taskId,\s*'task_progress'/);
  assert.match(source, /petEvent:\s*false/);
});
