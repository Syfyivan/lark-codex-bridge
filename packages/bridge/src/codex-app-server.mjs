import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { buildCodexPromptText } from './codex-runner.mjs';
import {
  createCodexSessionStore,
  defaultCodexSessionStoreFile,
} from './codex-session-store.mjs';

export { createCodexSessionStore, defaultCodexSessionStoreFile } from './codex-session-store.mjs';

export function normalizeCodexRuntime(value) {
  const normalized = String(value || 'exec').trim().toLowerCase();
  if (['exec', 'app-server', 'appserver', 'auto'].includes(normalized)) {
    return normalized === 'appserver' ? 'app-server' : normalized;
  }
  return 'exec';
}

export function appServerInputFromPrompt(text) {
  return [{ type: 'text', text: String(text || ''), text_elements: [] }];
}

export function extractFinalAgentText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'agentMessage' && String(item.text || '').trim()) {
      return item.text;
    }
  }
  return '';
}

export function summarizeAppServerNotification(message) {
  const method = message?.method || '';
  const params = message?.params || {};
  if (method === 'turn/started') return 'Codex app-server 已开始处理。';
  if (method === 'turn/completed') {
    const status = params.turn?.status;
    if (status === 'failed') return 'Codex app-server 执行失败。';
    if (status === 'interrupted') return 'Codex app-server 已中断。';
    return '';
  }
  if (method === 'warning') return params.message || params.warning || '';
  if (method === 'error') return params.message || params.error || '';
  if (method !== 'item/completed') return '';

  const item = params.item || {};
  if (item.type === 'commandExecution' && item.command) return `运行命令：${item.command}`;
  if (item.type === 'fileChange') return '修改本地文件';
  if (item.type === 'mcpToolCall') return `调用 MCP 工具：${item.server || 'mcp'}.${item.tool || 'tool'}`;
  if (item.type === 'dynamicToolCall') return `调用工具：${item.tool || 'tool'}`;
  if (item.type === 'webSearch' && item.query) return `检索资料：${item.query}`;
  if (item.type === 'plan' && item.text) return item.text;
  return '';
}

export class JsonLineCodexAppServerClient extends EventEmitter {
  constructor(config, deps = {}) {
    super();
    this.config = config;
    this.spawnFn = deps.spawnFn || spawn;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.readyPromise = null;
  }

  async ensureStarted() {
    if (this.readyPromise) return this.readyPromise;
    this.child = this.spawnFn(this.config.codexBin || 'codex', ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      cwd: resolve(this.config.codexCwd || process.cwd()),
    });
    this.child.stdout.on('data', chunk => this.handleStdout(chunk));
    this.child.stderr.on('data', chunk => this.emit('stderr', chunk.toString('utf8')));
    this.child.on('error', error => this.failAll(error));
    this.child.on('exit', code => {
      this.failAll(new Error(`codex app-server exited (${code ?? 'signal'})`));
      this.child = null;
      this.readyPromise = null;
    });

    this.readyPromise = this.sendRequest('initialize', {
      clientInfo: {
        name: 'lark-codex-bridge',
        version: this.config.version || '0.0.0',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    }, { timeoutMs: this.config.codexAppServerStartTimeoutMs || 10_000 })
      .then(result => {
        this.notify('initialized');
        return result;
      });
    return this.readyPromise;
  }

  async request(method, params, options = {}) {
    await this.ensureStarted();
    return this.sendRequest(method, params, options);
  }

  notify(method, params) {
    this.writeJson(params === undefined ? { method } : { method, params });
  }

  sendRequest(method, params, options = {}) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error('codex app-server is not running'));
    }
    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
    return new Promise((resolve, reject) => {
      let timeout = null;
      if (timeoutMs) {
        timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref();
      }
      this.pending.set(id, {
        resolve: value => {
          if (timeout) clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          if (timeout) clearTimeout(timeout);
          reject(error);
        },
      });
      this.writeJson(params === undefined ? { method, id } : { method, id, params });
    });
  }

  writeJson(payload) {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString('utf8');
    for (;;) {
      const index = this.stdoutBuffer.indexOf('\n');
      if (index === -1) break;
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line) this.handleMessage(line);
    }
  }

  handleMessage(line) {
    let message = null;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit('stderr', `${line}\n`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.writeJson({
        id: message.id,
        error: {
          code: -32601,
          message: `lark-codex-bridge does not implement app-server request ${message.method}`,
        },
      });
      return;
    }

    if (message.method) this.emit('notification', message);
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.emit('exit', error);
  }

  stop() {
    if (this.child) this.child.kill('SIGTERM');
  }
}

export function createCodexAppServerRunner(config, deps = {}) {
  const client = deps.appServerClient || new JsonLineCodexAppServerClient(config, deps);
  const clampReply = deps.clampReply || (value => String(value || ''));
  const sessions = new Map();
  const sessionStore = deps.sessionStore || (
    config.codexEphemeral
      ? null
      : createCodexSessionStore({
          file: config.codexSessionStoreFile || defaultCodexSessionStoreFile(),
          maxSessions: config.codexSessionHistoryLimit,
        })
  );

  client.on?.('stderr', text => {
    const trimmed = String(text || '').trim();
    if (trimmed) console.error(`[codex-app-server] ${trimmed}`);
  });

  function sessionKeyFor(options) {
    if (!options.contextKey) return '';
    if (!config.codexEphemeral) return options.contextKey;
    return [
      options.contextKey,
      resolve(options.cwd || config.codexCwd),
      options.sandbox || config.codexSandbox,
      config.codexModel || '',
    ].join('\u001f');
  }

  async function startThread(options, { forceNew = false } = {}) {
    const key = sessionKeyFor(options);
    const cwd = resolve(options.cwd || config.codexCwd);
    const sandbox = options.sandbox || config.codexSandbox;
    if (!forceNew && key && sessions.has(key)) return sessions.get(key);
    const response = await client.request('thread/start', {
      cwd,
      model: config.codexModel || undefined,
      sandbox,
      approvalPolicy: 'never',
      ephemeral: Boolean(config.codexEphemeral),
    }, { timeoutMs: config.codexAppServerRequestTimeoutMs || 30_000 });
    const threadId = response?.thread?.id;
    if (!threadId) throw new Error('codex app-server thread/start returned no thread id');

    const title = String(options.sessionTitle || options.title || '').trim();
    if (title) {
      await client.request('thread/name/set', { threadId, name: title }, {
        timeoutMs: config.codexAppServerRequestTimeoutMs || 30_000,
      });
    }
    const session = { threadId, id: threadId, title, key, cwd, sandbox };
    if (key) sessions.set(key, session);
    sessionStore?.record(key, session, { activate: options.activateSession !== false });
    sessionStore?.bindMessages(key, threadId, options.messageIds || []);
    return session;
  }

  async function ensureThread(options) {
    const key = sessionKeyFor(options);
    if (config.codexEphemeral || !sessionStore || !key) return startThread(options);

    const resolved = options.sessionId
      ? { session: { id: options.sessionId }, source: 'explicit' }
      : sessionStore.resolve(key, options.messageIds || []);
    const targetId = resolved.session?.id || '';
    const cached = sessions.get(key);
    if (!targetId) return startThread(options);
    const cwd = resolve(options.cwd || resolved.session?.cwd || config.codexCwd);
    const sandbox = options.sandbox || resolved.session?.sandbox || config.codexSandbox;
    if (cached?.threadId === targetId && cached.cwd === cwd && cached.sandbox === sandbox) {
      sessionStore.bindMessages(key, targetId, options.messageIds || []);
      return cached;
    }

    const response = await client.request('thread/resume', {
      threadId: targetId,
      cwd,
      sandbox,
      approvalPolicy: 'never',
      model: config.codexModel || undefined,
    }, { timeoutMs: config.codexAppServerRequestTimeoutMs || 30_000 });
    const threadId = response?.thread?.id || targetId;
    const session = {
      threadId,
      id: threadId,
      title: resolved.session?.title || '',
      key,
      cwd,
      sandbox,
    };
    sessions.set(key, session);
    sessionStore.record(key, session, {
      activate: resolved.source !== 'message' && options.activateSession !== false,
    });
    sessionStore.bindMessages(key, threadId, options.messageIds || []);
    return session;
  }

  return {
    id: 'codex-app-server',
    label: 'Codex app-server',
    persistentSessions: Boolean(sessionStore),
    sessions,
    async newSession(options = {}) {
      if (config.codexEphemeral || !sessionStore) {
        throw new Error('Codex group sessions require CODEX_EPHEMERAL=0');
      }
      const session = await startThread({
        ...options,
        sessionTitle: options.title || options.sessionTitle || '',
        activateSession: true,
      }, { forceNew: true });
      return { ...session, id: session.threadId };
    },
    listSessions(options = {}) {
      return sessionStore?.list(sessionKeyFor(options)) || [];
    },
    useSession(options = {}) {
      const key = sessionKeyFor(options);
      const selected = sessionStore?.activate(key, options.selector);
      if (selected) sessions.delete(key);
      return selected;
    },
    activeSession(options = {}) {
      return sessionStore?.active(sessionKeyFor(options)) || null;
    },
    async run(prompt, options = {}) {
      const session = await ensureThread(options);
      const fullPrompt = buildCodexPromptText(config, prompt, { progress: options.progress });
      const turn = await runAppServerTurn({
        client,
        threadId: session.threadId,
        prompt: fullPrompt,
        progress: options.progress,
        timeoutMs: config.codexTimeoutMs,
        signal: options.signal,
      });
      sessionStore?.bindMessages(session.key, session.threadId, options.messageIds || []);
      const text = extractFinalAgentText(turn);
      const usage = turn?.usage || turn?.tokenUsage || turn?.token_usage || null;
      const tokens =
        typeof usage === 'number'
          ? usage
          : usage
            ? (usage.input_tokens || usage.inputTokens || 0) +
              (usage.output_tokens || usage.outputTokens || 0) +
              (usage.cached_input_tokens || usage.cache_read_input_tokens || usage.cachedInputTokens || 0)
            : 0;
      return {
        text: clampReply(text || 'Codex app-server 执行完成，但没有返回文本。'),
        raw: {
          runner: 'codex-app-server',
          threadId: session.threadId,
          turnId: turn?.id || '',
          usage, // kept for debugging the exact usage shape
        },
        sessionId: session.threadId,
        taskId: turn?.id || '',
        tokens,
      };
    },
  };
}

export async function runAppServerTurn(input) {
  const {
    client,
    threadId,
    prompt,
    progress = null,
    timeoutMs = 0,
    signal = null,
  } = input;
  if (signal?.aborted) throw abortError(signal.reason);

  let turnId = '';
  const completion = waitForTurnCompletion({
    client,
    threadId,
    turnIdRef: () => turnId,
    progress,
    timeoutMs,
    signal,
  });
  let startResponse = null;
  try {
    startResponse = await client.request('turn/start', {
      threadId,
      clientUserMessageId: randomUUID(),
      input: appServerInputFromPrompt(prompt),
    }, { timeoutMs: 30_000 });
  } catch (error) {
    completion.cancel();
    throw error;
  }
  turnId = startResponse?.turn?.id || '';
  if (!turnId) {
    completion.cancel();
    throw new Error('codex app-server turn/start returned no turn id');
  }
  if (startResponse.turn?.status && startResponse.turn.status !== 'inProgress') {
    completion.cancel();
    return startResponse.turn;
  }

  const onAbort = () => {
    client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await completion;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function waitForTurnCompletion(input) {
  const {
    client,
    threadId,
    turnIdRef,
    progress = null,
    timeoutMs = 0,
    signal = null,
  } = input;
  let cleanupWait = () => {};
  const promise = new Promise((resolve, reject) => {
    let timeout = null;
    const cleanup = () => {
      client.off?.('notification', onNotification);
      client.off?.('exit', onExit);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (timeout) clearTimeout(timeout);
    };
    cleanupWait = cleanup;
    const finish = callback => value => {
      cleanup();
      callback(value);
    };
    const onExit = error => finish(reject)(error);
    const onAbort = () => finish(reject)(abortError(signal.reason));
    const onNotification = message => {
      const summary = summarizeAppServerNotification(message);
      if (summary && progress) progress.add(summary);
      if (message?.method !== 'turn/completed') return;
      const turn = message.params?.turn;
      const currentTurnId = turnIdRef();
      if (message.params?.threadId !== threadId) return;
      if (currentTurnId && turn?.id !== currentTurnId) return;
      if (turn?.status === 'failed') {
        const detail = turn.error?.message || turn.error?.detail || 'Codex app-server turn failed';
        finish(reject)(new Error(detail));
        return;
      }
      finish(resolve)(turn);
    };

    client.on?.('notification', onNotification);
    client.on?.('exit', onExit);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0) {
      timeout = setTimeout(
        () => finish(reject)(new Error(`codex app-server turn timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      timeout.unref();
    }
  });
  promise.cancel = cleanupWait;
  return promise;
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(reason ? String(reason) : 'app-server turn aborted');
  error.name = 'AbortError';
  return error;
}
