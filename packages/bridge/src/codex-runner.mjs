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

export function createNonOwnerCodexExecutionContext(config, options = {}) {
  const scratchRoot = resolve(config.codexNonOwnerScratchRoot);
  mkdirSync(scratchRoot, { recursive: true });
  const scratchCwd = mkdtempSync(join(scratchRoot, 'lark-codex-non-owner-'));
  return {
    cwd: scratchCwd,
    sandbox: config.codexNonOwnerSandbox,
    realWorkspace: options.realWorkspace || config.codexCwd,
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

export function summarizeCommandForProgress(command) {
  const source = String(command || '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return '继续分析当前任务';

  const rules = [
    [/\bcodebase\s+mr\s+comment\s+list\b/iu, '核对 MR 已有评论'],
    [/\bcodebase\s+mr\s+diff\b/iu, '分析 MR 代码变更'],
    [/\bcodebase\s+mr\s+(?:get|status)\b/iu, '核对 MR 状态与基本信息'],
    [/\bcodebase\s+search\s+mr\b/iu, '搜索相关 MR'],
    [/\bcodebase\s+repo\s+(?:file|directory)\b/iu, '读取相关仓库代码'],
    [/\bgit\s+diff\b/iu, '梳理代码变更范围'],
    [/\bgit\s+(?:status|rev-parse|branch|cat-file)\b/iu, '确认仓库、分支与提交状态'],
    [/\bgit\s+(?:show|log|blame)\b/iu, '阅读相关代码和提交历史'],
    [/(?:^|[\s;&|])(?:rg|grep|find)\b/iu, '搜索相关代码和调用关系'],
    [/(?:^|[\s;&|])(?:cat|sed|head|tail|nl)\b/iu, '阅读相关代码'],
    [/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|check|lint|typecheck|build)\b|\bnode\s+--test\b|\bgo\s+test\b/iu, '运行检查和测试'],
    [/\b(?:command\s+-v|which)\b/iu, '检查本地分析工具'],
    [/\b(?:curl|wget)\b/iu, '调用接口核对结果'],
    [/\b(?:mktemp|mkdir)\b|\/tmp\//iu, '准备临时分析环境'],
    [/\bbytedcli\b/iu, '查询研发平台信息'],
    [/\bgit\s+(?:commit|cherry-pick|merge|rebase)\b/iu, '整理并提交代码变更'],
    [/\bgit\s+push\b/iu, '推送代码变更'],
  ];
  return rules.find(([pattern]) => pattern.test(source))?.[1] || '执行下一步分析检查';
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
  if (name === 'exec_command' && args?.cmd) return summarizeCommandForProgress(args.cmd);
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

export function buildCodexPromptText(config, prompt, options = {}) {
  const progressPrompt = options.progress
    ? '\n\n执行时请在关键阶段用简短中文说明当前动作、已确认事实、下一步。这里只展示可见进展，不要输出隐藏推理、token、secret 或 cookie。'
    : '';
  return `${config.codexPromptPrefix}${progressPrompt}\n\n飞书用户消息：\n${prompt}`;
}

export function createCodexExecRunner(config, deps = {}) {
  const {
    clampReply = value => String(value || ''),
    runProcessFn = runProcess,
  } = deps;

  return {
    id: 'exec',
    label: 'codex exec',
    async run(prompt, options = {}) {
      return callCodexExec(prompt, {
        ...options,
        config,
        clampReply,
        runProcessFn,
      });
    },
  };
}

export async function callCodexExec(prompt, options = {}) {
  const {
    config,
    progress = null,
    sandbox = config.codexSandbox,
    cwd = config.codexCwd,
    clampReply = value => String(value || ''),
    runProcessFn = runProcess,
    signal = null,
    codexApprovalPolicy = '',
    codexConfigArgs = [],
  } = options;
  const tmp = mkdtempSync(join(tmpdir(), 'lark-codex-'));
  const outputFile = join(tmp, 'last-message.txt');
  const fullPrompt = buildCodexPromptText(config, prompt, { progress });

  const args = ['exec'];
  if (config.codexResume) {
    args.push('resume');
    if (config.codexResume === 'last') args.push('--last');
    else args.push(config.codexResume);
    if (config.codexModel) args.push('--model', config.codexModel);
    if (progress) args.push('--json');
    if (codexApprovalPolicy) {
      args.push('--config', `approval_policy=${JSON.stringify(codexApprovalPolicy)}`);
    }
    args.push(...codexConfigArgs);
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
    if (codexApprovalPolicy) {
      args.push('--config', `approval_policy=${JSON.stringify(codexApprovalPolicy)}`);
    }
    args.push(...codexConfigArgs);
    args.push('-');
  }

  try {
    const onStdoutChunk = progress ? createCodexProgressLineHandler(progress) : null;
    const { stdout } = await runProcessFn(config.codexBin, args, {
      stdin: fullPrompt,
      timeoutMs: config.codexTimeoutMs,
      cwd,
      onStdoutChunk,
      signal,
    });
    const finalMessage = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : stdout;
    return clampReply(finalMessage || stdout || 'Codex 执行完成，但没有返回文本。');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
