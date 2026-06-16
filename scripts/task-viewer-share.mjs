#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { createTaskRecorder, defaultTaskViewerStoreDir } from '../src/task-recorder.mjs';
import { writeTaskViewerSite } from '../src/task-viewer.mjs';

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return !['', '0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function expandHome(value) {
  const text = String(value || '');
  if (text === '~') return homedir();
  if (text.startsWith('~/')) return join(homedir(), text.slice(2));
  return text;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function parseGoofyPreviewUrl(stdout) {
  const parsed = JSON.parse(stdout || '{}');
  const preview = parsed?.data?.preview || {};
  const host =
    (Array.isArray(preview.domainPrefixes) && preview.domainPrefixes[0]) ||
    preview.domain ||
    preview.host ||
    '';
  if (!host) throw new Error(`Goofy preview response has no domain: ${stdout.slice(0, 500)}`);
  return `https://${String(host).replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
}

async function main() {
  const deploy = process.argv.includes('--deploy') || envFlag('TASK_VIEWER_DEPLOY', false);
  const storeDir = expandHome(process.env.TASK_VIEWER_STORE_DIR || defaultTaskViewerStoreDir());
  const outDir = expandHome(
    process.env.TASK_VIEWER_GOOFY_PREVIEW_DIR ||
      join(homedir(), '.lark-codex-bridge', 'goofy-task-viewer-preview'),
  );
  const title = process.env.TASK_VIEWER_TITLE || 'Bridge Task Session Viewer';
  const limit = Math.max(1, Number(process.env.TASK_VIEWER_SHARE_LIMIT || process.env.TASK_VIEWER_MAX_TASKS || 200));
  const recorder = createTaskRecorder({ storeDir, maxTasks: limit });
  const tasks = recorder.exportTasks({ limit });
  const indexFile = writeTaskViewerSite({ tasks, outDir, title });
  const result = { ok: true, outDir, indexFile, tasks: tasks.length };

  if (deploy) {
    const alias = String(process.env.TASK_VIEWER_GOOFY_ALIAS || 'bridge-task-viewer-syf').trim();
    const bytedCli = process.env.BYTEDCLI_BIN || 'bytedcli';
    const description = process.env.TASK_VIEWER_GOOFY_DESCRIPTION || 'Bridge Task Session Viewer';
    const expiryDays = String(Math.max(1, Number(process.env.TASK_VIEWER_GOOFY_EXPIRY_DAYS || 365)));
    const { stdout } = await run(bytedCli, [
      '--json',
      'goofy',
      'preview',
      'deploy',
      outDir,
      '--alias',
      alias,
      '--override',
      '--description',
      description,
      '--expiry-days',
      expiryDays,
    ]);
    result.url = parseGoofyPreviewUrl(stdout);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
