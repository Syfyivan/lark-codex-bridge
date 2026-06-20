import assert from 'node:assert/strict';
import test from 'node:test';

import { runProcess } from '../src/process-manager.mjs';

test('runProcess captures stdout for successful commands', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(result.stdout, 'ok');
});

test('runProcess abort signal terminates the child process', async () => {
  const controller = new AbortController();
  const promise = runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => process.stdout.write("late"), 30000)'],
    { signal: controller.signal },
  );
  controller.abort('manual stop');

  await assert.rejects(promise, /manual stop/);
});
