import { runProcess } from '../process-manager.mjs';
import { extractTextFromJson, tryParseJson } from './service-auth.mjs';

export function buildClaudeCodeArgs(config, prompt) {
  const args = ['-p'];
  if (config.claudeCodeOutputFormat) args.push('--output-format', config.claudeCodeOutputFormat);
  if (config.claudeCodePermissionMode) {
    args.push('--permission-mode', config.claudeCodePermissionMode);
  }
  if (config.claudeCodeMaxTurns > 0) {
    args.push('--max-turns', String(config.claudeCodeMaxTurns));
  }
  if (config.claudeCodeNoSessionPersistence) args.push('--no-session-persistence');
  if (Array.isArray(config.claudeCodeExtraArgs)) args.push(...config.claudeCodeExtraArgs);
  args.push(prompt);
  return args;
}

export function parseClaudeCodeOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return { text: '', raw: null, sessionId: '' };

  const parsed = tryParseJson(text);
  if (parsed) {
    return {
      text: extractClaudeText(parsed) || text,
      raw: parsed,
      sessionId: findDeepString(parsed, ['session_id', 'sessionId', 'session']) || '',
    };
  }

  const events = text
    .split(/\r?\n/)
    .map(line => tryParseJson(line.trim()))
    .filter(Boolean);
  if (events.length) {
    return {
      text: events.map(extractClaudeText).filter(Boolean).join('\n') || text,
      raw: events,
      sessionId: findDeepString(events, ['session_id', 'sessionId', 'session']) || '',
    };
  }

  return { text, raw: text, sessionId: '' };
}

function extractClaudeText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) return value.map(extractClaudeText).filter(Boolean).join('\n');

  const direct = extractTextFromJson(value);
  if (direct) return direct;
  if (Array.isArray(value.content)) {
    return value.content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return extractClaudeText(item);
      })
      .filter(Boolean)
      .join('\n');
  }
  return extractClaudeText(value.message) || extractClaudeText(value.delta);
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
      if (wanted.has(key) && typeof child === 'string' && child.trim()) return child;
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return '';
}

export function createClaudeCodeRunner(config, deps = {}) {
  const runProcessFn = deps.runProcessFn || runProcess;
  const clampReply = deps.clampReply || (value => String(value || ''));
  return {
    id: 'claude',
    label: 'Claude Code',
    async run(prompt, options = {}) {
      const args = buildClaudeCodeArgs(config, prompt);
      const { stdout } = await runProcessFn(config.claudeCodeBin, args, {
        timeoutMs: config.claudeCodeTimeoutMs || config.codexTimeoutMs,
        cwd: options.cwd || config.codexCwd,
        signal: options.signal,
      });
      const parsed = parseClaudeCodeOutput(stdout);
      return {
        text: clampReply(parsed.text || stdout || 'Claude Code 执行完成，但没有返回文本。'),
        raw: parsed.raw,
        sessionId: parsed.sessionId,
        taskId: '',
      };
    },
  };
}
