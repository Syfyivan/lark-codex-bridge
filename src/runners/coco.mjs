import { runProcess } from '../process-manager.mjs';
import { extractTextFromJson, tryParseJson } from './service-auth.mjs';

export function buildCocoChatArgs(config, prompt) {
  const args = ['--json', 'coco', 'chat', '--message', prompt, '--no-stream'];
  appendIfValue(args, '--repo-id', config.cocoRepoId);
  appendIfValue(args, '--commit-id', config.cocoCommitId);
  return args;
}

export function buildCocoTaskSendArgs(config, prompt) {
  const args = ['--json', 'coco', 'task', 'send', '--message', prompt];
  appendIfValue(args, '--repo-id', config.cocoRepoId);
  appendIfValue(args, '--branch', config.cocoBranch);
  appendIfValue(args, '--merge-request-number', config.cocoMergeRequestNumber);
  appendIfValue(args, '--task-id', config.cocoTaskId);
  appendIfValue(args, '--model-name', config.cocoModelName);
  appendIfValue(args, '--agent-name', config.cocoAgentName);
  appendIfValue(args, '--environment', config.cocoEnvironment);
  appendIfValue(args, '--environment-image', config.cocoEnvironmentImage);
  appendIfValue(args, '--environment-ttl', config.cocoEnvironmentTtl);
  for (const item of config.cocoEnvironmentVars || []) args.push('--environment-var', item);
  return args;
}

function appendIfValue(args, name, value) {
  if (value !== undefined && value !== null && String(value).trim()) args.push(name, String(value).trim());
}

export function parseCocoOutput(stdout) {
  const text = String(stdout || '').trim();
  const parsed = tryParseJson(text);
  if (!parsed) return { text, raw: text, taskId: '' };
  const taskId = findDeepString(parsed, ['task_id', 'taskId', 'TaskId', 'id']);
  return {
    text: extractCocoText(parsed) || (taskId ? `Coco task 已创建：${taskId}` : text),
    raw: parsed,
    taskId,
  };
}

function extractCocoText(value) {
  const direct = extractTextFromJson(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object') return '';
  const status = findDeepString(value, ['status', 'state']);
  const url = findDeepString(value, ['url', 'web_url', 'webUrl', 'share_url', 'shareUrl']);
  const taskId = findDeepString(value, ['task_id', 'taskId', 'TaskId', 'id']);
  return [
    taskId ? `Coco task：${taskId}` : '',
    status ? `状态：${status}` : '',
    url ? `链接：${url}` : '',
  ].filter(Boolean).join('\n');
}

function findDeepString(input, keys) {
  const wanted = new Set(keys);
  const queue = [input];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(key) && (typeof child === 'string' || typeof child === 'number')) {
        const text = String(child).trim();
        if (text) return text;
      }
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return '';
}

export function createCocoRunner(config, deps = {}) {
  const runProcessFn = deps.runProcessFn || runProcess;
  const clampReply = deps.clampReply || (value => String(value || ''));

  return {
    id: 'coco',
    label: config.cocoRunMode === 'task' ? 'Coco task' : 'Coco chat',
    async run(prompt, options = {}) {
      if (config.cocoRunMode === 'task') {
        return runCocoTask(config, prompt, options, { runProcessFn, clampReply });
      }
      return runCocoChat(config, prompt, options, { runProcessFn, clampReply });
    },
  };
}

async function runCocoChat(config, prompt, options, deps) {
  const { stdout } = await deps.runProcessFn(config.bytedCliBin, buildCocoChatArgs(config, prompt), {
    timeoutMs: config.cocoTimeoutMs || config.codexTimeoutMs,
    cwd: options.cwd || config.codexCwd,
    signal: options.signal,
  });
  const parsed = parseCocoOutput(stdout);
  return {
    text: deps.clampReply(parsed.text || stdout || 'Coco chat 执行完成，但没有返回文本。'),
    raw: parsed.raw,
    sessionId: '',
    taskId: parsed.taskId,
  };
}

async function runCocoTask(config, prompt, options, deps) {
  const send = await deps.runProcessFn(config.bytedCliBin, buildCocoTaskSendArgs(config, prompt), {
    timeoutMs: config.cocoTimeoutMs || config.codexTimeoutMs,
    cwd: options.cwd || config.codexCwd,
    signal: options.signal,
  });
  const sent = parseCocoOutput(send.stdout);
  const taskId = sent.taskId;
  if (taskId) options.progress?.add?.(`Coco task 已创建：${taskId}`);

  if (!config.cocoTaskWait || !taskId) {
    return {
      text: deps.clampReply(sent.text || send.stdout || 'Coco task 已提交。'),
      raw: sent.raw,
      sessionId: '',
      taskId,
    };
  }

  let subscription = null;
  if (config.cocoTaskSubscribe) {
    const subscribed = await deps.runProcessFn(config.bytedCliBin, [
      '--json',
      'coco',
      'task',
      'subscribe',
      '--task-id',
      taskId,
    ], {
      timeoutMs: config.cocoTaskWaitTimeoutMs || config.cocoTimeoutMs || config.codexTimeoutMs,
      cwd: options.cwd || config.codexCwd,
      signal: options.signal,
      onStdoutChunk: chunk => {
        const update = parseCocoOutput(chunk).text;
        if (update) options.progress?.add?.(update);
      },
    });
    subscription = parseCocoOutput(subscribed.stdout);
  }

  const got = await deps.runProcessFn(config.bytedCliBin, [
    '--json',
    'coco',
    'task',
    'get',
    '--task-id',
    taskId,
  ], {
    timeoutMs: config.cocoTimeoutMs || config.codexTimeoutMs,
    cwd: options.cwd || config.codexCwd,
    signal: options.signal,
  });
  const final = parseCocoOutput(got.stdout);
  return {
    text: deps.clampReply(final.text || subscription?.text || sent.text || got.stdout),
    raw: {
      send: sent.raw,
      subscribe: subscription?.raw,
      get: final.raw,
    },
    sessionId: '',
    taskId,
  };
}
