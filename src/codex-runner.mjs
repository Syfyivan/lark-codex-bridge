import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProcess } from './process-manager.mjs';

export function normalizeSandboxMode(value, fallback = 'read-only') {
  const normalized = String(value || '').trim();
  if (['read-only', 'workspace-write', 'danger-full-access'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

export function normalizeNonOwnerSandboxMode(value) {
  const normalized = normalizeSandboxMode(value || 'workspace-write', 'workspace-write');
  if (normalized === 'danger-full-access') return 'workspace-write';
  return normalized;
}

export function createNonOwnerCodexExecutionContext(config) {
  const scratchRoot = resolve(config.codexNonOwnerScratchRoot);
  mkdirSync(scratchRoot, { recursive: true });
  const scratchCwd = mkdtempSync(join(scratchRoot, 'lark-codex-non-owner-'));
  return {
    cwd: scratchCwd,
    sandbox: config.codexNonOwnerSandbox,
    realWorkspace: config.codexCwd,
    cleanup() {
      rmSync(scratchCwd, { recursive: true, force: true });
    },
  };
}

export function nonOwnerGuardNotice(config, context = {}) {
  return [
    '',
    '安全限制：请求人不是本机 owner。本次允许做查询、读取、总结、诊断和说明，但禁止改真实仓库或真实文件。',
    `真实工作区：${context.realWorkspace || config.codexCwd}`,
    `当前命令工作目录是一次性临时目录：${context.cwd || 'unknown'}`,
    '可以读取真实工作区中的文件，也可以运行不会落盘修改真实工作区的诊断命令，例如 rg、ls、sed、git status、git log、git diff、只读 bytedcli/lark-cli 查询。',
    '不要执行会修改真实工作区或外部系统的动作，包括写文件、apply_patch、格式化、安装依赖、生成构建产物、git commit/push/rebase/reset、deploy/publish、飞书外发、代码平台 comment/approve、改配置。',
    '如用户要求这些非只读操作，直接说明需要宋一凡审批，不要尝试执行。',
  ].join('\n');
}

export function parseCodexProgressLine(line) {
  const parsed = JSON.parse(line);
  if (!parsed || typeof parsed !== 'object') return '';

  const payload = parsed.payload || {};
  if (parsed.type === 'event_msg' && payload.type === 'agent_message') {
    return payload.message || '';
  }
  if (parsed.type === 'turn.started') return 'Codex 已开始分析。';
  if (parsed.type === 'item.completed') {
    const item = parsed.item || {};
    if (item.type === 'agent_message') return item.text || '';
    if (item.type === 'function_call') return summarizeFunctionCall(item);
    if (item.type === 'function_call_output') return summarizeFunctionCallOutput(item);
    return '';
  }
  if (parsed.type !== 'response_item') return '';

  if (payload.type === 'message') return extractTextFromCodexMessageContent(payload.content);
  if (payload.type === 'function_call') return summarizeFunctionCall(payload);
  if (payload.type === 'function_call_output') return summarizeFunctionCallOutput(payload);
  return '';
}

function extractTextFromCodexMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return item.text || item.output_text || item.content || '';
    })
    .filter(Boolean)
    .join('\n');
}

function summarizeFunctionCall(payload) {
  const name = payload?.name || payload?.function_name || 'tool';
  const args = typeof payload?.arguments === 'string' ? tryJson(payload.arguments) : payload?.arguments;
  if (name === 'exec_command' && args?.cmd) return `运行命令：${args.cmd}`;
  if (name === 'web_search' || name === 'search_query') return '检索资料';
  if (name === 'apply_patch') return '修改本地文件';
  return `调用工具：${name}`;
}

function summarizeFunctionCallOutput(payload) {
  const output = String(payload?.output || '').trim();
  const codeMatch = /Process exited with code (\d+)/.exec(output);
  if (codeMatch && codeMatch[1] !== '0') return `工具返回异常：exit ${codeMatch[1]}`;
  if (/timed out after \d+ms/i.test(output)) return '工具超时，准备换方式继续';
  return '';
}

function tryJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createCodexProgressLineHandler(progress) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index === -1) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('{')) continue;
      let message = '';
      try {
        message = parseCodexProgressLine(line);
      } catch {
        message = '';
      }
      if (message) progress.add(message);
    }
  };
}

export async function callCodexExec(prompt, options = {}) {
  const {
    config,
    progress = null,
    sandbox = config.codexSandbox,
    cwd = config.codexCwd,
    clampReply = value => String(value || ''),
  } = options;
  const tmp = mkdtempSync(join(tmpdir(), 'lark-codex-'));
  const outputFile = join(tmp, 'last-message.txt');
  const progressPrompt = progress
    ? '\n\n执行时请在关键阶段用简短中文说明当前动作、已确认事实、下一步。这里只展示可见进展，不要输出隐藏推理、token、secret 或 cookie。'
    : '';
  const fullPrompt = `${config.codexPromptPrefix}${progressPrompt}\n\n飞书用户消息：\n${prompt}`;

  const args = ['exec'];
  if (config.codexResume) {
    args.push('resume');
    if (config.codexResume === 'last') args.push('--last');
    else args.push(config.codexResume);
    if (config.codexModel) args.push('--model', config.codexModel);
    if (progress) args.push('--json');
    args.push('--output-last-message', outputFile, '-');
  } else {
    args.push(
      '--cd',
      cwd,
      '--sandbox',
      sandbox,
      '--output-last-message',
      outputFile,
      '--color',
      'never',
    );
    if (config.codexModel) args.push('--model', config.codexModel);
    if (progress) args.push('--json');
    if (config.codexSkipGitRepoCheck) args.push('--skip-git-repo-check');
    if (config.codexEphemeral) args.push('--ephemeral');
    args.push('-');
  }

  try {
    const onStdoutChunk = progress ? createCodexProgressLineHandler(progress) : null;
    const { stdout } = await runProcess(config.codexBin, args, {
      stdin: fullPrompt,
      timeoutMs: config.codexTimeoutMs,
      cwd,
      onStdoutChunk,
    });
    const finalMessage = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : stdout;
    return clampReply(finalMessage || stdout || 'Codex 执行完成，但没有返回文本。');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
