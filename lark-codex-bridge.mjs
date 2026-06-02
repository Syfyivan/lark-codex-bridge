#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defaultEnvFile = join(process.cwd(), '.env');

function packageInfo() {
  const fallback = {
    name: 'lark-codex-bridge',
    version: '0.0.0',
  };
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return fallback;
  }
}

function printHelp() {
  const info = packageInfo();
  console.log(`Lark Codex Bridge ${info.version}

Usage:
  lark-codex-bridge [start] [--env <file>]
  lark-codex-bridge init [--env <file>] [--force]
  lark-codex-bridge doctor [--env <file>]
  lark-codex-bridge --help
  lark-codex-bridge --version

Commands:
  start   Start the Lark event bridge and optional HTTP server. This is the default.
  init    Create a starter .env file in the current directory.
  doctor  Check local Node.js, Codex CLI, lark-cli, and key configuration.

Examples:
  npm exec --yes --package github:Syfyivan/lark-codex-bridge -- lark-codex-bridge init
  npm exec --yes --package github:Syfyivan/lark-codex-bridge -- lark-codex-bridge doctor
  npm exec --yes --package github:Syfyivan/lark-codex-bridge -- lark-codex-bridge
`);
}

function parseCliArgs(args) {
  const result = {
    command: 'start',
    envFile: defaultEnvFile,
    envExplicit: false,
    force: false,
    help: false,
    version: false,
    errors: [],
  };
  const commands = new Set(['start', 'init', 'doctor', 'help', 'version']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      result.version = true;
      continue;
    }
    if (arg === '--force') {
      result.force = true;
      continue;
    }
    if (arg === '--env' || arg === '--env-file') {
      const value = args[index + 1];
      if (!value) {
        result.errors.push(`${arg} requires a file path`);
      } else {
        result.envFile = resolve(value);
        result.envExplicit = true;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--env=')) {
      result.envFile = resolve(arg.slice('--env='.length));
      result.envExplicit = true;
      continue;
    }
    if (!arg.startsWith('-') && commands.has(arg)) {
      result.command = arg;
      continue;
    }
    result.errors.push(`Unknown argument: ${arg}`);
  }

  if (result.help || result.command === 'help') result.command = 'help';
  if (result.version || result.command === 'version') result.command = 'version';
  return result;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const cleaned = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const equalsIndex = cleaned.indexOf('=');
  if (equalsIndex <= 0) return null;

  const key = cleaned.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = cleaned.slice(equalsIndex + 1).trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
    if (quote === '"') {
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }

  return { key, value };
}

function loadEnvFile(envFile, { explicit = false } = {}) {
  if (process.env.BRIDGE_DOTENV === '0') return { loaded: false, path: envFile };
  if (!existsSync(envFile)) {
    if (explicit) throw new Error(`Env file not found: ${envFile}`);
    return { loaded: false, path: envFile };
  }

  const lines = readFileSync(envFile, 'utf8').split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed || Object.hasOwn(process.env, parsed.key)) continue;
    process.env[parsed.key] = parsed.value;
    count += 1;
  }
  return { loaded: true, path: envFile, count };
}

function createEnvFile(envFile, { force = false } = {}) {
  if (existsSync(envFile) && !force) {
    throw new Error(`${envFile} already exists. Use --force to overwrite it.`);
  }
  const templatePath = join(packageDir, '.env.example');
  const template = readFileSync(templatePath, 'utf8');
  mkdirSync(dirname(envFile), { recursive: true });
  writeFileSync(envFile, template);
  console.log(`Created ${envFile}`);
  console.log('Edit it, then run: lark-codex-bridge doctor');
}

const cli = parseCliArgs(process.argv.slice(2));

if (cli.errors.length) {
  console.error(cli.errors.join('\n'));
  console.error('');
  printHelp();
  process.exit(2);
}

if (cli.command === 'help') {
  printHelp();
  process.exit(0);
}

if (cli.command === 'version') {
  console.log(packageInfo().version);
  process.exit(0);
}

if (cli.command === 'init') {
  try {
    createEnvFile(cli.envFile, { force: cli.force });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  process.exit(0);
}

let loadedEnvInfo = { loaded: false, path: cli.envFile, count: 0 };

try {
  loadedEnvInfo = loadEnvFile(cli.envFile, { explicit: cli.envExplicit });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const env = process.env;
const defaultCodexHome = env.CODEX_HOME || join(homedir(), '.codex');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function envFlag(name, defaultValue = false) {
  const value = env[name];
  if (value === undefined) return defaultValue;
  return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function parseReactionRules(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('REACTION_ON_RECEIVE_RULES must be a JSON array');
  }

  return parsed
    .map((rule, index) => {
      if (!rule || typeof rule !== 'object') return null;
      const emoji = String(rule.emoji || rule.emoji_type || '').trim();
      if (!emoji) return null;

      const contains = Array.isArray(rule.contains)
        ? rule.contains
        : rule.contains
          ? [rule.contains]
          : [];
      const containsText = contains
        .map(item => String(item || '').trim())
        .filter(Boolean);
      const pattern = String(rule.pattern || rule.regex || '').trim();

      if (!containsText.length && !pattern) return null;
      return {
        index,
        emoji,
        contains: containsText,
        pattern,
        flags: String(rule.flags || 'i'),
        caseSensitive: envFlagValue(rule.case_sensitive ?? rule.caseSensitive, false),
      };
    })
    .filter(Boolean);
}

function envFlagValue(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  return !['', '0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function readSecretFromEnv() {
  if (env.SERVICE_ACCOUNT_SECRET) return env.SERVICE_ACCOUNT_SECRET;
  if (!env.SERVICE_ACCOUNT_SECRET_FILE) return '';
  return readFileSync(env.SERVICE_ACCOUNT_SECRET_FILE, 'utf8').trim();
}

function readOptionalSecret(value, file) {
  if (value) return value;
  if (!file) return '';
  return readFileSync(file, 'utf8').trim();
}

const config = {
  mode: env.BRIDGE_MODE || 'codex',
  debug: env.BRIDGE_DEBUG === '1',
  prefix: env.BRIDGE_PREFIX || '',
  reactionOnReceive: env.REACTION_ON_RECEIVE || '',
  reactionOnReceiveRules: parseReactionRules(env.REACTION_ON_RECEIVE_RULES),
  requireMentionInGroup: env.REQUIRE_MENTION_IN_GROUP !== '0',
  botOpenId: env.BOT_OPEN_ID || '',
  botMentionNames: splitCsv(env.BOT_MENTION_NAMES),
  mentionLookupTimeoutMs: Number(env.MENTION_LOOKUP_TIMEOUT_MS || 8000),
  loopAllowSenderIds: splitCsv(env.LOOP_ALLOW_SENDER_IDS),
  loopIgnoreSenderIds: splitCsv(env.LOOP_IGNORE_SENDER_IDS),
  loopBotSenderIds: splitCsv(env.LOOP_BOT_SENDER_IDS),
  loopRespondToBotSenders: envFlag('LOOP_RESPOND_TO_BOT_SENDERS', false),
  loopMaxTurns: Math.max(1, Number(env.LOOP_MAX_TURNS || 3)),
  traceMarker: env.BRIDGE_TRACE_MARKER || 'bridge_trace',
  botSendCommands: splitCsv(env.BOT_SEND_COMMANDS || '/bot-send,/send-bot,发给机器人'),
  botSendInviteByAppId: envFlag('BOT_SEND_INVITE_BY_APP_ID', false),
  sessionShareEnabled: envFlag('SESSION_SHARE_ENABLED', true),
  sessionShareCommands: splitCsv(
    env.SESSION_SHARE_COMMANDS ||
      '/session-share,/share-session,分享session,分享会话,导出session,导出会话,session快照,会话快照',
  ),
  codexHome: defaultCodexHome,
  codexSessionIndexFile: env.CODEX_SESSION_INDEX_FILE || join(defaultCodexHome, 'session_index.jsonl'),
  sessionShareDocAs: env.SESSION_SHARE_DOC_AS === 'bot' ? 'bot' : 'user',
  sessionShareFolderToken: env.SESSION_SHARE_FOLDER_TOKEN || '',
  sessionShareWikiNode: env.SESSION_SHARE_WIKI_NODE || '',
  sessionShareWikiSpace: env.SESSION_SHARE_WIKI_SPACE || '',
  sessionShareOutput: (env.SESSION_SHARE_OUTPUT || env.SESSION_SHARE_TARGET || 'web').toLowerCase(),
  sessionShareStoreDir:
    env.SESSION_SHARE_STORE_DIR || join(homedir(), '.lark-codex-bridge', 'session-shares'),
  sessionSharePublicBaseUrl: env.SESSION_SHARE_PUBLIC_BASE_URL || '',
  sessionShareGoofyAlias: env.SESSION_SHARE_GOOFY_ALIAS || '',
  sessionShareGoofyDescription:
    env.SESSION_SHARE_GOOFY_DESCRIPTION || 'Codex session share snapshots',
  sessionShareGoofyPreviewDir:
    env.SESSION_SHARE_GOOFY_PREVIEW_DIR ||
    join(homedir(), '.lark-codex-bridge', 'goofy-session-share-preview'),
  sessionShareGoofyExpiryDays: Math.max(1, Number(env.SESSION_SHARE_GOOFY_EXPIRY_DAYS || 365)),
  sessionShareGoofyTimeoutMs: Math.max(60_000, Number(env.SESSION_SHARE_GOOFY_TIMEOUT_MS || 180_000)),
  sessionShareReplyStyle: env.SESSION_SHARE_REPLY_STYLE || 'card',
  sessionShareMaxChars: Math.max(20_000, Number(env.SESSION_SHARE_MAX_CHARS || 180_000)),
  sessionShareChunkChars: Math.max(5000, Number(env.SESSION_SHARE_CHUNK_CHARS || 30_000)),
  sessionShareCandidateLimit: Math.max(3, Number(env.SESSION_SHARE_CANDIDATE_LIMIT || 6)),
  delegateMentionEnabled: envFlag('DELEGATE_MENTION_ENABLED', false),
  delegateUserOpenId: env.DELEGATE_USER_OPEN_ID || '',
  delegateUserNames: splitCsv(env.DELEGATE_USER_NAMES || ''),
  delegateApproverOpenId: env.DELEGATE_APPROVER_OPEN_ID || env.DELEGATE_USER_OPEN_ID || '',
  delegateApprovalStoreFile:
    env.DELEGATE_APPROVAL_STORE_FILE ||
    join(homedir(), '.lark-codex-bridge', 'pending-approvals.json'),
  delegateContextMessages: Math.max(5, Number(env.DELEGATE_CONTEXT_MESSAGES || 30)),
  delegatePollEnabled: envFlag('DELEGATE_POLL_ENABLED', false),
  delegateWatchChatIds: splitCsv(env.DELEGATE_WATCH_CHAT_IDS || ''),
  delegatePollIntervalMs: Math.max(5000, Number(env.DELEGATE_POLL_INTERVAL_MS || 15000)),
  delegatePollPageSize: Math.max(5, Number(env.DELEGATE_POLL_PAGE_SIZE || 20)),
  delegatePollMaxAgeMs: Math.max(60 * 1000, Number(env.DELEGATE_POLL_MAX_AGE_MS || 60 * 60 * 1000)),
  delegateMinTextLength: Math.max(0, Number(env.DELEGATE_MIN_TEXT_LENGTH || 1)),
  delegateAllowBotSenders: envFlag('DELEGATE_ALLOW_BOT_SENDERS', true),
  delegateReplyInThread: envFlag('DELEGATE_REPLY_IN_THREAD', true),
  delegateAutoReplyEnabled: envFlag('DELEGATE_AUTO_REPLY_ENABLED', false),
  delegateAutoReplyMinConfidence: (env.DELEGATE_AUTO_REPLY_MIN_CONFIDENCE || 'high').toLowerCase(),
  eventEnabled: envFlag('BRIDGE_EVENT_ENABLED', true),
  httpHost: env.BRIDGE_HTTP_HOST || '127.0.0.1',
  httpPort: Number(env.BRIDGE_HTTP_PORT || 0),
  httpToken: readOptionalSecret(env.BRIDGE_HTTP_TOKEN || '', env.BRIDGE_HTTP_TOKEN_FILE || ''),
  larkCliBin: env.LARK_CLI_BIN || 'lark-cli',
  bytedCliBin: env.BYTEDCLI_BIN || 'bytedcli',
  jwtEndpoint: env.SERVICE_JWT_ENDPOINT || '',
  serviceAccountSecret: readSecretFromEnv(),
  larkEventTypes: env.LARK_EVENT_TYPES || 'im.message.receive_v1',
  agentGatewayUrl: env.AGENT_GATEWAY_URL || '',
  agentGatewayTarget: env.AGENT_GATEWAY_TARGET || env.TARGET_SERVICE || '',
  serviceApiUrl: env.SERVICE_API_URL || '',
  serviceApiMethod: env.SERVICE_API_METHOD || 'GET',
  serviceApiBody: env.SERVICE_API_BODY || '',
  codexBin: env.CODEX_BIN || 'codex',
  codexCwd: env.CODEX_CWD || process.cwd(),
  codexSandbox: env.CODEX_SANDBOX || 'read-only',
  codexModel: env.CODEX_MODEL || '',
  codexTimeoutMs: Number(env.CODEX_TIMEOUT_MS || 10 * 60 * 1000),
  codexEphemeral: env.CODEX_EPHEMERAL !== '0',
  codexResume: env.CODEX_RESUME || '',
  progressCardEnabled: envFlag('PROGRESS_CARD_ENABLED', false),
  progressCardUpdateIntervalMs: Math.max(3000, Number(env.PROGRESS_CARD_UPDATE_INTERVAL_MS || 8000)),
  progressCardMaxItems: Math.max(3, Number(env.PROGRESS_CARD_MAX_ITEMS || 8)),
  progressCardFinalReply: envFlag('PROGRESS_CARD_FINAL_REPLY', false),
  codexPromptPrefix:
    env.CODEX_PROMPT_PREFIX ||
    [
      '你是通过飞书机器人被调用的 Codex。请用中文简洁回答。',
      '你可以使用本机可用的 CLI 工具和 lark-cli 完成查询，优先使用结构化输出，例如 lark-cli ... --format json。',
      '读取飞书群消息、历史消息、搜索消息时，优先使用 lark-cli 的 user 身份：lark-cli im +chat-messages-list --as user --chat-id <oc_xxx> 或 lark-cli im +messages-search --as user --chat-id <oc_xxx>；发送、回复、表情回复才使用 bot 身份。',
      '当用户说“本群”“群消息”“最近消息”时，优先使用飞书事件上下文里的 chat_id，不要只做全局搜索；筛选 DDL/通知类内容时要排除机器人/应用自己的历史回复，避免把权限报错或自己的总结当成结果。',
      '当你作为某个用户的代理处理群内 @ 提及消息时，只生成建议操作和待发送回复；不要直接向群里发送，bridge 会先发给审批人确认。',
      '默认只做只读查询、诊断、总结和说明。除非飞书消息明确要求创建、修改、删除、发布、审批、发消息、提交工单或改代码，否则不要执行有副作用的操作。',
      '执行任何可能有副作用的命令前，先在回复中说明将要做什么；在非交互环境不能确认时，给出待执行命令而不是擅自执行。',
      '不要输出 token、secret、cookie、JWT、appSecret、服务账号 ID、服务账号名称或服务账号密钥；除非用户明确要求核对身份，也只描述为“已配置的服务账号”。',
    ].join('\n'),
};

const seenMessages = new Set();
let mentionLookupWarningLogged = false;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function appendLineBuffer(onLine) {
  let buffer = '';
  return chunk => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) onLine(line);
    }
  };
}

function tryJson(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tryJsonLoose(value) {
  const parsed = tryJson(value);
  if (parsed) return parsed;

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return tryJson(value.slice(start, end + 1));
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function clampText(value, maxLength) {
  const text = stripAnsi(String(value || '')).trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function clampReply(value) {
  return clampText(value, 3500);
}

function redactForCard(value) {
  return String(value || '')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:token|secret|cookie|jwt|appsecret|app_secret)\s*[=:]\s*)[^\s'",，。]+/gi, '$1[redacted]');
}

function redactForSessionSnapshot(value) {
  return redactForCard(value).replace(
    /((?:authorization|password|passwd|access[_-]?token|refresh[_-]?token|密钥|密码|令牌)\s*[=:：]\s*)[^\s'",，。]+/gi,
    '$1[redacted]',
  );
}

function formatLocalTime(date = new Date()) {
  return date
    .toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(/\//g, '-');
}

function findStringDeep(input, keys) {
  const queue = [input];
  const wanted = new Set(keys);
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      if (wanted.has(key) && typeof value === 'string' && value.trim()) {
        return value;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}

function findArraysDeep(input, keys) {
  const queue = [input];
  const wanted = new Set(keys);
  const results = [];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      if (wanted.has(key) && Array.isArray(value)) results.push(value);
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return results;
}

function extractText(event) {
  const direct = findStringDeep(event, ['text', 'plain_text', 'message_text']);
  if (direct) return direct;

  const content = findStringDeep(event, ['content']);
  const parsed = tryJson(content);
  if (parsed?.text) return String(parsed.text);
  if (parsed?.content) return String(parsed.content);
  return content || '';
}

function extractMessageId(event) {
  return findStringDeep(event, ['message_id', 'messageId', 'open_message_id', 'openMessageId']);
}

function extractEventType(event) {
  return findStringDeep(event, ['event_type', 'eventType', 'type']).toLowerCase();
}

function extractEventId(event) {
  return findStringDeep(event, ['event_id', 'eventId']);
}

function extractChatId(event) {
  return findStringDeep(event, ['chat_id', 'chatId', 'open_chat_id', 'openChatId']);
}

function extractChatType(event) {
  return findStringDeep(event, ['chat_type', 'chatType']).toLowerCase();
}

function extractSenderId(event) {
  if (typeof event?.sender_id === 'string') return event.sender_id;
  if (typeof event?.senderId === 'string') return event.senderId;
  const rawSenderId = event?.event?.sender?.sender_id;
  if (typeof rawSenderId?.open_id === 'string') return rawSenderId.open_id;
  if (typeof rawSenderId?.app_id === 'string') return rawSenderId.app_id;
  return findStringDeep(event, ['sender_id', 'senderId']);
}

function extractSenderType(event) {
  return findStringDeep(event, ['sender_type', 'senderType']).toLowerCase();
}

function extractSenderName(event) {
  const rawSender = event?.event?.sender;
  const names = [
    event?.sender_name,
    event?.senderName,
    event?.sender?.name,
    event?.sender?.display_name,
    event?.sender?.displayName,
    rawSender?.name,
    rawSender?.sender_name,
    rawSender?.senderName,
    rawSender?.sender_id?.name,
  ];
  return names.find(value => typeof value === 'string' && value.trim()) || '';
}

function isMentionableUserOpenId(value) {
  return typeof value === 'string' && value.startsWith('ou_');
}

function mentionMatchesBot(mention) {
  if (!mention || typeof mention !== 'object') return false;

  const ids = [
    mention.id,
    mention.open_id,
    mention.openId,
    mention.user_id,
    mention.userId,
    mention.union_id,
    mention.unionId,
    mention?.id?.open_id,
    mention?.id?.openId,
    mention?.id?.user_id,
    mention?.id?.userId,
  ]
    .filter(value => typeof value === 'string')
    .map(value => value.trim());

  if (config.botOpenId && ids.includes(config.botOpenId)) return true;

  const names = [
    mention.name,
    mention.display_name,
    mention.displayName,
    mention.en_name,
    mention.enName,
  ].filter(value => typeof value === 'string');

  return config.botMentionNames.some(botName => names.includes(botName));
}

function mentionMatchesDelegateUser(mention) {
  if (!mention || typeof mention !== 'object') return false;

  const ids = [
    mention.id,
    mention.open_id,
    mention.openId,
    mention.user_id,
    mention.userId,
    mention.union_id,
    mention.unionId,
    mention?.id?.open_id,
    mention?.id?.openId,
    mention?.id?.user_id,
    mention?.id?.userId,
  ]
    .filter(value => typeof value === 'string')
    .map(value => value.trim());

  if (config.delegateUserOpenId && ids.includes(config.delegateUserOpenId)) return true;

  const names = [
    mention.name,
    mention.display_name,
    mention.displayName,
    mention.en_name,
    mention.enName,
  ].filter(value => typeof value === 'string');

  return config.delegateUserNames.some(userName => names.includes(userName));
}

function eventMentionsBot(event) {
  return findArraysDeep(event, ['mentions', 'mention']).some(mentions =>
    mentions.some(mentionMatchesBot),
  );
}

function eventMentionsDelegateUser(event) {
  return findArraysDeep(event, ['mentions', 'mention']).some(mentions =>
    mentions.some(mentionMatchesDelegateUser),
  );
}

function textMentionsBot(text) {
  if (!text || !config.botMentionNames.length) return false;
  return config.botMentionNames.some(name => text.includes(`@${name}`));
}

function textMentionsDelegateUser(text) {
  if (!text || !config.delegateUserNames.length) return false;
  return config.delegateUserNames.some(name => text.includes(`@${name}`));
}

function textHasAnyAt(text) {
  return text.includes('@') || text.includes('@_user_') || text.includes('<at');
}

async function fetchedMessageMentionsBot(messageId) {
  if (!messageId || config.mentionLookupTimeoutMs <= 0) return false;

  try {
    const stdout = await runCli(
      [
        'im',
        '+messages-mget',
        '--as',
        'bot',
        '--message-ids',
        messageId,
        '--format',
        'json',
      ],
      '',
      { timeoutMs: config.mentionLookupTimeoutMs },
    );
    return eventMentionsBot(tryJsonLoose(stdout) || {});
  } catch (error) {
    if (!mentionLookupWarningLogged) {
      mentionLookupWarningLogged = true;
      console.error(`[bridge] failed to look up message mentions: ${error.message}`);
    }
    return false;
  }
}

async function fetchedMessageMentionsDelegateUser(messageId) {
  if (!messageId || config.mentionLookupTimeoutMs <= 0) return false;

  try {
    const stdout = await runCli(
      [
        'im',
        '+messages-mget',
        '--as',
        'user',
        '--message-ids',
        messageId,
        '--format',
        'json',
      ],
      '',
      { timeoutMs: config.mentionLookupTimeoutMs },
    );
    return eventMentionsDelegateUser(tryJsonLoose(stdout) || {});
  } catch (error) {
    if (!mentionLookupWarningLogged) {
      mentionLookupWarningLogged = true;
      console.error(`[bridge] failed to look up delegate mention: ${error.message}`);
    }
    return false;
  }
}

async function shouldHandleEvent(event, rawText) {
  if (!config.requireMentionInGroup) return true;

  const chatType = extractChatType(event);
  if (chatType === 'p2p') return true;
  if (config.prefix && rawText.startsWith(config.prefix)) return true;

  if (eventMentionsBot(event) || textMentionsBot(rawText)) return true;
  if (!textHasAnyAt(rawText)) return false;

  return fetchedMessageMentionsBot(extractMessageId(event));
}

function stripBotMentionText(text) {
  return config.botMentionNames
    .reduce((result, name) => result.replaceAll(`@${name}`, ''), text)
    .replace(/@_user_\d+/g, '')
    .trim();
}

function stripDelegateMentionText(text) {
  return config.delegateUserNames
    .reduce((result, name) => result.replaceAll(`@${name}`, ''), String(text || ''))
    .replace(/@_user_\d+/g, '')
    .trim();
}

function hasActionableDelegateText(text) {
  const stripped = stripDelegateMentionText(text).replace(/\s+/g, '');
  return stripped.length >= config.delegateMinTextLength;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bridgeTracePattern() {
  return new RegExp(
    `\\[${escapeRegExp(config.traceMarker)}\\s+id=([A-Za-z0-9_-]+)\\s+turn=(\\d+)\\/(\\d+)\\]`,
  );
}

function extractBridgeTrace(text) {
  const match = bridgeTracePattern().exec(text || '');
  if (!match) return null;
  return {
    id: match[1],
    turn: Number(match[2]),
    maxTurns: Number(match[3]),
  };
}

function stripBridgeTraceText(text) {
  return String(text || '').replace(bridgeTracePattern(), '').trim();
}

function formatBridgeTrace(trace) {
  return `[${config.traceMarker} id=${trace.id} turn=${trace.turn}/${trace.maxTurns}]`;
}

function appendBridgeTrace(text, trace) {
  return `${String(text || '').trim()}\n\n${formatBridgeTrace(trace)}`.trim();
}

function nextTrace(parentTrace = null) {
  if (!parentTrace) {
    return { id: randomUUID(), turn: 1, maxTurns: config.loopMaxTurns };
  }
  return {
    id: parentTrace.id,
    turn: parentTrace.turn + 1,
    maxTurns: Math.min(parentTrace.maxTurns || config.loopMaxTurns, config.loopMaxTurns),
  };
}

function isKnownBotSender(event) {
  const senderType = extractSenderType(event);
  const senderId = extractSenderId(event);
  return (
    senderType === 'bot' ||
    senderType === 'app' ||
    senderId.startsWith('cli_') ||
    config.loopBotSenderIds.includes(senderId)
  );
}

function shouldSkipSender(event, rawText) {
  const senderId = extractSenderId(event);
  if (config.botOpenId && senderId === config.botOpenId) return 'self_sender';
  if (senderId && config.loopIgnoreSenderIds.includes(senderId)) return 'ignored_sender';
  if (config.loopAllowSenderIds.length && !config.loopAllowSenderIds.includes(senderId)) {
    return 'sender_not_allowed';
  }

  const trace = extractBridgeTrace(rawText);
  if (trace && trace.turn >= Math.min(trace.maxTurns || config.loopMaxTurns, config.loopMaxTurns)) {
    return 'max_turns_reached';
  }

  if (isKnownBotSender(event) && !config.loopRespondToBotSenders) {
    const delegateMentionFromBot =
      config.delegateAllowBotSenders &&
      config.delegateMentionEnabled &&
      hasActionableDelegateText(rawText) &&
      (eventMentionsDelegateUser(event) || textMentionsDelegateUser(rawText));
    if (!delegateMentionFromBot) return 'bot_sender_ignored';
  }
  return '';
}

function parseBotSendCommand(rawText, event) {
  const cleanText = stripBridgeTraceText(stripBotMentionText(rawText)).trim();
  const command = config.botSendCommands.find(prefix => {
    return cleanText === prefix || cleanText.startsWith(`${prefix} `);
  });
  if (!command) return null;

  const rest = cleanText.slice(command.length).trim();
  if (!rest) {
    throw new Error(
      '用法：/bot-send <机器人open_id|机器人app_id|id|名称> <消息>，或 /bot-send {"target_open_id":"ou_xxx","target_name":"Bot","text":"你好"}',
    );
  }

  if (rest.startsWith('{')) {
    const parsed = tryJson(rest);
    if (!parsed) throw new Error('/bot-send 后面的 JSON 无法解析');
    return {
      chatId: parsed.chat_id || extractChatId(event),
      targetOpenId: parsed.target_open_id || parsed.bot_open_id || parsed.open_id || '',
      targetAppId: parsed.target_app_id || parsed.bot_app_id || parsed.app_id || '',
      targetName: parsed.target_name || parsed.bot_name || parsed.name || '',
      text: parsed.text || parsed.message || '',
      maxTurns: Number(parsed.max_turns || config.loopMaxTurns),
    };
  }

  const parts = rest.split(/\s+/);
  let chatId = extractChatId(event);
  if (parts[0]?.startsWith('oc_')) chatId = parts.shift();

  const targetRaw = parts.shift() || '';
  const [targetId, inlineName = ''] = targetRaw.split('|');
  const text = parts.join(' ').trim();

  return {
    chatId,
    targetOpenId: targetId.startsWith('ou_') ? targetId : '',
    targetAppId: targetId.startsWith('cli_') ? targetId : '',
    targetName: inlineName || (!targetId.startsWith('ou_') && !targetId.startsWith('cli_') ? targetId : ''),
    text,
    maxTurns: config.loopMaxTurns,
  };
}

function buildBotSendText(command, trace) {
  const body = command.text.trim();
  if (!body) throw new Error('/bot-send 缺少要发送的消息内容');

  let head = '';
  if (command.targetOpenId) {
    const name = command.targetName || command.targetOpenId;
    head = `<at user_id="${command.targetOpenId}">${name}</at> `;
  } else if (command.targetName) {
    head = `@${command.targetName} `;
  } else if (command.targetAppId) {
    head = `@${command.targetAppId} `;
  }

  return appendBridgeTrace(`${head}${body}`, trace);
}

async function maybeInviteBotByAppId(command) {
  if (!config.botSendInviteByAppId || !command.targetAppId) return;
  await runCli([
    'im',
    'chat.members',
    'create',
    '--as',
    'bot',
    '--params',
    JSON.stringify({ chat_id: command.chatId, member_id_type: 'app_id', succeed_type: 1 }),
    '--data',
    JSON.stringify({ id_list: [command.targetAppId] }),
  ]);
}

async function sendBotMessage(command) {
  if (!command.chatId) throw new Error('/bot-send 缺少 chat_id，群聊里可省略，其他场景请显式传 oc_xxx');
  if (!command.targetOpenId && !command.targetAppId && !command.targetName) {
    throw new Error('/bot-send 缺少目标机器人，推荐传目标机器人的 open_id：ou_xxx');
  }

  const trace = nextTrace({ id: randomUUID(), turn: 0, maxTurns: command.maxTurns || config.loopMaxTurns });
  await maybeInviteBotByAppId(command);
  const text = buildBotSendText(command, trace);
  const stdout = await runCli([
    'im',
    '+messages-send',
    '--as',
    'bot',
    '--chat-id',
    command.chatId,
    '--content',
    JSON.stringify({ text }),
    '--idempotency-key',
    `bridge-bot-${trace.id}`,
  ]);

  const sent = tryJsonLoose(stdout) || {};
  const messageId = sent?.data?.message_id || sent?.message_id || '';
  const caveat =
    command.targetOpenId || !command.targetAppId
      ? ''
      : '\n注意：只提供 cli_xxx 时无法构造真实 @，建议补目标机器人的 open_id（ou_xxx）以触发对方机器人。';
  return `已发送给机器人目标，trace=${trace.id}，turn=${trace.turn}/${trace.maxTurns}${messageId ? `，message_id=${messageId}` : ''}。${caveat}`;
}

function sessionCommandText(rawText) {
  let text = stripBridgeTraceText(stripBotMentionText(rawText)).trim();
  if (config.prefix && text.startsWith(config.prefix)) {
    text = text.slice(config.prefix.length).trim();
  }
  return text;
}

function stripWrappingQuotes(value) {
  return String(value || '')
    .trim()
    .replace(/^[\s"'“”‘’「」『』]+/, '')
    .replace(/[\s"'“”‘’「」『』]+$/, '')
    .trim();
}

function cleanSessionTitleQuery(value) {
  let text = stripWrappingQuotes(value);
  const quoted = /["“「『']([^"”」』']+)["”」』']/.exec(text);
  if (quoted?.[1]) return quoted[1].trim();

  text = text
    .replace(/^(?:codex\s*)?(?:session|会话)\s*/i, '')
    .replace(/^(?:标题|title|名称|名字)(?:\s*(?:叫|为|是|:|：))?\s*/i, '')
    .replace(/^(?:叫|为|是|:|：)\s*/i, '')
    .replace(/[，,。；;]\s*(?:请)?(?:发送|发|分享到?|导出到?|写入|生成|创建).*(?:飞书)?文档.*$/i, '')
    .replace(/\s*(?:这个|该)?(?:的)?\s*(?:codex\s*)?(?:session|会话)\s*$/i, '')
    .trim();

  return stripWrappingQuotes(text);
}

function parseExplicitSessionTitleQuery(value) {
  const text = stripWrappingQuotes(value);
  const quoted = /["“「『']([^"”」』']+)["”」』']/.exec(text);
  if (quoted?.[1]) return quoted[1].trim();

  const match =
    /(?:标题|title|名称|名字)(?:\s*(?:叫|为|是|:|：))?\s*(.+?)\s*(?:的\s*)?(?:codex\s*)?(?:session|会话)(?=\s*(?:[，,。；;]|$|发送|发|分享到?|导出到?|导出|写入|生成|创建))/i.exec(
      text,
    );
  return match?.[1] ? cleanSessionTitleQuery(match[1]) : '';
}

function parseSessionIdQuery(value) {
  const match = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.exec(
    String(value || ''),
  );
  return match?.[0] || '';
}

function parseNaturalSessionReferenceQuery(value) {
  const text = stripWrappingQuotes(value);
  const sessionId = parseSessionIdQuery(text);
  if (sessionId) return sessionId;

  const leadingReference = /^(.+?)\s*(?:这个|该)?(?:的)?\s*(?:codex\s*)?(?:session|会话)(?=\s*(?:帮|请|给|生成|创建|分享|导出|快照|链接|link|文档|$))/i.exec(
    text,
  );
  return leadingReference?.[1] ? cleanSessionTitleQuery(leadingReference[1]) : '';
}

function parseSessionShareCommand(rawText) {
  if (!config.sessionShareEnabled) return null;

  const text = sessionCommandText(rawText);
  if (!text) return null;

  const lowerText = text.toLowerCase();
  const command = config.sessionShareCommands.find(item => {
    const lowerCommand = item.toLowerCase();
    return (
      lowerText === lowerCommand ||
      lowerText.startsWith(`${lowerCommand} `) ||
      lowerText.startsWith(`${lowerCommand}:`) ||
      lowerText.startsWith(`${lowerCommand}：`)
    );
  });

  if (command) {
    const rest = text.slice(command.length);
    return {
      query: parseExplicitSessionTitleQuery(rest) || cleanSessionTitleQuery(rest),
      raw: text,
      intent: 'share',
    };
  }

  const asksForSession = /(?:session|会话)/i.test(text);
  if (!asksForSession) return null;

  const asksToCreateShare = /(?:分享|导出|快照|文档|写入|生成|创建|链接|link)/i.test(text);
  const asksToFind = /(?:找一下|找下|查一下|查找|找到|找出|找找|搜一下|搜索)/i.test(text);
  const asksForSnapshot =
    asksToCreateShare || asksToFind;
  if (!asksForSnapshot) return null;

  const explicitTitleQuery = parseExplicitSessionTitleQuery(text);
  if (explicitTitleQuery) {
    return {
      query: explicitTitleQuery,
      raw: text,
      intent: asksToCreateShare ? 'share' : 'find',
    };
  }

  const naturalReferenceQuery = parseNaturalSessionReferenceQuery(text);
  if (naturalReferenceQuery) {
    return {
      query: naturalReferenceQuery,
      raw: text,
      intent: asksToCreateShare ? 'share' : 'find',
    };
  }

  const suffixMatch = /(?:分享|导出|快照).{0,12}(?:codex\s*)?(?:session|会话)\s+(.+)$/i.exec(
    text,
  );
  if (suffixMatch?.[1]) {
    return {
      query: cleanSessionTitleQuery(suffixMatch[1]),
      raw: text,
      intent: asksToCreateShare ? 'share' : 'find',
    };
  }

  return null;
}

function normalizeSessionTitle(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function readCodexSessionIndex() {
  if (!existsSync(config.codexSessionIndexFile)) {
    throw new Error(`找不到 Codex session 索引：${config.codexSessionIndexFile}`);
  }

  const sessionsById = new Map();
  const lines = readFileSync(config.codexSessionIndexFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = tryJson(line);
    if (!item || typeof item !== 'object') continue;

    const id = String(item.id || '').trim();
    const threadName = String(item.thread_name || item.title || item.name || '').trim();
    if (!id || !threadName) continue;

    sessionsById.set(id, {
      id,
      threadName,
      updatedAt: String(item.updated_at || item.updatedAt || '').trim(),
    });
  }

  return [...sessionsById.values()].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt) || 0;
    const rightTime = Date.parse(right.updatedAt) || 0;
    return rightTime - leftTime;
  });
}

function findCodexSession(query) {
  const normalizedQuery = normalizeSessionTitle(query);
  if (!normalizedQuery) {
    return { status: 'missing_query', matches: [] };
  }

  const sessions = readCodexSessionIndex();
  const byId = sessions.filter(
    session => session.id === query || session.id.startsWith(String(query).trim()),
  );
  if (byId.length === 1) return { status: 'ok', session: byId[0], matchType: 'id' };
  if (byId.length > 1) {
    return {
      status: 'ambiguous',
      matches: byId.slice(0, config.sessionShareCandidateLimit),
    };
  }

  const exact = sessions.filter(session => normalizeSessionTitle(session.threadName) === normalizedQuery);
  if (exact.length) return { status: 'ok', session: exact[0], matchType: 'exact' };

  const fuzzy = sessions.filter(session =>
    normalizeSessionTitle(session.threadName).includes(normalizedQuery),
  );
  if (fuzzy.length === 1) return { status: 'ok', session: fuzzy[0], matchType: 'fuzzy' };
  if (fuzzy.length > 1) {
    return {
      status: 'ambiguous',
      matches: fuzzy.slice(0, config.sessionShareCandidateLimit),
    };
  }

  return {
    status: 'not_found',
    matches: sessions.slice(0, config.sessionShareCandidateLimit),
  };
}

function formatSessionUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '未知';
  return formatLocalTime(date);
}

function formatSessionCandidates(candidates) {
  if (!candidates.length) return '无';
  return candidates
    .map(
      (session, index) =>
        `${index + 1}. ${session.threadName}（${formatSessionUpdatedAt(session.updatedAt)}，${session.id}）`,
    )
    .join('\n');
}

function findSessionJsonlById(root, id) {
  if (!root || !existsSync(root)) return '';

  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(`${id}.jsonl`)) return fullPath;
    }
  }

  return '';
}

function findCodexSessionFile(session) {
  const roots = [join(config.codexHome, 'sessions'), join(config.codexHome, 'archived_sessions')];
  for (const root of roots) {
    const file = findSessionJsonlById(root, session.id);
    if (file) return file;
  }
  throw new Error(`索引里有 session，但找不到本地记录文件：${session.id}`);
}

function isImageWrapperText(value) {
  return /^<\/?image>$/i.test(String(value || '').trim());
}

function safeSessionImageSrc(value) {
  const src = String(value || '').trim();
  if (/^https?:\/\//i.test(src)) return src;
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[-_A-Za-z0-9+/=\s]+$/i.test(src)) {
    return src.replace(/\s+/g, '');
  }
  return '';
}

function appendSessionTextPart(parts, text) {
  const value = String(text || '');
  if (!value.trim() || isImageWrapperText(value)) return;

  const previous = parts[parts.length - 1];
  if (previous?.type === 'text') {
    previous.text = [previous.text, value].filter(Boolean).join('\n');
    return;
  }

  parts.push({
    type: 'text',
    text: value,
  });
}

function extractCodexMessageParts(content) {
  if (typeof content === 'string') {
    const parts = [];
    appendSessionTextPart(parts, content);
    return parts;
  }
  if (!Array.isArray(content)) return [];

  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      appendSessionTextPart(parts, item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;

    const rawImageSrc =
      item.type === 'input_image' || item.type === 'image_url'
        ? findStringDeep(item, ['image_url', 'imageUrl', 'url', 'src'])
        : '';
    const imageSrc = safeSessionImageSrc(rawImageSrc);
    if (imageSrc) {
      parts.push({
        type: 'image',
        src: imageSrc,
        alt: findStringDeep(item, ['alt', 'filename', 'name']) || '图片',
      });
      continue;
    }

    const text =
      typeof item.text === 'string'
        ? item.text
        : typeof item.output_text === 'string'
          ? item.output_text
          : typeof item.input_text === 'string'
            ? item.input_text
            : typeof item.content === 'string'
              ? item.content
              : '';
    appendSessionTextPart(parts, text);
  }

  return parts;
}

function redactSessionMessageParts(parts) {
  return parts.map(part =>
    part.type === 'text'
      ? {
          ...part,
          text: redactForSessionSnapshot(part.text),
        }
      : part,
  );
}

function stripLeadingCodexContextText(text) {
  return String(text || '')
    .replace(/^# AGENTS\.md instructions for [^\n]*\n\n<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i, '')
    .replace(/^<environment_context>[\s\S]*?<\/environment_context>\s*/i, '')
    .trim();
}

function stripLeadingCodexContextParts(parts, role) {
  if (role !== 'user') return parts;

  let strippedLeadingText = false;
  return parts
    .map(part => {
      if (strippedLeadingText || part.type !== 'text') return part;
      strippedLeadingText = true;
      return {
        ...part,
        text: stripLeadingCodexContextText(part.text),
      };
    })
    .filter(part => part.type !== 'text' || part.text.trim());
}

function sessionMessagePartsToCopyText(parts) {
  return parts
    .map(part => {
      if (part.type === 'text') return part.text.trim();
      if (part.type === 'image') {
        return /^https?:\/\//i.test(part.src) ? `[图片: ${part.src}]` : '[图片]';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function sessionTurnParts(turn) {
  if (Array.isArray(turn.parts) && turn.parts.length) return turn.parts;
  const parts = [];
  appendSessionTextPart(parts, turn.text);
  return parts;
}

function mergeSessionTurnPhase(currentPhase, nextPhase) {
  const phases = [currentPhase, nextPhase]
    .flatMap(phase => String(phase || '').split(/\s*\/\s*/))
    .map(phase => phase.trim())
    .filter(Boolean);
  return [...new Set(phases)].join(' / ');
}

function mergeSessionMessageParts(left, right) {
  const leftParts = [...left];
  const rightParts = [...right];
  if (leftParts.length && rightParts.length) {
    appendSessionTextPart(leftParts, '\n\n');
  }
  return [...leftParts, ...rightParts];
}

function mergeAdjacentSessionTurns(turns) {
  const merged = [];

  for (const turn of turns) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === turn.role) {
      previous.parts = mergeSessionMessageParts(sessionTurnParts(previous), sessionTurnParts(turn));
      previous.text = sessionMessagePartsToCopyText(previous.parts);
      previous.phase = mergeSessionTurnPhase(previous.phase, turn.phase);
      if (!previous.timestamp && turn.timestamp) previous.timestamp = turn.timestamp;
      continue;
    }

    merged.push({
      ...turn,
      parts: sessionTurnParts(turn),
    });
  }

  return merged;
}

function parseCodexSessionTranscript(sessionFile) {
  const transcript = {
    meta: {},
    turns: [],
  };
  const lines = readFileSync(sessionFile, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const item = tryJson(line);
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'session_meta' && item.payload && typeof item.payload === 'object') {
      transcript.meta = item.payload;
      continue;
    }

    if (item.type !== 'response_item') continue;
    const payload = item.payload || {};
    if (payload.type !== 'message') continue;
    if (!['user', 'assistant'].includes(payload.role)) continue;

    const parts = stripLeadingCodexContextParts(
      redactSessionMessageParts(extractCodexMessageParts(payload.content)),
      payload.role,
    );
    const text = sessionMessagePartsToCopyText(parts).trim();
    if (!text) continue;

    transcript.turns.push({
      role: payload.role,
      timestamp: item.timestamp || '',
      phase: payload.phase || '',
      text,
      parts,
    });
  }

  transcript.turns = mergeAdjacentSessionTurns(transcript.turns);
  return transcript;
}

function escapeTableCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function markdownFence(text) {
  const matches = String(text || '').match(/`+/g) || [];
  const fenceLength = Math.max(3, ...matches.map(match => match.length + 1));
  const fence = '`'.repeat(fenceLength);
  return `${fence}\n${String(text || '').trimEnd()}\n${fence}`;
}

function buildSessionSnapshotMarkdown(session, sessionFile, transcript) {
  const exportedAt = formatLocalTime();
  const rawSource = transcript.meta?.originator || transcript.meta?.source || 'Codex';
  const source = typeof rawSource === 'string' ? rawSource : JSON.stringify(rawSource);
  const cwd = transcript.meta?.cwd || '';
  const header = [
    '## 会话信息',
    '',
    '| 字段 | 内容 |',
    '| --- | --- |',
    `| 标题 | ${escapeTableCell(session.threadName)} |`,
    `| Session ID | ${escapeTableCell(session.id)} |`,
    `| 更新时间 | ${escapeTableCell(formatSessionUpdatedAt(session.updatedAt))} |`,
    `| 导出时间 | ${escapeTableCell(exportedAt)} |`,
    `| 来源 | ${escapeTableCell(source)} |`,
    cwd ? `| 工作目录 | ${escapeTableCell(cwd)} |` : '',
    `| 本地记录 | ${escapeTableCell(sessionFile)} |`,
    '',
    '> 说明：只导出 Codex 中可见的用户和助手消息；system/developer 指令、工具调用、工具输出、token 统计已省略。',
    '',
    '---',
    '',
    '## 对话记录',
    '',
  ].filter(Boolean);

  const parts = [...header];
  let currentLength = parts.join('\n').length;
  let includedTurns = 0;
  let truncated = false;

  for (const turn of transcript.turns) {
    const roleName = turn.role === 'user' ? '用户' : 'Codex';
    const phase = turn.phase ? `，${turn.phase}` : '';
    const block = [
      `### ${includedTurns + 1}. ${roleName}`,
      turn.timestamp ? `时间：${formatSessionUpdatedAt(turn.timestamp)}${phase}` : '',
      '',
      markdownFence(turn.text),
      '',
    ]
      .filter(line => line !== '')
      .join('\n');

    if (currentLength + block.length > config.sessionShareMaxChars) {
      truncated = true;
      break;
    }

    parts.push(block);
    currentLength += block.length;
    includedTurns += 1;
  }

  if (!includedTurns) {
    parts.push('_没有提取到用户/助手可见消息。_');
  }

  if (truncated) {
    parts.push(
      [
        '---',
        '',
        `> Session 内容较长，已导出前 ${includedTurns}/${transcript.turns.length} 条可见消息。需要完整原始记录时，可在本机查看：\`${sessionFile}\``,
      ].join('\n'),
    );
  }

  return {
    markdown: parts.join('\n'),
    includedTurns,
    totalTurns: transcript.turns.length,
    truncated,
  };
}

function splitMarkdownChunks(markdown, chunkChars) {
  const limit = Math.max(5000, chunkChars);
  const text = String(markdown || '');
  if (text.length <= limit) return [text];

  const chunks = [];
  let rest = text;
  while (rest.length) {
    let end = Math.min(limit, rest.length);
    if (end < rest.length) {
      const turnBreak = rest.lastIndexOf('\n### ', end);
      const paragraphBreak = rest.lastIndexOf('\n\n', end);
      if (turnBreak > limit * 0.45) end = turnBreak;
      else if (paragraphBreak > limit * 0.45) end = paragraphBreak;
    }

    const chunk = rest.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(end).trim();
  }

  return chunks.map((chunk, index) =>
    index === 0 ? chunk : [`## 对话记录续篇 ${index}`, '', chunk].join('\n'),
  );
}

function sessionSharePlacementArgs() {
  if (config.sessionShareWikiNode) return ['--wiki-node', config.sessionShareWikiNode];
  if (config.sessionShareWikiSpace) return ['--wiki-space', config.sessionShareWikiSpace];
  if (config.sessionShareFolderToken) return ['--folder-token', config.sessionShareFolderToken];
  return [];
}

function extractCreatedDocInfo(stdout) {
  const parsed = tryJsonLoose(stdout) || {};
  return {
    docId: findStringDeep(parsed, ['doc_id', 'docId', 'document_id', 'documentId', 'token']),
    docUrl: findStringDeep(parsed, ['doc_url', 'docUrl', 'document_url', 'documentUrl', 'url']),
  };
}

function makeSessionShareDocTitle(threadName) {
  const title = `Codex session 快照 - ${String(threadName || '未命名会话').replace(/\s+/g, ' ').trim()}`;
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

function buildSessionShareCard({ session, doc, snapshot, matchType }) {
  const docRef = doc.docUrl || doc.docId || '';
  const matchText = formatSessionMatchType(matchType);
  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**Codex session**\n${clampCardText(session.threadName, 500)}`,
      },
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          `**匹配方式**：${matchText}`,
          `**消息数量**：${snapshot.includedTurns}/${snapshot.totalTurns}`,
          `**更新时间**：${formatSessionUpdatedAt(session.updatedAt)}`,
          doc.chunks > 1 ? `**写入方式**：分 ${doc.chunks} 段写入` : '',
          snapshot.truncated ? '**注意**：session 较长，文档中只包含前半段可见消息' : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    },
  ];

  if (docRef) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'primary',
          text: {
            tag: 'plain_text',
            content: '打开飞书文档',
          },
          url: docRef,
        },
      ],
    });
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'lark_md',
          content: docRef,
        },
      ],
    });
  } else {
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: '文档已创建，但 lark-cli 返回值里没有 doc_url/doc_id。',
        },
      ],
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'green',
      title: {
        tag: 'plain_text',
        content: 'Codex session 快照已生成',
      },
    },
    elements,
  };
}

function formatSessionShareSuccessText({ session, doc, snapshot, matchType }) {
  const matchText = matchType === 'fuzzy' ? '（按标题包含匹配）' : '';
  const docText = doc.docUrl || doc.docId || '文档已创建，但返回值里没有 doc_url/doc_id';
  const chunkText = doc.chunks > 1 ? `，分 ${doc.chunks} 段写入` : '';
  const truncatedText = snapshot.truncated
    ? `\n注意：session 较长，已导出前 ${snapshot.includedTurns}/${snapshot.totalTurns} 条可见消息。`
    : '';
  return `已导出 Codex session「${session.threadName}」${matchText}到飞书文档${chunkText}：\n${docText}${truncatedText}`;
}

async function replyWithSessionShareDocument(event, payload) {
  if (config.sessionShareReplyStyle === 'text') {
    await replyToLark(event, formatSessionShareSuccessText(payload));
    return;
  }

  const idempotencyKey = `session-share-card-${payload.session.id}-${extractMessageId(event) || randomUUID()}`;
  try {
    await sendCardToLark(event, buildSessionShareCard(payload), idempotencyKey);
  } catch (error) {
    console.error(`[bridge] failed to send session share card, falling back to text: ${error.message}`);
    await replyToLark(event, formatSessionShareSuccessText(payload));
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkifyEscapedHtml(value) {
  return String(value || '').replace(/https?:\/\/[^\s<]+/g, url => {
    const safeUrl = url.replace(/&amp;$/g, '');
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a>`;
  });
}

function renderSessionMessageHtml(text) {
  const source = String(text || '');
  const parts = [];
  const fencePattern = /```([A-Za-z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match = null;

  while ((match = fencePattern.exec(source))) {
    const plain = source.slice(lastIndex, match.index);
    if (plain.trim()) {
      parts.push(`<div class="message-text">${linkifyEscapedHtml(escapeHtml(plain))}</div>`);
    }

    const lang = match[1] ? `<div class="code-lang">${escapeHtml(match[1])}</div>` : '';
    parts.push(`<div class="code-card">${lang}<pre><code>${escapeHtml(match[2].trim())}</code></pre></div>`);
    lastIndex = fencePattern.lastIndex;
  }

  const tail = source.slice(lastIndex);
  if (tail.trim()) {
    parts.push(`<div class="message-text">${linkifyEscapedHtml(escapeHtml(tail))}</div>`);
  }

  return parts.join('\n') || '<div class="message-text"></div>';
}

function renderSessionImageHtml(part) {
  const src = safeSessionImageSrc(part?.src);
  if (!src) {
    return '<div class="message-image-placeholder">图片暂不可展示</div>';
  }

  const alt = escapeHtml(part.alt || '图片');
  return [
    '<figure class="message-image">',
    `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async">`,
    '</figure>',
  ].join('\n');
}

function renderSessionMessagePartsHtml(parts) {
  if (!Array.isArray(parts) || !parts.length) return renderSessionMessageHtml('');

  const html = [];
  for (const part of parts) {
    if (part?.type === 'image') {
      html.push(renderSessionImageHtml(part));
      continue;
    }
    if (part?.type === 'text') {
      const textHtml = renderSessionMessageHtml(part.text);
      if (textHtml) html.push(textHtml);
    }
  }

  return html.join('\n') || '<div class="message-text"></div>';
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getLanAddress() {
  const preferredNames = ['en0', 'en1', 'eth0'];
  const nets = networkInterfaces();
  const all = Object.entries(nets).flatMap(([name, entries]) =>
    (entries || []).map(entry => ({ name, entry })),
  );
  const candidates = all.filter(
    ({ entry }) => entry.family === 'IPv4' && !entry.internal && entry.address,
  );
  const preferred = candidates.find(candidate => preferredNames.includes(candidate.name));
  return (preferred || candidates[0])?.entry?.address || '127.0.0.1';
}

function sessionShareBaseUrl() {
  if (config.sessionSharePublicBaseUrl) {
    return config.sessionSharePublicBaseUrl.replace(/\/+$/, '');
  }

  const host =
    config.httpHost === '0.0.0.0' || config.httpHost === '::' ? getLanAddress() : config.httpHost;
  return `http://${host}:${config.httpPort}`;
}

function isSessionShareGoofyOutput() {
  return config.sessionShareOutput === 'goofy' || config.sessionShareOutput === 'goofy-preview';
}

function prepareSessionShareGoofyPreviewSource(currentShareFile) {
  const deployDir = config.sessionShareGoofyPreviewDir;
  const routeDir = join(deployDir, 'session-shares');
  rmSync(deployDir, { recursive: true, force: true });
  mkdirSync(routeDir, { recursive: true });

  const htmlFiles = readdirSync(config.sessionShareStoreDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => entry.name);

  for (const fileName of htmlFiles) {
    const source = join(config.sessionShareStoreDir, fileName);
    const shareId = fileName.slice(0, -'.html'.length);
    copyFileSync(source, join(deployDir, fileName));
    copyFileSync(source, join(routeDir, shareId));
    copyFileSync(source, join(routeDir, fileName));
  }

  copyFileSync(currentShareFile, join(deployDir, 'index.html'));
  return deployDir;
}

function extractGoofyPreviewBaseUrl(stdout) {
  const parsed = tryJsonLoose(stdout) || {};
  const preview = parsed?.data?.preview || {};
  const host =
    (Array.isArray(preview.domainPrefixes) && preview.domainPrefixes[0]) ||
    preview.domain ||
    preview.host ||
    '';
  if (!host) {
    throw new Error(`Goofy preview 部署成功，但返回值里没有预览域名：${stdout.slice(0, 500)}`);
  }

  return `https://${String(host).replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
}

async function deploySessionShareGoofyPreview(currentShareFile) {
  const alias = String(config.sessionShareGoofyAlias || '').trim();
  if (!alias) {
    throw new Error('SESSION_SHARE_OUTPUT=goofy 需要配置 SESSION_SHARE_GOOFY_ALIAS');
  }

  const sourceDir = prepareSessionShareGoofyPreviewSource(currentShareFile);
  const args = [
    '--json',
    'goofy',
    'preview',
    'deploy',
    sourceDir,
    '--alias',
    alias,
    '--override',
    '--description',
    config.sessionShareGoofyDescription,
    '--expiry-days',
    String(config.sessionShareGoofyExpiryDays),
  ];

  const { stdout } = await runProcess(config.bytedCliBin, args, {
    timeoutMs: config.sessionShareGoofyTimeoutMs,
    cwd: config.codexCwd,
  });
  return extractGoofyPreviewBaseUrl(stdout);
}

function makeWebShareId(sessionId) {
  return `${sessionId}-${randomUUID().split('-')[0]}`;
}

function sessionShareEnhancementCss() {
  return `
    .bubble-body,
    .share-content {
      position: relative;
      max-height: none;
      overflow: visible;
    }
    .bubble.is-collapsible:not(.is-expanded) .bubble-body,
    .bubble.is-collapsible:not(.is-expanded) .share-content {
      max-height: 15.2rem;
      overflow: hidden;
    }
    .bubble.is-collapsible:not(.is-expanded) .bubble-body::after,
    .bubble.is-collapsible:not(.is-expanded) .share-content::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 4.4rem;
      pointer-events: none;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0), var(--assistant-soft, var(--assistant, #fff)));
    }
    .turn-user .bubble.is-collapsible:not(.is-expanded) .bubble-body::after,
    .turn.user .bubble.is-collapsible:not(.is-expanded) .share-content::after {
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0), var(--user-soft, var(--user, #e9f2ff)));
    }
    .bubble-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 12px 12px;
    }
    .bubble-button {
      min-height: 30px;
      border: 1px solid rgba(37, 37, 37, .13);
      border-radius: 999px;
      padding: 0 11px;
      color: var(--ink, var(--text, #172033));
      background: rgba(255, 253, 249, .72);
      font: inherit;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
    }
    .bubble-button:hover {
      border-color: rgba(37, 37, 37, .28);
      background: rgba(255, 253, 249, .95);
    }
    .bubble-button:focus-visible {
      outline: 2px solid rgba(11, 107, 203, .4);
      outline-offset: 2px;
    }
    .copy-button.is-copied {
      color: #0d6b4f;
      border-color: rgba(31, 122, 100, .28);
      background: rgba(229, 243, 237, .9);
    }
  `.trim();
}

function sessionShareEnhancementScript() {
  return `
    (() => {
      const copyDataEl = document.getElementById('copy-data');
      const copyData = copyDataEl ? JSON.parse(copyDataEl.textContent || '{}') : {};
      const collapsedHeight = 260;

      const writeClipboard = async text => {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        if (!ok) throw new Error('copy command failed');
      };

      const findOrWrapContent = bubble => {
        const modern = bubble.querySelector(':scope > .bubble-body');
        if (modern) return modern;
        const existing = bubble.querySelector(':scope > .share-content');
        if (existing) return existing;

        const wrapper = document.createElement('div');
        wrapper.className = 'share-content';
        const children = Array.from(bubble.childNodes).filter(node => {
          return !(node.nodeType === 1 && node.classList?.contains('bubble-actions'));
        });
        children.forEach(node => wrapper.appendChild(node));
        bubble.insertBefore(wrapper, bubble.firstChild);
        return wrapper;
      };

      const isInjectedContextText = text => {
        const normalized = String(text || '').trim();
        const withoutLegacyTime = normalized.replace(
          /^\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}(?:\\s+·[^\\n]+)?\\s*/u,
          '',
        );
        return (
          withoutLegacyTime.startsWith('# AGENTS.md instructions for ') &&
          withoutLegacyTime.includes('<INSTRUCTIONS>') &&
          !withoutLegacyTime.includes('My request for Codex:')
        );
      };

      const updateVisibleCount = () => {
        const count = document.querySelector('.count-card strong');
        if (!count) return;
        const turns = Array.from(document.querySelectorAll('.conversation .turn, main > .turn, main section.turn'));
        count.textContent = String(turns.filter(turn => !turn.hidden).length);
      };

      const ensureActions = (bubble, index) => {
        let actions = bubble.querySelector(':scope > .bubble-actions');
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'bubble-actions';
          bubble.appendChild(actions);
        }

        const turn = bubble.closest('.turn') || bubble.closest('article');
        const turnId = turn?.id || bubble.id || 'turn-' + (index + 1);

        let toggle = actions.querySelector('.toggle-button');
        if (!toggle) {
          toggle = document.createElement('button');
          toggle.className = 'bubble-button toggle-button';
          toggle.type = 'button';
          toggle.textContent = '展开';
          actions.insertBefore(toggle, actions.firstChild);
        }
        toggle.dataset.turnId = toggle.dataset.turnId || turnId;

        let copy = actions.querySelector('.copy-button');
        if (!copy) {
          copy = document.createElement('button');
          copy.className = 'bubble-button copy-button';
          copy.type = 'button';
          actions.appendChild(copy);
        }
        if (!copy.classList.contains('is-copied')) copy.textContent = '复制整段';
        copy.dataset.turnId = copy.dataset.turnId || turnId;

        return { toggle, copy, turnId };
      };

      const refreshBubble = (bubble, index) => {
        const content = findOrWrapContent(bubble);
        const { toggle } = ensureActions(bubble, index);
        const expanded = bubble.classList.contains('is-expanded');

        content.style.maxHeight = 'none';
        const shouldCollapse = content.scrollHeight > collapsedHeight + 24;
        content.style.maxHeight = '';

        if (shouldCollapse) {
          bubble.classList.add('is-collapsible');
          toggle.hidden = false;
          toggle.textContent = expanded ? '收起' : '展开';
          toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        } else {
          bubble.classList.remove('is-collapsible', 'is-expanded');
          toggle.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        }
      };

      const refreshAll = () => {
        let visibleIndex = 0;
        document.querySelectorAll('.bubble').forEach(bubble => {
          const turn = bubble.closest('.turn') || bubble.closest('article');
          const content = findOrWrapContent(bubble);
          if (isInjectedContextText(content.innerText)) {
            if (turn) turn.hidden = true;
            return;
          }
          if (turn) turn.hidden = false;
          refreshBubble(bubble, visibleIndex);
          visibleIndex += 1;
        });
        updateVisibleCount();
      };

      requestAnimationFrame(refreshAll);
      window.setTimeout(refreshAll, 120);
      window.addEventListener('load', refreshAll, { once: true });
      window.addEventListener('resize', refreshAll);

      document.addEventListener('click', async event => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) return;

        const toggle = target.closest('.toggle-button');
        if (toggle) {
          const bubble = toggle.closest('.bubble');
          if (!bubble) return;
          const expanded = bubble.classList.toggle('is-expanded');
          toggle.textContent = expanded ? '收起' : '展开';
          toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          return;
        }

        const copyButton = target.closest('.copy-button');
        if (!copyButton) return;

        const bubble = copyButton.closest('.bubble');
        const content = bubble ? findOrWrapContent(bubble) : null;
        const text = copyData[copyButton.dataset.turnId] || content?.innerText || '';
        try {
          await writeClipboard(text);
          copyButton.textContent = '已复制';
          copyButton.classList.add('is-copied');
          window.setTimeout(() => {
            copyButton.textContent = '复制整段';
            copyButton.classList.remove('is-copied');
          }, 1600);
        } catch {
          copyButton.textContent = '复制失败';
          window.setTimeout(() => {
            copyButton.textContent = '复制整段';
          }, 1800);
        }
      });
    })();
  `.trim();
}

function stripLegacySessionShareScript(html) {
  const copyDataStart = html.indexOf('id="copy-data"');
  if (copyDataStart < 0) return html;

  const copyDataEnd = html.indexOf('</script>', copyDataStart);
  if (copyDataEnd < 0) return html;

  const scriptStart = html.indexOf('<script>', copyDataEnd + '</script>'.length);
  if (scriptStart < 0) return html;

  const scriptEnd = html.indexOf('</script>', scriptStart);
  if (scriptEnd < 0) return html;

  const scriptText = html.slice(scriptStart, scriptEnd);
  if (
    !scriptText.includes('copyData') ||
    !scriptText.includes('toggle-button') ||
    !scriptText.includes('copy-button')
  ) {
    return html;
  }

  return html.slice(0, scriptStart) + html.slice(scriptEnd + '</script>'.length);
}

function normalizeLegacySessionShareMarkup(html) {
  return html
    .replaceAll(' hidden>展开</button>', '>展开</button>')
    .replaceAll('>复制气泡</button>', '>复制整段</button>');
}

function enhanceSessionShareHtml(html) {
  if (html.includes('data-session-share-enhancer="v2"')) return html;

  const normalizedHtml = normalizeLegacySessionShareMarkup(stripLegacySessionShareScript(html));
  const style = `<style data-session-share-enhancer="v2">\n${sessionShareEnhancementCss()}\n</style>`;
  const script = `<script data-session-share-enhancer="v2">\n${sessionShareEnhancementScript()}\n</script>`;
  const withStyle = normalizedHtml.includes('</head>')
    ? normalizedHtml.replace('</head>', `${style}\n</head>`)
    : `${style}\n${normalizedHtml}`;
  return withStyle.includes('</body>')
    ? withStyle.replace('</body>', `${script}\n</body>`)
    : `${withStyle}\n${script}`;
}

function makeSessionSharePageHtml({ session, transcript, snapshot, shareId }) {
  const displayedTurns = transcript.turns.slice(0, snapshot.includedTurns);
  const copyData = {};
  const turns = displayedTurns
    .map((turn, index) => {
      const isUser = turn.role === 'user';
      const side = isUser ? 'user' : 'assistant';
      const label = isUser ? '用户' : 'codex 回复';
      const avatar = isUser ? '你' : 'C';
      const turnId = `turn-${index + 1}`;
      const time = turn.timestamp ? formatSessionUpdatedAt(turn.timestamp) : '';
      const phase = turn.phase ? ` · ${escapeHtml(turn.phase)}` : '';
      copyData[turnId] = turn.text;
      return [
        `<article class="turn turn-${side}" id="${turnId}">`,
        `<div class="avatar">${avatar}</div>`,
        '<div class="bubble-wrap">',
        `<div class="turn-meta"><span>${label}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}${phase}</div>`,
        '<div class="bubble">',
        `<div class="bubble-body">${renderSessionMessagePartsHtml(turn.parts)}</div>`,
        '<div class="bubble-actions">',
        `<button class="bubble-button toggle-button" type="button" data-turn-id="${turnId}">展开</button>`,
        `<button class="bubble-button copy-button" type="button" data-turn-id="${turnId}">复制整段</button>`,
        '</div>',
        '</div>',
        '</div>',
        '</article>',
      ].join('\n');
    })
    .join('\n');
  const copyDataJson = safeScriptJson(copyData);

  const sourceRaw = transcript.meta?.originator || transcript.meta?.source || 'Codex';
  const source = typeof sourceRaw === 'string' ? sourceRaw : JSON.stringify(sourceRaw);
  const createdAt = formatLocalTime();
  const truncatedNote = snapshot.truncated
    ? `<div class="notice">这个 session 很长，当前页面展示前 ${snapshot.includedTurns}/${snapshot.totalTurns} 条可见消息。</div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(session.threadName)} · Codex session 快照</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f3ee;
      --paper: #fffdf9;
      --ink: #252525;
      --muted: #6d716f;
      --line: #e7dfd4;
      --user: #1f7a64;
      --user-soft: #e5f3ed;
      --assistant: #334155;
      --assistant-soft: #eef2f7;
      --accent: #c85f3d;
      --code: #18202c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font: 16px/1.68 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(200, 95, 61, .14), transparent 28rem),
        radial-gradient(circle at 82% 6%, rgba(31, 122, 100, .12), transparent 26rem),
        linear-gradient(180deg, #fbf8f3 0%, var(--bg) 44%, #efe9df 100%);
    }
    .shell {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 36px 0 56px;
    }
    .hero {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 28px 0 18px;
      backdrop-filter: blur(18px);
      background: linear-gradient(180deg, rgba(246, 243, 238, .96), rgba(246, 243, 238, .78));
      border-bottom: 1px solid rgba(231, 223, 212, .8);
    }
    .title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
    }
    h1 {
      margin: 0;
      max-width: 820px;
      font-size: clamp(28px, 4vw, 48px);
      line-height: 1.08;
      letter-spacing: 0;
    }
    .eyebrow {
      margin-bottom: 10px;
      color: var(--accent);
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
      color: var(--muted);
      font-size: 14px;
    }
    .pill {
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 253, 249, .72);
    }
    .count-card {
      min-width: 132px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: 0 14px 34px rgba(76, 61, 44, .08);
      text-align: right;
    }
    .count-card strong {
      display: block;
      font-size: 26px;
      line-height: 1;
    }
    .count-card span { color: var(--muted); font-size: 13px; }
    .conversation {
      margin-top: 26px;
      padding: 10px 0;
    }
    .turn {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      margin: 18px 0;
      align-items: flex-start;
    }
    .turn-user {
      grid-template-columns: minmax(0, 1fr) 44px;
    }
    .turn-user .avatar { grid-column: 2; background: var(--user); }
    .turn-user .bubble-wrap { grid-column: 1; grid-row: 1; align-items: flex-end; }
    .turn-user .bubble { background: var(--user-soft); border-color: rgba(31, 122, 100, .22); }
    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: white;
      background: var(--assistant);
      font-weight: 800;
      box-shadow: 0 10px 24px rgba(37, 37, 37, .12);
    }
    .bubble-wrap {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      min-width: 0;
    }
    .turn-meta {
      margin: 0 2px 7px;
      color: var(--muted);
      font-size: 13px;
    }
    .turn-meta span {
      color: var(--ink);
      font-weight: 700;
      margin-right: 8px;
    }
    .bubble {
      position: relative;
      max-width: min(820px, 100%);
      padding: 0;
      border: 1px solid rgba(51, 65, 85, .14);
      border-radius: 8px;
      background: var(--assistant-soft);
      box-shadow: 0 10px 28px rgba(76, 61, 44, .07);
      overflow: hidden;
    }
    .bubble-body {
      position: relative;
      max-height: 15.2rem;
      padding: 16px 18px 0;
      overflow: hidden;
    }
    .bubble.is-expanded .bubble-body {
      max-height: none;
    }
    .bubble.is-collapsible:not(.is-expanded) .bubble-body::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 4.4rem;
      pointer-events: none;
      background: linear-gradient(to bottom, rgba(238, 242, 247, 0), var(--assistant-soft));
    }
    .turn-user .bubble.is-collapsible:not(.is-expanded) .bubble-body::after {
      background: linear-gradient(to bottom, rgba(229, 243, 237, 0), var(--user-soft));
    }
    .bubble-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 12px 12px;
    }
    .bubble-button {
      min-height: 30px;
      border: 1px solid rgba(37, 37, 37, .13);
      border-radius: 999px;
      padding: 0 11px;
      color: var(--ink);
      background: rgba(255, 253, 249, .72);
      font: inherit;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
    }
    .bubble-button:hover {
      border-color: rgba(37, 37, 37, .28);
      background: rgba(255, 253, 249, .95);
    }
    .bubble-button:focus-visible {
      outline: 2px solid rgba(11, 107, 203, .4);
      outline-offset: 2px;
    }
    .copy-button.is-copied {
      color: #0d6b4f;
      border-color: rgba(31, 122, 100, .28);
      background: rgba(229, 243, 237, .9);
    }
    .message-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .message-text + .message-text,
    .message-text + .code-card,
    .message-text + .message-image,
    .code-card + .message-text,
    .code-card + .message-image,
    .message-image + .message-text,
    .message-image + .code-card,
    .message-image + .message-image {
      margin-top: 12px;
    }
    .message-image {
      margin: 0;
      max-width: min(560px, 100%);
    }
    .message-image img {
      display: block;
      max-width: 100%;
      max-height: 460px;
      border: 1px solid rgba(37, 37, 37, .12);
      border-radius: 8px;
      background: rgba(255, 253, 249, .82);
      object-fit: contain;
      box-shadow: 0 10px 24px rgba(37, 37, 37, .08);
    }
    .message-image-placeholder {
      margin-top: 12px;
      padding: 12px 14px;
      border: 1px dashed rgba(37, 37, 37, .24);
      border-radius: 8px;
      color: var(--muted);
      background: rgba(255, 253, 249, .58);
      font-size: 14px;
    }
    a { color: #0b6bcb; text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .code-card {
      border-radius: 8px;
      overflow: hidden;
      background: var(--code);
      color: #e7edf6;
      border: 1px solid rgba(255, 255, 255, .08);
    }
    .code-lang {
      padding: 8px 12px;
      color: #aab6c6;
      border-bottom: 1px solid rgba(255, 255, 255, .08);
      font-size: 12px;
      text-transform: uppercase;
    }
    pre {
      margin: 0;
      padding: 14px;
      overflow: auto;
      font: 13px/1.58 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .notice {
      margin: 18px 0;
      padding: 12px 14px;
      border: 1px solid rgba(200, 95, 61, .3);
      border-radius: 8px;
      color: #7b341e;
      background: #fff3ed;
    }
    footer {
      margin-top: 36px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    @media (max-width: 720px) {
      .shell { width: min(100% - 20px, 1080px); padding-top: 18px; }
      .hero { position: static; padding-top: 18px; }
      .title-row { display: block; }
      .count-card { margin-top: 16px; text-align: left; }
      .turn,
      .turn-user { grid-template-columns: 34px minmax(0, 1fr); }
      .turn-user .avatar { grid-column: 1; }
      .turn-user .bubble-wrap { grid-column: 2; align-items: flex-start; }
      .avatar { width: 34px; height: 34px; font-size: 13px; }
      .bubble-body { padding: 14px 14px 0; }
      .bubble-actions { justify-content: flex-start; padding: 9px 10px 11px; }
    }
  </style>
  <style data-session-share-enhancer="v2">
${sessionShareEnhancementCss()}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="title-row">
        <div>
          <div class="eyebrow">Codex Session Snapshot</div>
          <h1>${escapeHtml(session.threadName)}</h1>
          <div class="meta">
            <span class="pill">Session ${escapeHtml(session.id)}</span>
            <span class="pill">Updated ${escapeHtml(formatSessionUpdatedAt(session.updatedAt))}</span>
            <span class="pill">Exported ${escapeHtml(createdAt)}</span>
            <span class="pill">${escapeHtml(source)}</span>
          </div>
        </div>
        <div class="count-card">
          <strong>${snapshot.includedTurns}</strong>
          <span>visible messages</span>
        </div>
      </div>
    </section>
    ${truncatedNote}
    <section class="conversation">
      ${turns || '<div class="notice">没有可展示的可见消息。</div>'}
    </section>
    <footer>Generated by Lark Codex Bridge · ${escapeHtml(shareId)}</footer>
  </main>
  <script id="copy-data" type="application/json">${copyDataJson}</script>
  <script data-session-share-enhancer="v2">
${sessionShareEnhancementScript()}
  </script>
</body>
</html>`;
}

async function createSessionShareWebPage(session, transcript, snapshot) {
  if (!config.httpPort && !isSessionShareGoofyOutput()) {
    throw new Error('SESSION_SHARE_OUTPUT=web 需要配置 BRIDGE_HTTP_PORT');
  }

  const shareId = makeWebShareId(session.id);
  const html = makeSessionSharePageHtml({ session, transcript, snapshot, shareId });
  mkdirSync(config.sessionShareStoreDir, { recursive: true });
  const file = join(config.sessionShareStoreDir, `${shareId}.html`);
  writeFileSync(file, html);

  if (isSessionShareGoofyOutput()) {
    const baseUrl = await deploySessionShareGoofyPreview(file);
    return {
      shareId,
      url: `${baseUrl}/session-shares/${shareId}`,
    };
  }

  return {
    shareId,
    url: `${sessionShareBaseUrl()}/session-shares/${shareId}`,
  };
}

function isSessionShareWebOutput() {
  return (
    config.sessionShareOutput === 'web' ||
    config.sessionShareOutput === 'html' ||
    isSessionShareGoofyOutput()
  );
}

function formatSessionMatchType(matchType) {
  if (matchType === 'fuzzy') return '标题包含匹配';
  if (matchType === 'id') return 'Session ID 匹配';
  return '标题精确匹配';
}

function buildSessionFoundCard({ session, snapshot, matchType }) {
  const actionText = isSessionShareWebOutput() ? '生成链接' : '生成文档';
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: '找到 Codex session',
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**Codex session**\n${clampCardText(session.threadName, 500)}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**匹配方式**：${formatSessionMatchType(matchType)}`,
            `**Session ID**：\`${session.id}\``,
            `**更新时间**：${formatSessionUpdatedAt(session.updatedAt)}`,
            snapshot ? `**消息数量**：${snapshot.includedTurns}/${snapshot.totalTurns}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: {
              tag: 'plain_text',
              content: actionText,
            },
            value: {
              bridge_action: 'session_generate_link',
              session_id: session.id,
              output: config.sessionShareOutput,
            },
          },
        ],
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `只做了查找，点击“${actionText}”后才会导出可打开的快照。`,
          },
        ],
      },
    ],
  };
}

function formatSessionFoundText({ session, snapshot, matchType }) {
  return [
    `找到 Codex session「${session.threadName}」。`,
    `匹配方式：${formatSessionMatchType(matchType)}`,
    `Session ID：${session.id}`,
    `更新时间：${formatSessionUpdatedAt(session.updatedAt)}`,
    snapshot ? `消息数量：${snapshot.includedTurns}/${snapshot.totalTurns}` : '',
    `如需链接，请发送：生成 ${session.id} 的 session 快照`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function replyWithSessionFoundCard(event, payload) {
  const idempotencyKey = `session-found-${payload.session.id}-${extractMessageId(event) || randomUUID()}`;
  try {
    await sendCardToLark(event, buildSessionFoundCard(payload), idempotencyKey);
  } catch (error) {
    console.error(`[bridge] failed to send session found card, falling back to text: ${error.message}`);
    await replyToLark(event, formatSessionFoundText(payload));
  }
}

function buildSessionShareWebCard({ session, share, snapshot, matchType }) {
  const matchText = formatSessionMatchType(matchType);
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'green',
      title: {
        tag: 'plain_text',
        content: 'Codex session 网页快照已生成',
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**Codex session**\n${clampCardText(session.threadName, 500)}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**匹配方式**：${matchText}`,
            `**消息数量**：${snapshot.includedTurns}/${snapshot.totalTurns}`,
            `**更新时间**：${formatSessionUpdatedAt(session.updatedAt)}`,
            snapshot.truncated ? '**注意**：session 较长，页面中只包含前半段可见消息' : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: {
              tag: 'plain_text',
              content: '打开网页快照',
            },
            url: share.url,
          },
        ],
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'lark_md',
            content: share.url,
          },
        ],
      },
    ],
  };
}

function formatSessionShareWebSuccessText({ session, share, snapshot, matchType }) {
  const matchText = matchType === 'fuzzy' ? '（按标题包含匹配）' : '';
  const truncatedText = snapshot.truncated
    ? `\n注意：session 较长，已导出前 ${snapshot.includedTurns}/${snapshot.totalTurns} 条可见消息。`
    : '';
  return `已生成 Codex session「${session.threadName}」${matchText}的网页快照：\n${share.url}${truncatedText}`;
}

async function replyWithSessionShareWebPage(event, payload) {
  if (config.sessionShareReplyStyle === 'text') {
    await replyToLark(event, formatSessionShareWebSuccessText(payload));
    return;
  }

  const idempotencyKey = `session-share-web-${payload.share.shareId}-${extractMessageId(event) || randomUUID()}`;
  try {
    await sendCardToLark(event, buildSessionShareWebCard(payload), idempotencyKey);
  } catch (error) {
    console.error(`[bridge] failed to send session share web card, falling back to text: ${error.message}`);
    await replyToLark(event, formatSessionShareWebSuccessText(payload));
  }
}

async function createSessionShareDocument(title, markdown) {
  const chunks = splitMarkdownChunks(markdown, config.sessionShareChunkChars);
  const createArgs = [
    'docs',
    '+create',
    '--as',
    config.sessionShareDocAs,
    '--title',
    title,
    '--markdown',
    chunks[0],
    ...sessionSharePlacementArgs(),
  ];
  const stdout = await runCli(createArgs, '', { timeoutMs: Math.min(config.codexTimeoutMs, 120_000) });
  const doc = extractCreatedDocInfo(stdout);
  const docRef = doc.docId || doc.docUrl;

  if (chunks.length > 1 && !docRef) {
    throw new Error(`文档已创建，但无法从返回值提取 doc_id/doc_url 来追加内容：${stdout.slice(0, 500)}`);
  }

  for (const chunk of chunks.slice(1)) {
    await runCli(
      [
        'docs',
        '+update',
        '--as',
        config.sessionShareDocAs,
        '--doc',
        docRef,
        '--mode',
        'append',
        '--markdown',
        chunk,
      ],
      '',
      { timeoutMs: Math.min(config.codexTimeoutMs, 120_000) },
    );
  }

  return {
    ...doc,
    chunks: chunks.length,
  };
}

async function handleSessionShareCommand(event, command) {
  const query = cleanSessionTitleQuery(command.query);
  if (!query) {
    await replyToLark(
      event,
      '用法：/session-share <session标题或ID>，也可以说“找一下标题叫 xxx 的 session”。',
    );
    return;
  }

  const result = findCodexSession(query);
  if (result.status === 'ambiguous') {
    await replyToLark(
      event,
      `匹配到多个 Codex session，请把标题说得更完整一点：\n${formatSessionCandidates(result.matches)}`,
    );
    return;
  }
  if (result.status !== 'ok') {
    await replyToLark(
      event,
      `没有找到标题或 ID 匹配「${query}」的 Codex session。\n最近的 session：\n${formatSessionCandidates(result.matches)}`,
    );
    return;
  }

  const sessionFile = findCodexSessionFile(result.session);
  const transcript = parseCodexSessionTranscript(sessionFile);
  if (!transcript.turns.length) {
    await replyToLark(event, `找到了 session「${result.session.threadName}」，但没有提取到可见对话消息。`);
    return;
  }

  const snapshot = buildSessionSnapshotMarkdown(result.session, sessionFile, transcript);
  if (command.intent === 'find') {
    await replyWithSessionFoundCard(event, {
      session: result.session,
      snapshot,
      matchType: result.matchType,
    });
    return;
  }

  if (isSessionShareWebOutput()) {
    const share = await createSessionShareWebPage(result.session, transcript, snapshot);
    await replyWithSessionShareWebPage(event, {
      session: result.session,
      share,
      snapshot,
      matchType: result.matchType,
    });
    return;
  }

  const doc = await createSessionShareDocument(
    makeSessionShareDocTitle(result.session.threadName),
    snapshot.markdown,
  );
  await replyWithSessionShareDocument(event, {
    session: result.session,
    doc,
    snapshot,
    matchType: result.matchType,
  });
}

async function updateOrSendSessionShareCard(event, card, idempotencyKey, fallbackText) {
  const cardMessageId = extractMessageId(event);
  if (cardMessageId) {
    try {
      await updateCardMessage(cardMessageId, card);
      return;
    } catch (error) {
      console.error(`[bridge] failed to update session card, falling back to new card: ${error.message}`);
    }
  }

  try {
    await sendCardToLark(event, card, idempotencyKey);
  } catch (error) {
    console.error(`[bridge] failed to send generated session card, falling back to text: ${error.message}`);
    await replyToLark(event, fallbackText);
  }
}

async function handleSessionGenerateLinkAction(event, value) {
  const sessionId = String(value.session_id || value.sessionId || '').trim();
  if (!sessionId) return false;

  const result = findCodexSession(sessionId);
  if (result.status !== 'ok') {
    await replyToLark(event, `生成链接失败：找不到 session ${sessionId}`);
    return true;
  }

  const sessionFile = findCodexSessionFile(result.session);
  const transcript = parseCodexSessionTranscript(sessionFile);
  if (!transcript.turns.length) {
    await replyToLark(event, `找到了 session「${result.session.threadName}」，但没有提取到可见对话消息。`);
    return true;
  }

  const snapshot = buildSessionSnapshotMarkdown(result.session, sessionFile, transcript);
  if (isSessionShareWebOutput()) {
    const share = await createSessionShareWebPage(result.session, transcript, snapshot);
    const payload = {
      session: result.session,
      share,
      snapshot,
      matchType: result.matchType,
    };
    await updateOrSendSessionShareCard(
      event,
      buildSessionShareWebCard(payload),
      `session-generate-web-${share.shareId}`,
      formatSessionShareWebSuccessText(payload),
    );
    return true;
  }

  const doc = await createSessionShareDocument(
    makeSessionShareDocTitle(result.session.threadName),
    snapshot.markdown,
  );
  const payload = {
    session: result.session,
    doc,
    snapshot,
    matchType: result.matchType,
  };
  await updateOrSendSessionShareCard(
    event,
    buildSessionShareCard(payload),
    `session-generate-doc-${result.session.id}-${extractEventId(event) || randomUUID()}`,
    formatSessionShareSuccessText(payload),
  );
  return true;
}

function loadApprovalStore() {
  if (!existsSync(config.delegateApprovalStoreFile)) return {};
  try {
    const parsed = tryJson(readFileSync(config.delegateApprovalStoreFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error(`[bridge] failed to read approval store: ${error.message}`);
    return {};
  }
}

function saveApprovalStore(store) {
  mkdirSync(dirname(config.delegateApprovalStoreFile), { recursive: true });
  writeFileSync(config.delegateApprovalStoreFile, `${JSON.stringify(store, null, 2)}\n`);
}

function saveApproval(approval) {
  const store = loadApprovalStore();
  store[approval.id] = approval;
  saveApprovalStore(store);
}

function getApproval(id) {
  return loadApprovalStore()[id] || null;
}

function updateApproval(id, patch) {
  const store = loadApprovalStore();
  if (!store[id]) return null;
  store[id] = { ...store[id], ...patch };
  saveApprovalStore(store);
  return store[id];
}

function approvalExistsForMessage(messageId) {
  if (!messageId) return false;
  return Object.values(loadApprovalStore()).some(
    approval => approval?.originalMessageId === messageId,
  );
}

function shortApprovalId() {
  return randomUUID().split('-')[0];
}

function clampCardText(value, maxLength = 1400) {
  const text = stripAnsi(String(value || '')).trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function parseJsonObjectLoose(text) {
  const raw = String(text || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [fenced?.[1], raw].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = tryJsonLoose(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

function normalizeDraftResult(output) {
  const parsed = parseJsonObjectLoose(output);
  if (!parsed) {
    return {
      operationPlan: '',
      replyText: clampReply(output),
      evidence: '',
      confidence: '',
      raw: output,
    };
  }

  const operationPlan = Array.isArray(parsed.operation_plan)
    ? parsed.operation_plan.join('\n')
    : String(parsed.operation_plan || parsed.action_plan || parsed.plan || '').trim();
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.join('\n')
    : String(parsed.evidence || parsed.reason || parsed.basis || '').trim();

  return {
    operationPlan,
    replyText: String(parsed.reply_text || parsed.reply || parsed.message || '').trim(),
    evidence,
    confidence: String(parsed.confidence || '').trim(),
    raw: output,
  };
}

function buildDelegateDraftPrompt(event, rawText) {
  const chatId = extractChatId(event);
  const messageId = extractMessageId(event);
  const requesterId = extractSenderId(event);
  const requesterName = extractSenderName(event) || requesterId || '对方';
  const delegatedName = config.delegateUserNames[0] || '被代理用户';

  return [
    `你是${delegatedName}的飞书助理。群里有人 @ ${delegatedName}，请先替${delegatedName}想好操作和回复，但绝对不要向群里发送消息。`,
    '',
    '你可以使用本机 lark-cli、文件系统和其他已配置的只读工具做查询。优先读取当前群最近消息，并按需要搜索飞书文档或历史消息。',
    `当前群 chat_id：${chatId || 'unknown'}`,
    `原始消息 message_id：${messageId || 'unknown'}`,
    `请求人 open_id：${requesterId || 'unknown'}`,
    `请求人显示名：${requesterName}`,
    `最多参考最近 ${config.delegateContextMessages} 条群消息。`,
    '',
    '用户在群里的原消息：',
    rawText,
    '',
    '请完成：',
    `1. 判断对方要${delegatedName}做什么。`,
    '2. 根据群历史、相关文档、文件或上下文找出最可能需要的材料；如果找不到，要明确写“需要人工补充”。',
    '3. 如果对方请求 review/approve MR 或变更，只做只读 review：阅读链接、diff、评论、CI/测试状态和相关上下文，指出风险或确认未发现明显问题；不要直接在代码平台点 approve，除非审批人后续明确确认。',
    '4. 给出建议操作。',
    '5. 写好一段可以发到原消息话题/线程里的回复，不要在回复中伪装成机器人，不要泄露 token/secret。',
    '',
    '只输出一个 JSON 对象，不要输出 Markdown 解释。字段：',
    '{"operation_plan":["..."],"reply_text":"...","evidence":["..."],"confidence":"high|medium|low"}',
  ].join('\n');
}

function buildApprovalCard(approval) {
  const requestSnippet = clampCardText(approval.requestText, 600);
  const plan = clampCardText(approval.operationPlan || '无额外操作建议', 900);
  const reply = clampCardText(approval.replyText || '未生成可发送回复', 1200);
  const evidence = clampCardText(approval.evidence || '无', 700);
  const consentNote = config.delegateAutoReplyEnabled
    ? '自动回复开关已开启；本条因未满足自动发送条件，仍需你同意后才会发送。'
    : '自动回复开关关闭；未经过你同意不会发送。';
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: '有人 @ 你，已拟好回复',
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**请求人**：${approval.requesterName || approval.requesterOpenId || '未知'}\n**来源群**：${approval.chatId}\n**请求 ID**：${approval.id}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**原消息**\n${requestSnippet}`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**建议操作**\n${plan}\n\n**将发送的回复**\n${reply}`,
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**依据**\n${evidence}`,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `${consentNote} 同意后会回复到原消息话题/线程，不刷主群。按钮不可用时，直接回复：同意发送 ${approval.id} / 取消发送 ${approval.id}`,
          },
        ],
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: {
              tag: 'plain_text',
              content: config.delegateReplyInThread ? '同意发到话题' : '同意发送',
            },
            value: {
              bridge_action: 'delegate_approve',
              approval_id: approval.id,
            },
          },
          {
            tag: 'button',
            type: 'default',
            text: {
              tag: 'plain_text',
              content: '取消',
            },
            value: {
              bridge_action: 'delegate_cancel',
              approval_id: approval.id,
            },
          },
        ],
      },
    ],
  };
}

function confidenceRank(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
}

function shouldAutoSendDelegateReply(approval) {
  if (!config.delegateAutoReplyEnabled) return false;
  return (
    confidenceRank(approval.confidence) >=
    Math.max(1, confidenceRank(config.delegateAutoReplyMinConfidence))
  );
}

async function sendApprovalRequest(approval) {
  const card = buildApprovalCard(approval);
  try {
    await runCli([
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--user-id',
      approval.approverOpenId,
      '--msg-type',
      'interactive',
      '--content',
      JSON.stringify(card),
      '--idempotency-key',
      `delegate-card-${approval.id}`,
    ]);
    return;
  } catch (error) {
    console.error(`[bridge] failed to send approval card, falling back to text: ${error.message}`);
  }

  await runCli([
    'im',
    '+messages-send',
    '--as',
    'bot',
    '--user-id',
    approval.approverOpenId,
    '--text',
    [
      `有人 @ 你，我已拟好回复。请求 ID：${approval.id}`,
      '',
      `请求人：${approval.requesterName || approval.requesterOpenId || '未知'}`,
      `来源群：${approval.chatId}`,
      '',
      '原消息：',
      approval.requestText,
      '',
      '建议操作：',
      approval.operationPlan || '无额外操作建议',
      '',
      '将发送的回复：',
      approval.replyText,
      '',
      `同意请回复：同意发送 ${approval.id}`,
      `取消请回复：取消发送 ${approval.id}`,
    ].join('\n'),
    '--idempotency-key',
    `delegate-text-${approval.id}`,
  ]);
}

async function shouldHandleDelegateMention(event, rawText) {
  if (!config.delegateMentionEnabled) return false;
  if (!config.delegateUserOpenId && !config.delegateUserNames.length) return false;
  if (!config.delegateApproverOpenId) return false;
  if (extractChatType(event) === 'p2p') return false;
  const senderId = extractSenderId(event);
  if (senderId === config.delegateUserOpenId) return false;
  if (config.botOpenId && senderId === config.botOpenId) return false;
  if (senderId && config.loopIgnoreSenderIds.includes(senderId)) return false;
  if (isKnownBotSender(event) && !config.delegateAllowBotSenders) return false;
  if (!hasActionableDelegateText(rawText)) return false;

  if (eventMentionsDelegateUser(event) || textMentionsDelegateUser(rawText)) return true;
  if (!textHasAnyAt(rawText)) return false;
  return fetchedMessageMentionsDelegateUser(extractMessageId(event));
}

async function createDelegateDraft(event, rawText) {
  const id = shortApprovalId();
  console.error(`[bridge] delegate draft ${id} starting for message ${extractMessageId(event)}`);
  const draftOutput = await buildReply(buildDelegateDraftPrompt(event, rawText));
  console.error(`[bridge] delegate draft ${id} codex completed`);
  const draft = normalizeDraftResult(draftOutput);
  const replyText = draft.replyText || '我看到了，我稍后处理。';
  const approval = {
    id,
    status: 'pending',
    createdAt: new Date().toISOString(),
    approverOpenId: config.delegateApproverOpenId,
    chatId: extractChatId(event),
    originalMessageId: extractMessageId(event),
    requesterOpenId: extractSenderId(event),
    requesterSenderType: extractSenderType(event),
    requesterName: extractSenderName(event),
    requestText: rawText,
    operationPlan: draft.operationPlan,
    replyText,
    evidence: draft.evidence,
    confidence: draft.confidence,
    rawDraft: draft.raw,
  };
  saveApproval(approval);
  console.error(`[bridge] delegate draft ${id} saved`);
  if (shouldAutoSendDelegateReply(approval)) {
    const sent = await sendApprovedReply(approval);
    updateApproval(id, {
      status: 'sent',
      decidedAt: new Date().toISOString(),
      decidedBy: 'auto',
      autoSent: true,
      sentMessageId: sent.messageId || '',
      sentThreadId: sent.threadId || '',
      sentInThread: config.delegateReplyInThread,
    });
    console.error(`[bridge] delegate draft ${id} auto sent`);
    return;
  }
  await sendApprovalRequest(approval);
  console.error(`[bridge] delegate draft ${id} approval request sent`);
}

function parseApprovalCommand(rawText) {
  const text = stripBridgeTraceText(stripBotMentionText(rawText)).trim();
  const match = /^(同意发送|确认发送|发送|approve|\/approve|取消发送|拒绝发送|cancel|\/cancel)\s+([A-Za-z0-9_-]+)\s*$/i.exec(
    text,
  );
  if (!match) return null;
  const verb = match[1].toLowerCase();
  return {
    action:
      verb === '取消发送' || verb === '拒绝发送' || verb === 'cancel' || verb === '/cancel'
        ? 'cancel'
        : 'approve',
    id: match[2],
  };
}

async function sendApprovedReply(approval) {
  const requesterMention = isMentionableUserOpenId(approval.requesterOpenId)
    ? `<at user_id="${approval.requesterOpenId}">${approval.requesterName || '你'}</at> `
    : '';
  const text = `${requesterMention}${approval.replyText}`.trim();
  const stdout = await runCli([
    'im',
    '+messages-reply',
    '--as',
    'bot',
    '--message-id',
    approval.originalMessageId,
    '--text',
    text,
    ...(config.delegateReplyInThread ? ['--reply-in-thread'] : []),
    '--idempotency-key',
    `delegate-approved-${approval.id}`,
  ]);
  const payload = tryJsonLoose(stdout) || {};
  return {
    messageId: payload?.data?.message_id || payload?.message_id || '',
    threadId: payload?.data?.thread_id || payload?.thread_id || '',
  };
}

async function handleApprovalDecision(command, operatorOpenId, respond) {
  if (!operatorOpenId || operatorOpenId !== config.delegateApproverOpenId) {
    await respond('这个确认只能由被代理用户本人操作。');
    return;
  }

  const approval = getApproval(command.id);
  if (!approval) {
    await respond(`没有找到待确认请求：${command.id}`);
    return;
  }
  if (approval.status !== 'pending') {
    await respond(`请求 ${command.id} 已经是 ${approval.status} 状态，不会重复发送。`);
    return;
  }

  if (command.action === 'cancel') {
    updateApproval(command.id, {
      status: 'cancelled',
      decidedAt: new Date().toISOString(),
      decidedBy: operatorOpenId,
    });
    await respond(`已取消发送：${command.id}`);
    return;
  }

  const sent = await sendApprovedReply(approval);
  updateApproval(command.id, {
    status: 'sent',
    decidedAt: new Date().toISOString(),
    decidedBy: operatorOpenId,
    sentMessageId: sent.messageId || '',
    sentThreadId: sent.threadId || '',
    sentInThread: config.delegateReplyInThread,
  });
  await respond(
    config.delegateReplyInThread
      ? `已发送到原消息话题：${command.id}`
      : `已发送到原群并回复原消息：${command.id}`,
  );
}

function isCardActionEvent(event) {
  return extractEventType(event).includes('card.action');
}

function extractCardActionValue(event) {
  const candidates = [
    event?.event?.action?.value,
    event?.action?.value,
    event?.event?.action,
    event?.action,
    event?.value,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') {
      const parsed = tryJson(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } else if (typeof candidate === 'object') {
      return candidate;
    }
  }
  return {};
}

function extractCardOperatorOpenId(event) {
  const candidates = [
    event?.event?.operator?.open_id,
    event?.event?.operator?.openId,
    event?.event?.operator?.user_id?.open_id,
    event?.event?.operator?.userId?.openId,
    event?.operator?.open_id,
    event?.operator?.openId,
    event?.operator_open_id,
    event?.operatorOpenId,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}

async function handleCardActionEvent(event) {
  const value = extractCardActionValue(event);
  const action = value.bridge_action;
  if (action === 'session_generate_link') {
    await handleSessionGenerateLinkAction(event, value);
    return;
  }

  const id = value.approval_id;
  if (!id || !['delegate_approve', 'delegate_cancel'].includes(action)) return;

  await handleApprovalDecision(
    {
      id,
      action: action === 'delegate_cancel' ? 'cancel' : 'approve',
    },
    extractCardOperatorOpenId(event),
    async message => {
      if (config.delegateApproverOpenId) {
        await runCli([
          'im',
          '+messages-send',
          '--as',
          'bot',
          '--user-id',
          config.delegateApproverOpenId,
          '--text',
          message,
          '--idempotency-key',
          `delegate-action-${id}-${action}`,
        ]);
      }
    },
  );
}

function parseMessageTimeMs(message) {
  const raw = message?.create_time || message?.createTime || message?.timestamp || '';
  if (!raw) return 0;
  if (/^\d+$/.test(String(raw))) {
    const numeric = Number(raw);
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(raw).replace(' ', 'T'));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function listedMessageToEvent(chatId, message) {
  const sender = message?.sender || {};
  const senderId = sender.id || sender.open_id || sender.openId || '';
  return {
    type: 'poll.delegate_mention',
    message_id: message?.message_id || '',
    id: message?.message_id || '',
    chat_id: message?.chat_id || chatId,
    chat_type: message?.chat_type || 'group',
    content: message?.content || '',
    sender_id: senderId,
    sender_type: sender.sender_type || '',
    sender_name: sender.name || '',
    mentions: message?.mentions || [],
  };
}

async function pollDelegateMentionsInChat(chatId) {
  const stdout = await runCli(
    [
      'im',
      '+chat-messages-list',
      '--as',
      'user',
      '--chat-id',
      chatId,
      '--page-size',
      String(config.delegatePollPageSize),
      '--format',
      'json',
    ],
    '',
    { timeoutMs: Math.min(config.codexTimeoutMs, 60_000) },
  );
  const payload = tryJsonLoose(stdout) || {};
  const messages = payload?.data?.messages || payload?.messages || [];
  const now = Date.now();

  for (const message of [...messages].reverse()) {
    const messageId = message?.message_id || '';
    if (!messageId || seenMessages.has(messageId) || approvalExistsForMessage(messageId)) continue;

    const event = listedMessageToEvent(chatId, message);
    const rawText = extractText(event).trim();
    if (!rawText) continue;

    const createdAt = parseMessageTimeMs(message);
    if (createdAt && now - createdAt > config.delegatePollMaxAgeMs) continue;

    if (!(await shouldHandleDelegateMention(event, rawText))) continue;

    seenMessages.add(messageId);
    console.error(`[bridge] delegate poll matched message ${messageId} in ${chatId}`);
    try {
      await reactToLarkMessage(event, rawText);
      console.error(`[bridge] delegate poll reacted to message ${messageId}`);
    } catch (error) {
      console.error(`[bridge] failed to add reaction for polled message: ${error.message}`);
    }
    await createDelegateDraft(event, rawText);
  }
}

function startDelegatePolling() {
  if (!config.delegatePollEnabled || !config.delegateWatchChatIds.length) return null;

  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      for (const chatId of config.delegateWatchChatIds) {
        try {
          await pollDelegateMentionsInChat(chatId);
        } catch (error) {
          console.error(`[bridge] delegate poll failed for ${chatId}: ${error.stack || error.message}`);
        }
      }
    } catch (error) {
      console.error(`[bridge] delegate poll failed: ${error.stack || error.message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(poll, config.delegatePollIntervalMs);
  timer.unref();
  poll();
  console.error(
    `[bridge] delegate polling enabled, chats=${config.delegateWatchChatIds.join(',')}, interval=${config.delegatePollIntervalMs}ms`,
  );
  return timer;
}

async function getServiceJwt() {
  requireEnv('SERVICE_JWT_ENDPOINT', config.jwtEndpoint);
  requireEnv('SERVICE_ACCOUNT_SECRET', config.serviceAccountSecret);
  const response = await fetch(config.jwtEndpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.serviceAccountSecret}`,
    },
  });
  const token = response.headers.get('x-jwt-token');
  if (!response.ok || !token) {
    const body = await response.text().catch(() => '');
    throw new Error(`failed to get service JWT: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  return token;
}

async function callAgentGateway(prompt) {
  requireEnv('AGENT_GATEWAY_URL', config.agentGatewayUrl);
  requireEnv('AGENT_GATEWAY_TARGET', config.agentGatewayTarget);
  const jwt = await getServiceJwt();
  const response = await fetch(config.agentGatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-JWT-TOKEN': jwt,
      'x-agent-target': config.agentGatewayTarget,
    },
    body: JSON.stringify({
      model: '',
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`agent gateway call failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  const json = tryJson(text);
  return (
    json?.choices?.[0]?.message?.content ||
    json?.choices?.[0]?.delta?.content ||
    json?.content ||
    text
  );
}

async function callServiceApi(prompt) {
  requireEnv('SERVICE_API_URL', config.serviceApiUrl);
  const jwt = await getServiceJwt();
  const method = config.serviceApiMethod.toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    'X-JWT-TOKEN': jwt,
    'x-bridge-user-prompt': prompt.slice(0, 512),
  };
  const response = await fetch(config.serviceApiUrl, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : config.serviceApiBody || '{}',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`service API call failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  return text.length > 3500 ? `${text.slice(0, 3500)}\n...` : text;
}

function runProcess(command, args, options = {}) {
  const {
    stdin = '',
    timeoutMs = 0,
    cwd = process.cwd(),
    onStdoutChunk = null,
    onStderrChunk = null,
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout = null;

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeout.unref();
    }

    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (onStdoutChunk) onStdoutChunk(text);
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (onStderrChunk) onStderrChunk(text);
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
      }
    });
    child.stdin.end(stdin);
  });
}

async function callCodex(prompt, options = {}) {
  const { progress = null } = options;
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
      config.codexCwd,
      '--sandbox',
      config.codexSandbox,
      '--output-last-message',
      outputFile,
      '--color',
      'never',
    );
    if (config.codexModel) args.push('--model', config.codexModel);
    if (progress) args.push('--json');
    if (config.codexEphemeral) args.push('--ephemeral');
    args.push('-');
  }

  try {
    const onStdoutChunk = progress ? createCodexProgressLineHandler(progress) : null;
    const { stdout } = await runProcess(config.codexBin, args, {
      stdin: fullPrompt,
      timeoutMs: config.codexTimeoutMs,
      cwd: config.codexCwd,
      onStdoutChunk,
    });
    const finalMessage = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : stdout;
    return clampReply(finalMessage || stdout || 'Codex 执行完成，但没有返回文本。');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function buildReply(prompt, options = {}) {
  if (config.mode === 'jwt-check') {
    await getServiceJwt();
    return '服务账号 JWT 获取成功，飞书机器人到服务账号这条链路是通的。';
  }
  if (config.mode === 'agent') return callAgentGateway(prompt);
  if (config.mode === 'api') return callServiceApi(prompt);
  if (config.mode === 'codex') return callCodex(prompt, options);
  throw new Error(`Unsupported BRIDGE_MODE: ${config.mode}`);
}

function runCli(args, stdin = '', options = {}) {
  return runProcess(config.larkCliBin, args, { stdin, ...options }).then(({ stdout }) => stdout);
}

function jsonResponse(response, statusCode, body) {
  const text = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  response.end(text);
}

function textResponse(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  response.end(text);
}

function isAuthorized(request) {
  if (!config.httpToken) return true;
  return request.headers.authorization === `Bearer ${config.httpToken}`;
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (body.length > 512 * 1024) throw new Error('request body is too large');
  }
  if (!body.trim()) return {};
  const parsed = tryJson(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return parsed;
}

function openApiSpec(request) {
  const host = request.headers.host || `${config.httpHost}:${config.httpPort}`;
  return {
    openapi: '3.0.0',
    info: {
      title: 'Lark Codex Bridge',
      version: '1.0.0',
      description: 'Invoke local Codex through the bridge used by the Lark bot.',
    },
    servers: [{ url: `http://${host}` }],
    paths: {
      '/healthz': {
        get: {
          operationId: 'healthz',
          summary: 'Check bridge health',
          responses: {
            200: {
              description: 'Bridge status',
            },
          },
        },
      },
      '/v1/codex/tasks': {
        post: {
          operationId: 'runCodexTask',
          summary: 'Run a Codex task',
          security: config.httpToken ? [{ bearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    prompt: {
                      type: 'string',
                      description: 'The user request to run with Codex.',
                    },
                    source: {
                      type: 'string',
                      description: 'Optional caller label, such as an Aily agent id.',
                    },
                    trace_id: {
                      type: 'string',
                      description: 'Optional caller trace id for log correlation.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Codex result',
            },
            400: {
              description: 'Bad request',
            },
            401: {
              description: 'Unauthorized',
            },
            500: {
              description: 'Codex execution failed',
            },
          },
        },
      },
    },
    components: config.httpToken
      ? {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
            },
          },
        }
      : {},
  };
}

function serveSessionSharePage(url, response) {
  const match = /^\/(?:v1\/codex\/)?session-shares\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (!match) return false;

  const shareId = match[1];
  const file = join(config.sessionShareStoreDir, `${shareId}.html`);
  if (!existsSync(file)) {
    textResponse(response, 404, 'session share not found');
    return true;
  }

  textResponse(response, 200, enhanceSessionShareHtml(readFileSync(file, 'utf8')), 'text/html; charset=utf-8');
  return true;
}

async function handleHttpRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/healthz') {
    jsonResponse(response, 200, {
      ok: true,
      mode: config.mode,
      event_enabled: config.eventEnabled,
      codex_cwd: config.codexCwd,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/openapi.json') {
    jsonResponse(response, 200, openApiSpec(request));
    return;
  }

  if (request.method === 'GET' && serveSessionSharePage(url, response)) {
    return;
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/codex/tasks') {
    jsonResponse(response, 404, { ok: false, error: 'not found' });
    return;
  }

  if (!isAuthorized(request)) {
    jsonResponse(response, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      jsonResponse(response, 400, { ok: false, error: 'missing prompt' });
      return;
    }

    const source = String(body.source || '').trim();
    const traceId = String(body.trace_id || randomUUID()).trim();
    const contextualPrompt = [
      source ? `调用来源：${source}` : '',
      `trace_id：${traceId}`,
      prompt,
    ]
      .filter(Boolean)
      .join('\n\n');
    const answer = await buildReply(contextualPrompt);
    jsonResponse(response, 200, {
      ok: true,
      trace_id: traceId,
      answer,
    });
  } catch (error) {
    console.error(`[bridge-http] ${error.stack || error.message}`);
    jsonResponse(response, 500, { ok: false, error: clampReply(error.message || error) });
  }
}

function startHttpServer() {
  if (!config.httpPort) return null;
  const server = createServer((request, response) => {
    handleHttpRequest(request, response).catch(error => {
      console.error(`[bridge-http] ${error.stack || error.message}`);
      if (!response.headersSent) {
        jsonResponse(response, 500, { ok: false, error: 'internal server error' });
      } else {
        response.end();
      }
    });
  });
  server.listen(config.httpPort, config.httpHost, () => {
    console.error(
      `[bridge-http] listening on http://${config.httpHost}:${config.httpPort}, token=${config.httpToken ? 'required' : 'disabled'}`,
    );
  });
  return server;
}

function isPlaceholder(value) {
  return /^(?:ou_xxx|oc_xxx|\/path\/to\/workspace|Codex Bot)$/i.test(String(value || '').trim());
}

function checkCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
  });
  if (result.error?.code === 'ENOENT') {
    return {
      ok: false,
      detail: 'not found on PATH',
    };
  }
  if (result.error) {
    return {
      ok: false,
      detail: result.error.message,
    };
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return {
    ok: true,
    detail: output.split(/\r?\n/)[0] || 'found',
  };
}

function runDoctor() {
  let failures = 0;
  let warnings = 0;

  const report = (level, message) => {
    const marker = level === 'ok' ? 'OK' : level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${message}`);
    if (level === 'warn') warnings += 1;
    if (level === 'fail') failures += 1;
  };

  console.log(`Lark Codex Bridge doctor (${packageInfo().version})`);
  console.log('');

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  report(nodeMajor >= 20 ? 'ok' : 'fail', `Node.js ${process.version}${nodeMajor >= 20 ? '' : ' (requires >=20)'}`);

  if (loadedEnvInfo.loaded) {
    report('ok', `Loaded ${loadedEnvInfo.count} value(s) from ${loadedEnvInfo.path}`);
  } else {
    report('warn', `No .env file loaded at ${loadedEnvInfo.path}; using shell environment only`);
  }

  if (config.mode === 'codex') {
    const codex = checkCommand(config.codexBin);
    report(codex.ok ? 'ok' : 'fail', `Codex CLI (${config.codexBin}): ${codex.detail}`);
  }

  if (config.eventEnabled || config.mode !== 'codex') {
    const larkCli = checkCommand(config.larkCliBin);
    report(larkCli.ok ? 'ok' : 'fail', `lark-cli (${config.larkCliBin}): ${larkCli.detail}`);
  }

  if (!existsSync(config.codexCwd)) {
    report('fail', `CODEX_CWD does not exist: ${config.codexCwd}`);
  } else if (isPlaceholder(config.codexCwd)) {
    report('warn', `CODEX_CWD still looks like a template value: ${config.codexCwd}`);
  } else {
    report('ok', `CODEX_CWD exists: ${config.codexCwd}`);
  }

  if (config.eventEnabled) {
    if (!config.botOpenId || isPlaceholder(config.botOpenId)) {
      report('warn', 'BOT_OPEN_ID is empty or still a template value; group @ detection may be unreliable');
    } else {
      report('ok', 'BOT_OPEN_ID is configured');
    }

    if (!config.botMentionNames.length || config.botMentionNames.some(isPlaceholder)) {
      report('warn', 'BOT_MENTION_NAMES is empty or still a template value; text fallback @ detection may be unreliable');
    } else {
      report('ok', `BOT_MENTION_NAMES configured: ${config.botMentionNames.join(', ')}`);
    }

    if (config.progressCardEnabled && !config.larkEventTypes.includes('card.action.trigger')) {
      report('warn', 'PROGRESS_CARD_ENABLED=1 but LARK_EVENT_TYPES does not include card.action.trigger');
    }
  }

  if (!config.eventEnabled && !config.httpPort) {
    report('fail', 'BRIDGE_EVENT_ENABLED=0 requires BRIDGE_HTTP_PORT');
  }

  if (config.httpPort) {
    report('ok', `HTTP server configured on ${config.httpHost}:${config.httpPort}`);
    const hostLooksPublic = !['127.0.0.1', 'localhost', '::1'].includes(config.httpHost);
    if (hostLooksPublic && !config.httpToken) {
      report('warn', 'HTTP server is not localhost-scoped and has no BRIDGE_HTTP_TOKEN');
    }
  }

  if (config.mode !== 'codex' && !['jwt-check', 'agent', 'api'].includes(config.mode)) {
    report('fail', `Unsupported BRIDGE_MODE: ${config.mode}`);
  }

  console.log('');
  if (failures) {
    console.log(`Doctor found ${failures} failure(s) and ${warnings} warning(s).`);
    process.exit(1);
  }
  console.log(`Doctor passed${warnings ? ` with ${warnings} warning(s)` : ''}.`);
}

function progressStatusMeta(status) {
  if (status === 'done') return { template: 'green', title: '分析完成' };
  if (status === 'failed') return { template: 'red', title: '分析失败' };
  return { template: 'blue', title: '正在分析' };
}

function closeUnclosedCodeFence(text) {
  const fenceCount = (text.match(/```/g) || []).length;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function cardMarkdownElement(content, maxLength = 2400) {
  const markdown = clampCardText(redactForCard(content), maxLength);
  return {
    tag: 'markdown',
    content: closeUnclosedCodeFence(markdown),
    text_size: 'normal',
  };
}

function buildProgressCard(state) {
  const meta = progressStatusMeta(state.status);
  const startedAt = state.startedAt ? formatLocalTime(state.startedAt) : '未知';
  const updatedAt = formatLocalTime();
  const elapsedSeconds = state.startedAt
    ? Math.max(0, Math.round((Date.now() - state.startedAt.getTime()) / 1000))
    : 0;
  const request = clampCardText(redactForCard(state.prompt || '无'), 650);
  const items = state.items.slice(-config.progressCardMaxItems);
  const progressText = items.length
    ? items
        .map((item, index) => `${index + 1}. ${clampCardText(redactForCard(item), 260)}`)
        .join('\n')
    : '已收到请求，正在启动 Codex。';
  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**请求**\n${request}`,
      },
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**状态**：${meta.title}\n**开始**：${startedAt}\n**耗时**：${elapsedSeconds}s`,
      },
    },
  ];

  if (state.finalText) {
    elements.push({
      tag: 'hr',
    });
    elements.push(cardMarkdownElement(`**结果摘要**\n\n${state.finalText}`));
  } else if (state.errorText) {
    elements.push({
      tag: 'hr',
    });
    elements.push(cardMarkdownElement(`**错误**\n\n${state.errorText}`, 1400));
  } else {
    elements.push({
      tag: 'hr',
    });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**过程**\n${progressText}`,
      },
    });
  }

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `最后更新：${updatedAt}`,
      },
    ],
  });

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: meta.template,
      title: {
        tag: 'plain_text',
        content: meta.title,
      },
    },
    elements,
  };
}

function extractSentMessageId(stdout) {
  const sent = tryJsonLoose(stdout) || {};
  return sent?.data?.message_id || sent?.message_id || '';
}

async function sendCardToLark(event, card, idempotencyKey) {
  const messageId = extractMessageId(event);
  if (messageId) {
    const stdout = await runCli([
      'im',
      '+messages-reply',
      '--as',
      'bot',
      '--message-id',
      messageId,
      '--msg-type',
      'interactive',
      '--content',
      JSON.stringify(card),
      '--idempotency-key',
      idempotencyKey,
    ]);
    return extractSentMessageId(stdout);
  }

  const chatId = extractChatId(event);
  if (!chatId) throw new Error('event has neither message_id nor chat_id');
  const stdout = await runCli([
    'im',
    '+messages-send',
    '--as',
    'bot',
    '--chat-id',
    chatId,
    '--msg-type',
    'interactive',
    '--content',
    JSON.stringify(card),
    '--idempotency-key',
    idempotencyKey,
  ]);
  return extractSentMessageId(stdout);
}

async function updateCardMessage(cardMessageId, card) {
  if (!cardMessageId) return;
  await runCli([
    'api',
    'PATCH',
    `/open-apis/im/v1/messages/${cardMessageId}`,
    '--as',
    'bot',
    '--data',
    JSON.stringify({ content: JSON.stringify(card) }),
  ]);
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

function parseCodexProgressLine(line) {
  const parsed = tryJson(line);
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

function createCodexProgressLineHandler(progress) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index === -1) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      const message = parseCodexProgressLine(line);
      if (message) progress.add(message);
    }
  };
}

async function createProgressReporter(event, prompt) {
  if (!config.progressCardEnabled || config.mode !== 'codex') return null;
  const state = {
    status: 'running',
    prompt,
    startedAt: new Date(),
    items: ['已收到请求，正在启动 Codex。'],
    finalText: '',
    errorText: '',
  };
  const reporter = {
    messageId: '',
    updateDisabled: false,
    updateQueue: Promise.resolve(),
    lastUpdateAt: 0,
    async start() {
      try {
        this.messageId = await sendCardToLark(
          event,
          buildProgressCard(state),
          `progress-card-${extractMessageId(event) || randomUUID()}`,
        );
        if (!this.messageId) {
          this.updateDisabled = true;
          console.error('[bridge] progress card sent but no message_id was returned; updates disabled');
        }
      } catch (error) {
        this.updateDisabled = true;
        console.error(`[bridge] failed to send progress card: ${error.stack || error.message}`);
      }
    },
    add(item) {
      const text = clampText(redactForCard(item), 500);
      if (!text) return;
      if (state.items[state.items.length - 1] === text) return;
      state.items.push(text);
      if (state.items.length > config.progressCardMaxItems * 2) {
        state.items = state.items.slice(-config.progressCardMaxItems * 2);
      }
      this.scheduleUpdate(false);
    },
    scheduleUpdate(force) {
      if (this.updateDisabled || !this.messageId) return;
      const now = Date.now();
      if (!force && now - this.lastUpdateAt < config.progressCardUpdateIntervalMs) return;
      this.lastUpdateAt = now;
      this.updateQueue = this.updateQueue
        .then(() => updateCardMessage(this.messageId, buildProgressCard(state)))
        .catch(error => {
          this.updateDisabled = true;
          console.error(`[bridge] failed to update progress card: ${error.stack || error.message}`);
        });
    },
    async finish(finalText) {
      state.status = 'done';
      state.finalText = finalText;
      this.scheduleUpdate(true);
      await this.updateQueue;
    },
    async fail(errorText) {
      state.status = 'failed';
      state.errorText = errorText;
      this.scheduleUpdate(true);
      await this.updateQueue;
    },
  };

  await reporter.start();
  return reporter.updateDisabled ? null : reporter;
}

async function replyToLark(event, text) {
  const messageId = extractMessageId(event);
  if (messageId) {
    await runCli([
      'im',
      '+messages-reply',
      '--as',
      'bot',
      '--message-id',
      messageId,
      '--text',
      text,
      '--idempotency-key',
      `bridge-${messageId}`,
    ]);
    return;
  }

  const chatId = extractChatId(event);
  if (!chatId) throw new Error('event has neither message_id nor chat_id');
  await runCli([
    'im',
    '+messages-send',
    '--as',
    'bot',
    '--chat-id',
    chatId,
    '--text',
    text,
    '--idempotency-key',
    `bridge-${randomUUID()}`,
  ]);
}

function reactionRuleMatches(rule, text) {
  if (rule.contains.length) {
    const haystack = rule.caseSensitive ? text : text.toLowerCase();
    if (
      rule.contains.some(item => {
        const needle = rule.caseSensitive ? item : item.toLowerCase();
        return haystack.includes(needle);
      })
    ) {
      return true;
    }
  }

  if (!rule.pattern) return false;
  try {
    return new RegExp(rule.pattern, rule.flags).test(text);
  } catch (error) {
    console.error(`[bridge] invalid reaction rule #${rule.index}: ${error.message}`);
    return false;
  }
}

function pickReactionEmoji(text) {
  const rawText = String(text || '');
  const matchedRule = config.reactionOnReceiveRules.find(rule =>
    reactionRuleMatches(rule, rawText),
  );
  return matchedRule?.emoji || config.reactionOnReceive;
}

async function reactToLarkMessage(event, rawText) {
  const emoji = pickReactionEmoji(rawText);
  if (!emoji) return;
  const messageId = extractMessageId(event);
  if (!messageId) return;

  await runCli([
    'im',
    'reactions',
    'create',
    '--as',
    'bot',
    '--params',
    JSON.stringify({ message_id: messageId }),
    '--data',
    JSON.stringify({ reaction_type: { emoji_type: emoji } }),
  ]);
}

async function handleEvent(event) {
  if (isCardActionEvent(event)) {
    await handleCardActionEvent(event);
    return;
  }

  const messageId = extractMessageId(event);
  const eventId = extractEventId(event);
  const dedupeId = messageId || eventId;
  if (dedupeId) {
    if (seenMessages.has(dedupeId)) return;
    seenMessages.add(dedupeId);
  }

  const rawText = extractText(event).trim();
  if (!rawText) return;
  const skipReason = shouldSkipSender(event, rawText);
  if (skipReason) {
    if (config.debug && messageId) {
      console.error(`[bridge] skipped message ${messageId}: ${skipReason}`);
    }
    return;
  }
  if (config.prefix && !rawText.startsWith(config.prefix)) return;

  const approvalCommand = parseApprovalCommand(rawText);
  if (approvalCommand && extractChatType(event) === 'p2p') {
    await handleApprovalDecision(approvalCommand, extractSenderId(event), async message => {
      await replyToLark(event, message);
    });
    return;
  }

  if (await shouldHandleDelegateMention(event, rawText)) {
    try {
      await reactToLarkMessage(event, rawText);
    } catch (error) {
      console.error(`[bridge] failed to add reaction: ${error.stack || error.message}`);
    }
    try {
      await createDelegateDraft(event, rawText);
    } catch (error) {
      console.error(`[bridge] delegate draft failed: ${error.stack || error.message}`);
      if (config.delegateApproverOpenId) {
        await runCli([
          'im',
          '+messages-send',
          '--as',
          'bot',
          '--user-id',
          config.delegateApproverOpenId,
          '--text',
          `处理群内 @ 代理失败：${clampReply(error.message || error)}`,
          '--idempotency-key',
          `delegate-error-${messageId || randomUUID()}`,
        ]);
      }
    }
    return;
  }

  if (!(await shouldHandleEvent(event, rawText))) {
    if (config.debug && messageId) {
      console.error(`[bridge] skipped non-mention group message: ${messageId}`);
    }
    return;
  }

  let botSendCommand = null;
  let sessionShareCommand = null;
  try {
    botSendCommand = parseBotSendCommand(rawText, event);
    sessionShareCommand = parseSessionShareCommand(rawText);
  } catch (error) {
    await replyToLark(event, `解析命令失败：${clampReply(error.message || error)}`);
    return;
  }

  try {
    await reactToLarkMessage(event, rawText);
  } catch (error) {
    console.error(`[bridge] failed to add reaction: ${error.stack || error.message}`);
  }

  if (botSendCommand) {
    try {
      const confirmation = await sendBotMessage(botSendCommand);
      await replyToLark(event, confirmation);
    } catch (error) {
      console.error(`[bridge] ${error.stack || error.message}`);
      await replyToLark(event, `发送给机器人失败：${clampReply(error.message || error)}`);
    }
    return;
  }

  if (sessionShareCommand) {
    try {
      await handleSessionShareCommand(event, sessionShareCommand);
    } catch (error) {
      console.error(`[bridge] ${error.stack || error.message}`);
      await replyToLark(event, `导出 Codex session 快照失败：${clampReply(error.message || error)}`);
    }
    return;
  }

  const trace = extractBridgeTrace(rawText);
  const promptBase = config.prefix ? rawText.slice(config.prefix.length).trim() : rawText;
  const prompt = stripBotMentionText(stripBridgeTraceText(promptBase));
  const eventContext = [
    '飞书事件上下文：',
    `chat_id=${extractChatId(event) || 'unknown'}`,
    `chat_type=${extractChatType(event) || 'unknown'}`,
    `message_id=${messageId || 'unknown'}`,
    `sender_id=${extractSenderId(event) || 'unknown'}`,
    `sender_type=${extractSenderType(event) || 'unknown'}`,
  ].join('\n');
  const codexPrompt = `${eventContext}\n\n${prompt || stripBridgeTraceText(rawText)}`;
  const progress = await createProgressReporter(event, prompt || stripBridgeTraceText(rawText));
  try {
    const reply = await buildReply(codexPrompt, { progress });
    if (progress) await progress.finish(reply);
    if (config.progressCardFinalReply || !progress) {
      await replyToLark(event, trace ? appendBridgeTrace(reply, nextTrace(trace)) : reply);
    }
  } catch (error) {
    console.error(`[bridge] ${error.stack || error.message}`);
    if (progress) await progress.fail(error.message || error);
    await replyToLark(event, `执行失败：${clampReply(error.message || error)}`);
  }
}

function startEventSubscription() {
  console.error(`[bridge] subscribing, mode=${config.mode}, eventTypes=${config.larkEventTypes}`);
  const sub = spawn(
    config.larkCliBin,
    [
      'event',
      '+subscribe',
      '--as',
      'bot',
      '--event-types',
      config.larkEventTypes,
      '--compact',
      '--quiet',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], env },
  );

  sub.stdout.on(
    'data',
    appendLineBuffer(async line => {
      try {
        const event = JSON.parse(line);
        await handleEvent(event);
      } catch (error) {
        console.error(`[bridge] ${error.stack || error.message}`);
      }
    }),
  );
  sub.on('exit', code => {
    console.error(`[bridge] lark-cli event subscription exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return sub;
}

function main() {
  if (cli.command === 'doctor') {
    runDoctor();
    return;
  }

  console.error(
    `[bridge] starting, mode=${config.mode}, eventEnabled=${config.eventEnabled}, httpPort=${config.httpPort || 'off'}`,
  );
  startHttpServer();
  startDelegatePolling();
  if (config.eventEnabled) {
    startEventSubscription();
    return;
  }
  if (!config.httpPort) {
    throw new Error('BRIDGE_EVENT_ENABLED=0 requires BRIDGE_HTTP_PORT');
  }
}

main();
