#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findClaudeSession,
  parseClaudeSessionTranscript,
} from './src/claude-session.mjs';
import {
  envFlag as readEnvFlag,
  parseReactionRules,
  splitCsv,
} from './src/env.mjs';
import {
  createNonOwnerCodexExecutionContext,
  nonOwnerGuardNotice,
  normalizeNonOwnerSandboxMode,
  normalizeSandboxMode,
} from './src/codex-runner.mjs';
import { normalizeCodexRuntime } from './src/codex-app-server.mjs';
import {
  conversationKeyForEvent,
  createContextQueueRuntime,
  createStopRegistry,
  isStopCommand,
  parseQueueCommand,
} from './src/context-queue.mjs';
import { closeUnclosedCodeFence } from './src/lark-format.mjs';
import { createPetEventBus } from './src/pet-event-bus.mjs';
import {
  appendJsonl,
  appendMemoryCandidate,
  appendThreadExchange,
  approveMemoryCandidates,
  compactMemoryRoute,
  memoryPaths,
  readMemoryCandidates,
  readTextFile,
  rejectMemoryCandidates,
  writeTextFile,
} from './src/memory-store.mjs';
import { extractMemoryCandidates } from './src/memory-extractor.mjs';
import {
  canWriteMemory,
  parseMemoryCommand,
  shouldAutoWriteThreadSummary,
} from './src/memory-policy.mjs';
import { buildMemoryPromptContext } from './src/memory-prompt.mjs';
import {
  readVisibleMemoryBundle,
  resolveMemoryRoute,
} from './src/memory-router.mjs';
import {
  checkCodexAppServerSteerSupport,
  formatHealthReport,
  formatOpsHelp,
  formatVersionReport,
  parseOpsCommand,
} from './src/ops-policy.mjs';
import {
  clearOncallBinding,
  getOncallBinding,
  normalizeOncallPath,
  parseOncallCommand,
  readOncallBindings,
  setOncallBinding,
  writeOncallBindings,
} from './src/oncall-policy.mjs';
import { runProcess } from './src/process-manager.mjs';
import {
  evaluateProfilePolicy,
  isProfileOwner,
  loadProfilePolicy,
} from './src/profile-policy.mjs';
import {
  createRunner,
  normalizeRunnerId,
  SUPPORTED_RUNNERS,
} from './src/runners/index.mjs';
import {
  canDirectReviewAutomation,
  extractCodebaseMrUrls,
  shouldTriggerReviewAutomation,
} from './src/review-automation-policy.mjs';
import { renderSessionMarkdownBlockHtml } from './src/session-markdown.mjs';
import {
  classifyDirectExecution,
  isReviewAutomationOnlySensitive,
} from './src/sensitive-policy.mjs';
import {
  isKnownBotSender as isKnownBotSenderPolicy,
  shouldSkipSenderPolicy,
} from './src/sender-policy.mjs';

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

function loadEnvFile(envFile, { explicit = false } = {}) {
  if (!existsSync(envFile)) {
    if (explicit) throw new Error(`Environment file does not exist: ${envFile}`);
    return { loaded: false, path: envFile, count: 0 };
  }
  const content = readFileSync(envFile, 'utf8');
  let count = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    count += 1;
  }
  return { loaded: true, path: envFile, count };
}

function createEnvFile(envFile, { force = false } = {}) {
  if (existsSync(envFile) && !force) {
    throw new Error(`${envFile} already exists. Use --force to overwrite.`);
  }
  copyFileSync(join(packageDir, '.env.example'), envFile);
  console.log(`Created ${envFile}`);
  console.log('Edit it, then run: lark-codex-bridge doctor');
}

const cli = parseCliArgs(process.argv.slice(2));

if (cli.errors.length) {
  for (const error of cli.errors) console.error(error);
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
const defaultClaudeHome = env.CLAUDE_HOME || join(homedir(), '.claude');

function parseAliasOpenIdMap(value) {
  const text = String(value || '').trim();
  if (!text) return new Map();

  const parsed = tryJson(text);
  const entries = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    entries.push(...Object.entries(parsed));
  } else {
    for (const item of splitCsv(text)) {
      const match = /^([^=:]+)\s*[:=]\s*(ou_[A-Za-z0-9_-]+)$/.exec(item);
      if (match) entries.push([match[1], match[2]]);
    }
  }

  const result = new Map();
  for (const [alias, openId] of entries) {
    const key = String(alias || '').trim();
    const valueOpenId = String(openId || '').trim();
    if (key && valueOpenId.startsWith('ou_')) result.set(key, valueOpenId);
  }
  return result;
}

function parseAliasAppIdMap(value) {
  const text = String(value || '').trim();
  if (!text) return new Map();

  const parsed = tryJson(text);
  const entries = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    entries.push(...Object.entries(parsed));
  } else {
    for (const item of splitCsv(text)) {
      const match = /^([^=:]+)\s*[:=]\s*(cli_[A-Za-z0-9_-]+)$/.exec(item);
      if (match) entries.push([match[1], match[2]]);
    }
  }

  const result = new Map();
  for (const [alias, appId] of entries) {
    const key = String(alias || '').trim();
    const valueAppId = String(appId || '').trim();
    if (key && valueAppId.startsWith('cli_')) result.set(key, valueAppId);
  }
  return result;
}

function envFlag(name, defaultValue = false) {
  return readEnvFlag(env, name, defaultValue);
}

function readSecretFromEnv() {
  if (env.SERVICE_ACCOUNT_SECRET) return env.SERVICE_ACCOUNT_SECRET;
  if (env.BYTECLOUD_SA_SECRET) return env.BYTECLOUD_SA_SECRET;
  const file = env.SERVICE_ACCOUNT_SECRET_FILE || env.BYTECLOUD_SA_SECRET_FILE;
  if (!file) return '';
  return readFileSync(file, 'utf8').trim();
}

function readOptionalSecret(value, file) {
  if (value) return value;
  if (!file) return '';
  return readFileSync(file, 'utf8').trim();
}

function expandHomePath(value) {
  const text = String(value || '');
  if (text === '~') return homedir();
  if (text.startsWith('~/')) return join(homedir(), text.slice(2));
  return text;
}

const configuredSoulsDir = expandHomePath(env.SOULS_DIR || join(homedir(), '.lark-codex-bridge', 'souls'));

const config = {
  mode: normalizeRunnerId(env.BRIDGE_BACKEND || env.BRIDGE_MODE || 'codex'),
  backend: normalizeRunnerId(env.BRIDGE_BACKEND || env.BRIDGE_MODE || 'codex'),
  debug: env.BRIDGE_DEBUG === '1',
  prefix: env.BRIDGE_PREFIX || '',
  reactionOnReceive: env.REACTION_ON_RECEIVE || '',
  reactionOnReceiveRules: parseReactionRules(env.REACTION_ON_RECEIVE_RULES),
  replyMarkdownEnabled: envFlag('BRIDGE_REPLY_MARKDOWN', true),
  requireMentionInGroup: env.REQUIRE_MENTION_IN_GROUP !== '0',
  botOpenId: env.BOT_OPEN_ID || '',
  botAppId: env.BOT_APP_ID || env.LARK_APP_ID || '',
  botMentionNames: splitCsv(env.BOT_MENTION_NAMES),
  mentionLookupTimeoutMs: Number(env.MENTION_LOOKUP_TIMEOUT_MS || 8000),
  loopAllowSenderIds: splitCsv(env.LOOP_ALLOW_SENDER_IDS),
  loopIgnoreSenderIds: splitCsv(env.LOOP_IGNORE_SENDER_IDS),
  loopBotSenderIds: splitCsv(env.LOOP_BOT_SENDER_IDS),
  loopRespondToBotSenders: envFlag('LOOP_RESPOND_TO_BOT_SENDERS', false),
  loopMaxTurns: Math.max(1, Number(env.LOOP_MAX_TURNS || 3)),
  traceMarker: env.BRIDGE_TRACE_MARKER || 'bridge_trace',
  contextQueueEnabled: envFlag('CONTEXT_QUEUE_ENABLED', true),
  oncallBindingsFile:
    expandHomePath(env.ONCALL_BINDINGS_FILE || join(homedir(), '.lark-codex-bridge', 'oncall-bindings.json')),
  profilePolicyEnabled: envFlag(
    'PROFILE_POLICY_ENABLED',
    Boolean(env.PROFILE_CONFIG_FILE || env.BRIDGE_PROFILE_CONFIG_FILE),
  ),
  profileConfigFile:
    expandHomePath(
      env.PROFILE_CONFIG_FILE ||
        env.BRIDGE_PROFILE_CONFIG_FILE ||
        join(homedir(), '.lark-codex-bridge', 'profiles.json'),
    ),
  memoryEnabled: envFlag('MEMORY_ENABLED', false),
  memoryRootDir: expandHomePath(env.MEMORY_ROOT_DIR || join(homedir(), '.lark-codex-bridge', 'memory')),
  soulsDir: configuredSoulsDir,
  baseSoulFile: expandHomePath(env.BASE_SOUL_FILE || join(configuredSoulsDir, 'base.md')),
  memoryPromptBudgetChars: Math.max(1000, Number(env.MEMORY_PROMPT_BUDGET_CHARS || 12_000)),
  memoryJsonlItemLimit: Math.max(1, Number(env.MEMORY_JSONL_ITEM_LIMIT || 8)),
  memoryDefaultProjectId: env.MEMORY_DEFAULT_PROJECT_ID || '',
  memoryAutoThreadSummary: envFlag('MEMORY_AUTO_THREAD_SUMMARY', false),
  memoryThreadMaxChars: Math.max(4000, Number(env.MEMORY_THREAD_MAX_CHARS || 20_000)),
  memoryExtractorEnabled: envFlag('MEMORY_EXTRACTOR_ENABLED', false),
  memoryPendingLimit: Math.max(1, Number(env.MEMORY_PENDING_LIMIT || 20)),
  memoryCompactMaxTextChars: Math.max(4000, Number(env.MEMORY_COMPACT_MAX_TEXT_CHARS || 20_000)),
  memoryCompactMaxJsonlRecords: Math.max(10, Number(env.MEMORY_COMPACT_MAX_JSONL_RECORDS || 100)),
  botSendCommands: splitCsv(env.BOT_SEND_COMMANDS || '/bot-send,/send-bot,发给机器人'),
  botSendInviteByAppId: envFlag('BOT_SEND_INVITE_BY_APP_ID', false),
  botSendTargetOpenIds: parseAliasOpenIdMap(env.BOT_SEND_TARGET_OPEN_IDS || ''),
  botSendTargetAppIds: parseAliasAppIdMap(env.BOT_SEND_TARGET_APP_IDS || ''),
  botSendAllowPlainTextMention: envFlag('BOT_SEND_ALLOW_PLAINTEXT_MENTION', false),
  sessionShareEnabled: envFlag('SESSION_SHARE_ENABLED', true),
  sessionShareCommands: splitCsv(
    env.SESSION_SHARE_COMMANDS ||
      '/session-share,/share-session,分享session,分享会话,导出session,导出会话,session快照,会话快照',
  ),
  codexHome: defaultCodexHome,
  codexSessionIndexFile: env.CODEX_SESSION_INDEX_FILE || join(defaultCodexHome, 'session_index.jsonl'),
  claudeHome: defaultClaudeHome,
  claudeProjectsRoot: env.CLAUDE_PROJECTS_ROOT || join(defaultClaudeHome, 'projects'),
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
  delegateReviewAutomationEnabled: envFlag('DELEGATE_REVIEW_AUTOMATION_ENABLED', false),
  delegateReviewAutoApproveEnabled: envFlag('DELEGATE_REVIEW_AUTO_APPROVE_ENABLED', false),
  delegateReviewCommentOnIssues: envFlag('DELEGATE_REVIEW_COMMENT_ON_ISSUES', true),
  delegateReviewRequireCiPass: envFlag('DELEGATE_REVIEW_REQUIRE_CI_PASS', true),
  delegateReviewReplyToGroup: envFlag('DELEGATE_REVIEW_REPLY_TO_GROUP', true),
  delegateReviewProgressCardEnabled: envFlag('DELEGATE_REVIEW_PROGRESS_CARD_ENABLED', false),
  delegateReviewKeywords: splitCsv(
    env.DELEGATE_REVIEW_KEYWORDS ||
      'review,code review,cr,代码review,代码 review,看下代码,帮忙看下,approve,给a,给 A,给一下 a,lgtm,LGTM,评审',
  ),
  reviewFollowupEnabled: envFlag('REVIEW_FOLLOWUP_ENABLED', false),
  reviewFollowupStoreFile:
    env.REVIEW_FOLLOWUP_STORE_FILE ||
    join(homedir(), '.lark-codex-bridge', 'review-followups.json'),
  reviewFollowupMaxRounds: Math.max(1, Number(env.REVIEW_FOLLOWUP_MAX_ROUNDS || 5)),
  reviewFollowupMaxAgeMs: Math.max(
    60 * 1000,
    Number(env.REVIEW_FOLLOWUP_MAX_AGE_MS || 24 * 60 * 60 * 1000),
  ),
  reviewFollowupRequesterIds: splitCsv(env.REVIEW_FOLLOWUP_REQUESTER_IDS || ''),
  reviewFollowupReviewerSenderIds: splitCsv(env.REVIEW_FOLLOWUP_REVIEWER_SENDER_IDS || ''),
  reviewFollowupProgressCardEnabled: envFlag('REVIEW_FOLLOWUP_PROGRESS_CARD_ENABLED', false),
  eventEnabled: envFlag('BRIDGE_EVENT_ENABLED', true),
  httpHost: env.BRIDGE_HTTP_HOST || '127.0.0.1',
  httpPort: Number(env.BRIDGE_HTTP_PORT || 0),
  httpToken: readOptionalSecret(env.BRIDGE_HTTP_TOKEN || '', env.BRIDGE_HTTP_TOKEN_FILE || ''),
  bridgeLogFile: env.BRIDGE_LOG_FILE || join(process.cwd(), 'logs', 'lark-codex-bridge.err.log'),
  larkCliBin: env.LARK_CLI_BIN || 'lark-cli',
  jwtEndpoint:
    env.SERVICE_JWT_ENDPOINT ||
    env.BYTECLOUD_JWT_ENDPOINT ||
    'https://cloud.bytedance.net/auth/api/v1/jwt',
  serviceAccountSecret: readSecretFromEnv(),
  larkEventTypes: env.LARK_EVENT_TYPES || 'im.message.receive_v1',
  taeAgentUrl:
    env.AGENT_GATEWAY_URL ||
    env.TAE_AGENT_URL ||
    'https://aipaas-gateway.bytedance.net/api/v1/agent/api/v3/bots/chat/completions',
  taeTargetPsm:
    env.AGENT_GATEWAY_TARGET || env.TAE_TARGET_PSM || env.TARGET_PSM || env.TARGET_SERVICE || '',
  bytecloudApiUrl: env.SERVICE_API_URL || env.BYTECLOUD_API_URL || '',
  bytecloudApiMethod: env.SERVICE_API_METHOD || env.BYTECLOUD_API_METHOD || 'GET',
  bytecloudApiBody: env.SERVICE_API_BODY || env.BYTECLOUD_API_BODY || '',
  bytedCliBin: env.BYTEDCLI_BIN || 'bytedcli',
  codexBin: env.CODEX_BIN || 'codex',
  codexCwd: env.CODEX_CWD || process.cwd(),
  codexSandbox: normalizeSandboxMode(env.CODEX_SANDBOX || 'read-only'),
  codexNonOwnerSandbox: normalizeNonOwnerSandboxMode(env.CODEX_NON_OWNER_SANDBOX),
  codexNonOwnerScratchRoot: env.CODEX_NON_OWNER_SCRATCH_ROOT || tmpdir(),
  codexModel: env.CODEX_MODEL || '',
  codexRuntime: normalizeCodexRuntime(env.CODEX_RUNTIME || env.CODEX_RUNNER || 'exec'),
  codexAppServerStartTimeoutMs: Math.max(1000, Number(env.CODEX_APP_SERVER_START_TIMEOUT_MS || 10_000)),
  codexAppServerRequestTimeoutMs: Math.max(1000, Number(env.CODEX_APP_SERVER_REQUEST_TIMEOUT_MS || 30_000)),
  codexTimeoutMs: Number(env.CODEX_TIMEOUT_MS || 10 * 60 * 1000),
  codexEphemeral: env.CODEX_EPHEMERAL !== '0',
  codexSkipGitRepoCheck: envFlag('CODEX_SKIP_GIT_REPO_CHECK', true),
  codexResume: env.CODEX_RESUME || '',
  claudeCodeBin: env.CLAUDE_CODE_BIN || env.CLAUDE_BIN || 'claude',
  claudeCodeOutputFormat: env.CLAUDE_CODE_OUTPUT_FORMAT || 'json',
  claudeCodePermissionMode: env.CLAUDE_CODE_PERMISSION_MODE || 'plan',
  claudeCodeMaxTurns: Math.max(1, Number(env.CLAUDE_CODE_MAX_TURNS || 3)),
  claudeCodeNoSessionPersistence: envFlag('CLAUDE_CODE_NO_SESSION_PERSISTENCE', true),
  claudeCodeTimeoutMs: Number(env.CLAUDE_CODE_TIMEOUT_MS || env.CODEX_TIMEOUT_MS || 10 * 60 * 1000),
  claudeCodeExtraArgs: splitCsv(env.CLAUDE_CODE_EXTRA_ARGS || ''),
  cocoRunMode: ['chat', 'task'].includes(String(env.COCO_RUN_MODE || '').trim().toLowerCase())
    ? String(env.COCO_RUN_MODE).trim().toLowerCase()
    : 'chat',
  cocoRepoId: env.COCO_REPO_ID || '',
  cocoCommitId: env.COCO_COMMIT_ID || '',
  cocoBranch: env.COCO_BRANCH || '',
  cocoMergeRequestNumber: env.COCO_MERGE_REQUEST_NUMBER || '',
  cocoTaskId: env.COCO_TASK_ID || '',
  cocoModelName: env.COCO_MODEL_NAME || '',
  cocoAgentName: env.COCO_AGENT_NAME || '',
  cocoEnvironment: env.COCO_ENVIRONMENT || '',
  cocoEnvironmentImage: env.COCO_ENVIRONMENT_IMAGE || '',
  cocoEnvironmentTtl: env.COCO_ENVIRONMENT_TTL || '',
  cocoEnvironmentVars: splitCsv(env.COCO_ENVIRONMENT_VARS || env.COCO_ENVIRONMENT_VAR || ''),
  cocoTaskWait: envFlag('COCO_TASK_WAIT', false),
  cocoTaskSubscribe: envFlag('COCO_TASK_SUBSCRIBE', true),
  cocoTimeoutMs: Number(env.COCO_TIMEOUT_MS || env.CODEX_TIMEOUT_MS || 10 * 60 * 1000),
  cocoTaskWaitTimeoutMs: Number(env.COCO_TASK_WAIT_TIMEOUT_MS || env.COCO_TIMEOUT_MS || env.CODEX_TIMEOUT_MS || 10 * 60 * 1000),
  progressCardEnabled: envFlag('PROGRESS_CARD_ENABLED', false),
  progressCardUpdateIntervalMs: Math.max(3000, Number(env.PROGRESS_CARD_UPDATE_INTERVAL_MS || 8000)),
  progressCardMaxItems: Math.max(3, Number(env.PROGRESS_CARD_MAX_ITEMS || 8)),
  progressCardFinalReply: envFlag('PROGRESS_CARD_FINAL_REPLY', false),
  codexPromptPrefix:
    env.CODEX_PROMPT_PREFIX ||
    [
      '你是通过飞书机器人被调用的 Codex。请用中文简洁回答。',
      '你可以使用本机 bytedcli 和 lark-cli 完成 ByteDance / 飞书相关查询，优先使用结构化输出，例如 bytedcli --json ... 或 lark-cli ... --format json。',
      '读取飞书群消息、历史消息、搜索消息时，优先使用 lark-cli 的 user 身份：lark-cli im +chat-messages-list --as user --chat-id <oc_xxx> 或 lark-cli im +messages-search --as user --chat-id <oc_xxx>；发送、回复、表情回复才使用 bot 身份。',
      '当用户说“本群”“群消息”“最近消息”时，优先使用飞书事件上下文里的 chat_id，不要只做全局搜索；筛选 DDL/通知类内容时要排除机器人/应用自己的历史回复，避免把权限报错或自己的总结当成结果。',
      '当你作为宋一凡的代理处理普通群内 @ 宋一凡消息时，只生成建议操作和待发送回复；不要直接向群里发送，bridge 会先发给宋一凡确认。例外：如果 bridge prompt 明确标记为“MR review 自动化”或“Reviewer 回复闭环自动化”，说明用户已配置此自动流程，可以在该 prompt 的严格条件内直接执行代码平台 review/comment/approve，或按 reviewer 反馈改代码、提交、push 并重新 @ reviewer 复审。',
      '默认只做只读查询、诊断、总结和说明。除非飞书消息明确要求创建、修改、删除、发布、审批、发消息、提交工单或改代码，否则不要执行有副作用的操作。',
      '执行任何可能有副作用的命令前，先在回复中说明将要做什么；在非交互环境不能确认时，给出待执行命令而不是擅自执行。MR review 自动化 prompt 明确允许的 review/comment/approve 操作、Reviewer 回复闭环自动化 prompt 明确允许的代码修复/提交/push/复审消息除外。',
      '不要输出 token、secret、cookie、JWT、appSecret、服务账号 ID、服务账号名称或服务账号密钥；除非用户明确要求核对身份，也只描述为“已配置的服务账号”。',
    ].join('\n'),
  petSyncEnabled: envFlag('PET_SYNC_ENABLED', false),
  petSyncMode: (env.PET_SYNC_MODE || 'safe').toLowerCase() === 'full' ? 'full' : 'safe',
  petSyncMaxMessageChars: Math.max(80, Number(env.PET_SYNC_MAX_MESSAGE_CHARS || 280)),
  petSyncMaxEventBufferSize: Math.max(10, Number(env.PET_SYNC_MAX_EVENT_BUFFER_SIZE || 100)),
};

const seenMessages = new Set();
const bridgeStartedAtMs = Date.now();

const petBus = config.petSyncEnabled
  ? createPetEventBus({ maxBuffer: config.petSyncMaxEventBufferSize })
  : null;

// Mirror one piece of bot activity to the local desktop pet (Kodama). No-op
// unless PET_SYNC_ENABLED. SAFE mode redacts + clamps text; FULL mode only
// clamps. Never throws into the caller.
function emitPet(type, payload = {}) {
  if (!petBus) return;
  try {
    const out = { ...payload };
    if (typeof out.text === 'string') {
      const cleaned = config.petSyncMode === 'full' ? out.text : redactForCard(out.text);
      out.text = clampText(cleaned, config.petSyncMaxMessageChars);
    }
    out.mode = config.petSyncMode;
    out.source = out.source || 'lark';
    petBus.emit(type, out);
  } catch (error) {
    if (config.debug) console.error(`[pet] emit failed: ${error.message}`);
  }
}
const backendRunner = createRunner(config, { clampReply, runProcessFn: runProcess });
const profilePolicy = loadProfilePolicy({
  enabled: config.profilePolicyEnabled,
  configFile: config.profileConfigFile,
});
const stopRegistry = createStopRegistry();
const directTaskQueue = createContextQueueRuntime({
  contextKeyForItem: item => item.contextKey || contextKeyForBridgeEvent(item.event),
  runItem: item => executeDirectCodexTask(item.event, item.rawText, {
    ...item.options,
    contextKey: item.contextKey || contextKeyForBridgeEvent(item.event),
  }),
  onError: (item, error) => {
    console.error(
      `[bridge] queued direct task failed in ${item.contextKey || contextKeyForBridgeEvent(item.event)}: ${error.stack || error.message || error}`,
    );
  },
});
let startupChecks = [];
let mentionLookupWarningLogged = false;

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

function contextKeyForBridgeEvent(event) {
  return conversationKeyForEvent({
    chatId: extractChatId(event),
    chatType: extractChatType(event),
    senderId: extractSenderId(event),
    threadId: findStringDeep(event, ['thread_id', 'threadId']),
    rootId: findStringDeep(event, ['root_id', 'rootId']),
    parentId: findStringDeep(event, ['parent_id', 'parentId']),
    replyToMessageId: findStringDeep(event, ['reply_to_message_id', 'replyToMessageId']),
  });
}

function isMentionableUserOpenId(value) {
  return typeof value === 'string' && value.startsWith('ou_');
}

function isApprovalOwnerOpenId(openId) {
  return Boolean(openId && config.delegateApproverOpenId && openId === config.delegateApproverOpenId);
}

function isApprovalOwnerEvent(event) {
  return isApprovalOwnerOpenId(extractSenderId(event));
}

function isBridgeOwnerOpenId(openId) {
  return (
    isApprovalOwnerOpenId(openId) ||
    (profilePolicy.enabled && isProfileOwner(profilePolicy.config, openId))
  );
}

function isBridgeOwnerEvent(event) {
  return isBridgeOwnerOpenId(extractSenderId(event));
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
    mention.app_id,
    mention.appId,
    mention?.id?.open_id,
    mention?.id?.openId,
    mention?.id?.user_id,
    mention?.id?.userId,
    mention?.id?.app_id,
    mention?.id?.appId,
  ]
    .filter(value => typeof value === 'string')
    .map(value => value.trim());

  if (config.botOpenId && ids.includes(config.botOpenId)) return true;
  if (config.botAppId && ids.includes(config.botAppId)) return true;

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

function primaryMessageObjects(input) {
  const objects = [];
  const add = value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      objects.push(value);
    }
  };

  add(input);
  add(input?.event?.message);
  add(input?.message);
  add(input?.data?.message);
  add(input?.data?.item);
  if (Array.isArray(input?.data?.messages)) input.data.messages.forEach(add);
  if (Array.isArray(input?.messages)) input.messages.forEach(add);
  return objects;
}

function topLevelMentionArrays(input) {
  const arrays = [];
  for (const object of primaryMessageObjects(input)) {
    if (Array.isArray(object.mentions)) arrays.push(object.mentions);
    if (Array.isArray(object.mention)) arrays.push(object.mention);
  }
  return arrays;
}

function eventMentionsBot(event) {
  return topLevelMentionArrays(event).some(mentions => mentions.some(mentionMatchesBot));
}

function eventMentionsDelegateUser(event) {
  return topLevelMentionArrays(event).some(mentions =>
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

function shouldHandleDelegateReviewAutomation(rawText) {
  if (!config.delegateReviewAutomationEnabled) return false;
  return shouldTriggerReviewAutomation({
    rawText,
    keywordText: stripDelegateMentionText(rawText),
    reviewKeywords: config.delegateReviewKeywords,
    allowAiPolishedApproveShorthand: true,
  });
}

function canExecuteReviewAutomationDirectly(event, rawText) {
  return canDirectReviewAutomation({
    requesterIsOwner: isBridgeOwnerEvent(event),
    senderIsKnownBot: isKnownBotSender(event),
    rawText,
  });
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
  return isKnownBotSenderPolicy({
    senderType: extractSenderType(event),
    senderId: extractSenderId(event),
    loopBotSenderIds: config.loopBotSenderIds,
  });
}

function shouldSkipSender(event, rawText) {
  const senderId = extractSenderId(event);
  return shouldSkipSenderPolicy({
    senderId,
    senderType: extractSenderType(event),
    trace: extractBridgeTrace(rawText),
    botOpenId: config.botOpenId,
    loopIgnoreSenderIds: config.loopIgnoreSenderIds,
    loopAllowSenderIds: config.loopAllowSenderIds,
    loopBotSenderIds: config.loopBotSenderIds,
    loopRespondToBotSenders: config.loopRespondToBotSenders,
    loopMaxTurns: config.loopMaxTurns,
    delegateAllowBotSenders: config.delegateAllowBotSenders,
    delegateMentionEnabled: config.delegateMentionEnabled,
    hasActionableText: hasActionableDelegateText(rawText),
    mentionsDelegate: eventMentionsDelegateUser(event) || textMentionsDelegateUser(rawText),
    mentionsBot: eventMentionsBot(event) || textMentionsBot(rawText),
  });
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

function resolveConfiguredBotMentionOpenId(command) {
  const aliases = [
    command.targetOpenId,
    command.targetAppId,
    command.targetName,
    command.targetName ? `@${command.targetName}` : '',
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const openId = config.botSendTargetOpenIds.get(alias);
    if (openId) return openId;
  }
  return '';
}

function resolveConfiguredBotAppId(command) {
  const aliases = [
    command.targetOpenId,
    command.targetAppId,
    command.targetName,
    command.targetName ? `@${command.targetName}` : '',
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const appId = config.botSendTargetAppIds.get(alias);
    if (appId) return appId;
  }
  return '';
}

function normalizeBotSendTarget(command) {
  if (command.targetOpenId) return command;

  const configuredOpenId = resolveConfiguredBotMentionOpenId(command);
  if (configuredOpenId) {
    return {
      ...command,
      targetOpenId: configuredOpenId,
    };
  }

  const configuredAppId = resolveConfiguredBotAppId(command);
  if (configuredAppId && !command.targetAppId) {
    command = {
      ...command,
      targetAppId: configuredAppId,
    };
  }

  if (config.botSendAllowPlainTextMention) return command;

  const target =
    command.targetName || command.targetAppId || command.targetOpenId || 'unknown';
  const appIdHint = command.targetAppId
    ? `已知 app_id=${command.targetAppId}，但 app_id 不能替代真实 @ 所需的 open_id。`
    : '';
  throw new Error(
    [
      `无法为机器人目标「${target}」构造真实 @：Lark 真实 mention 需要目标 open_id（ou_xxx）。`,
      appIdHint,
      '群成员列表接口会过滤机器人，不能靠 chat.members.get 按名称枚举机器人。',
      '请直接传 ou_xxx，或配置 BOT_SEND_TARGET_OPEN_IDS，例如：BOT_SEND_TARGET_OPEN_IDS=\'知微=ou_xxx\'。BOT_SEND_TARGET_APP_IDS 只用于记录/邀请线索。',
    ].filter(Boolean).join(' '),
  );
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

  command = normalizeBotSendTarget(command);
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
    .replace(/^(?:帮我|帮忙|请)?\s*(?:找一下|找下|查一下|查找|找到|找出|搜索|搜一下|分享|导出|生成|创建)\s*/i, '')
    .replace(/^(?:codex|claude)\s*/i, '')
    .replace(/^(?:codex|claude)?\s*(?:session|会话)\s*/i, '')
    .replace(/^(?:包含|含有|关键词|内容)(?:为|是|:|：)?\s*/i, '')
    .replace(/^(?:标题|title|名称|名字)(?:\s*(?:叫|为|是|:|：))?\s*/i, '')
    .replace(/^(?:叫|为|是|:|：)\s*/i, '')
    .replace(/[，,。；;]\s*(?:请)?(?:发送|发|分享到?|导出到?|写入|生成|创建).*(?:飞书)?文档.*$/i, '')
    .replace(/\s*(?:这个|该)?(?:的)?\s*(?:(?:codex|claude)\s*)?(?:session|会话)\s*$/i, '')
    .replace(/\s*的\s*$/i, '')
    .trim();

  return stripWrappingQuotes(text);
}

function parseSessionProvider(value) {
  const text = String(value || '');
  if (/\bclaude\b|Claude|克劳德/i.test(text)) return 'claude';
  if (/\bcodex\b/i.test(text)) return 'codex';
  return 'codex';
}

function parseExplicitSessionTitleQuery(value) {
  const text = stripWrappingQuotes(value);
  const quoted = /["“「『']([^"”」』']+)["”」』']/.exec(text);
  if (quoted?.[1]) return quoted[1].trim();

  const match =
    /(?:标题|title|名称|名字)(?:\s*(?:叫|为|是|:|：))?\s*(.+?)\s*(?:的\s*)?(?:(?:codex|claude)\s*)?(?:session|会话)(?=\s*(?:[，,。；;]|$|发送|发|分享到?|导出到?|导出|写入|生成|创建))/i.exec(
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

  const leadingReference = /^(.+?)\s*(?:这个|该)?(?:的)?\s*(?:(?:codex|claude)\s*)?(?:session|会话)(?=\s*(?:帮|请|给|生成|创建|分享|导出|快照|链接|link|文档|$))/i.exec(
    text,
  );
  return leadingReference?.[1] ? cleanSessionTitleQuery(leadingReference[1]) : '';
}

function parseSessionShareCommand(rawText) {
  if (!config.sessionShareEnabled) return null;

  const text = sessionCommandText(rawText);
  if (!text) return null;

  const lowerText = text.toLowerCase();
  const provider = parseSessionProvider(text);
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
      provider,
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
      provider,
      raw: text,
      intent: asksToCreateShare ? 'share' : 'find',
    };
  }

  const naturalReferenceQuery = parseNaturalSessionReferenceQuery(text);
  if (naturalReferenceQuery) {
    return {
      query: naturalReferenceQuery,
      provider,
      raw: text,
      intent: asksToCreateShare ? 'share' : 'find',
    };
  }

  const suffixMatch = /(?:分享|导出|快照).{0,12}(?:(?:codex|claude)\s*)?(?:session|会话)\s+(.+)$/i.exec(
    text,
  );
  if (suffixMatch?.[1]) {
    return {
      query: cleanSessionTitleQuery(suffixMatch[1]),
      provider,
      raw: text,
      intent: asksToCreateShare ? 'share' : 'find',
    };
  }

  if (provider === 'claude' && asksForSnapshot) {
    return {
      query: cleanSessionTitleQuery(text),
      provider,
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
      provider: 'codex',
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
    .map((session, index) => {
      const project = session.projectPath ? `，${session.projectPath}` : '';
      return `${index + 1}. ${session.threadName}（${sessionProviderLabel(session)}，${formatSessionUpdatedAt(session.updatedAt)}，${session.id}${project}）`;
    })
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

function sessionProvider(session) {
  return session?.provider === 'claude' ? 'claude' : 'codex';
}

function sessionProviderLabel(sessionOrProvider) {
  const provider =
    typeof sessionOrProvider === 'string' ? sessionOrProvider : sessionProvider(sessionOrProvider);
  return provider === 'claude' ? 'Claude' : 'Codex';
}

function sessionProviderDisplayName(sessionOrProvider) {
  return `${sessionProviderLabel(sessionOrProvider)} session`;
}

function sessionAssistantDisplayName(session) {
  return sessionProvider(session) === 'claude' ? 'Claude' : 'Codex';
}

function sessionAssistantAvatar(session) {
  return sessionProvider(session) === 'claude' ? 'Cl' : 'C';
}

function publicSessionInfo(session) {
  if (!session || typeof session !== 'object') return session;
  return {
    provider: sessionProvider(session),
    id: session.id,
    threadName: session.threadName,
    updatedAt: session.updatedAt,
    projectPath: session.projectPath || '',
    model: session.model || '',
    visibleTurnCount: session.visibleTurnCount || undefined,
  };
}

function publicSessionMatches(matches) {
  return Array.isArray(matches) ? matches.map(publicSessionInfo) : [];
}

function findSessionForProvider(provider, query) {
  if (provider === 'claude') {
    return findClaudeSession(query, {
      projectsRoot: config.claudeProjectsRoot,
      candidateLimit: config.sessionShareCandidateLimit,
    });
  }
  return findCodexSession(query);
}

function findSessionFileForProvider(session) {
  if (sessionProvider(session) === 'claude') return session.file;
  return findCodexSessionFile(session);
}

function parseSessionTranscriptForProvider(session, sessionFile) {
  if (sessionProvider(session) === 'claude') {
    const transcript = parseClaudeSessionTranscript(sessionFile);
    transcript.turns = transcript.turns.map(turn => {
      const parts = redactSessionMessageParts(sessionTurnParts(turn));
      return {
        ...turn,
        parts,
        text: sessionMessagePartsToCopyText(parts),
      };
    });
    return transcript;
  }
  return parseCodexSessionTranscript(sessionFile);
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
  const providerLabel = sessionProviderLabel(session);
  const assistantName = sessionAssistantDisplayName(session);
  const rawSource = transcript.meta?.originator || transcript.meta?.source || providerLabel;
  const source = typeof rawSource === 'string' ? rawSource : JSON.stringify(rawSource);
  const cwd = transcript.meta?.cwd || session.projectPath || '';
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
    `> 说明：只导出 ${providerLabel} 中可见的用户和助手消息；system/developer 指令、thinking、工具调用、工具输出、token 统计已省略。`,
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
    const roleName = turn.role === 'user' ? '用户' : assistantName;
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

function makeProviderSessionShareDocTitle(session) {
  const title = `${sessionProviderDisplayName(session)} 快照 - ${String(session.threadName || '未命名会话').replace(/\s+/g, ' ').trim()}`;
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

function buildSessionShareCard({ session, doc, snapshot, matchType }) {
  const providerDisplayName = sessionProviderDisplayName(session);
  const docRef = doc.docUrl || doc.docId || '';
  const matchText = formatSessionMatchType(matchType);
  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${providerDisplayName}**\n${clampCardText(session.threadName, 500)}`,
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
          content: formatLarkMarkdownLink('打开飞书文档', docRef),
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
        content: `${providerDisplayName} 快照已生成`,
      },
    },
    elements,
  };
}

function formatSessionShareSuccessText({ session, doc, snapshot, matchType }) {
  const providerDisplayName = sessionProviderDisplayName(session);
  const matchText = matchType === 'fuzzy' ? '（按标题包含匹配）' : '';
  const docRef = doc.docUrl || doc.docId || '';
  const docText = docRef
    ? formatLarkMarkdownLink('打开飞书文档', docRef)
    : '文档已创建，但返回值里没有 doc_url/doc_id';
  const chunkText = doc.chunks > 1 ? `，分 ${doc.chunks} 段写入` : '';
  const truncatedText = snapshot.truncated
    ? `\n注意：session 较长，已导出前 ${snapshot.includedTurns}/${snapshot.totalTurns} 条可见消息。`
    : '';
  return `已导出 ${providerDisplayName}「${session.threadName}」${matchText}到飞书文档${chunkText}：\n${docText}${truncatedText}`;
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

function safeMarkdownUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\/[^\s<>"']+$/i.test(raw)) return '';
  return raw;
}

function formatLarkMarkdownLink(label, url) {
  const href = safeMarkdownUrl(url);
  if (!href) return String(url || '');
  const safeLabel = String(label || href).replace(/[\[\]]/g, '');
  return `[${safeLabel}](${href})`;
}

function renderSessionMarkdownHtml(text) {
  return `<div class="message-text message-markdown">${renderSessionMarkdownBlockHtml(text)}</div>`;
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
      parts.push(renderSessionMarkdownHtml(plain));
    }

    const lang = match[1] ? `<div class="code-lang">${escapeHtml(match[1])}</div>` : '';
    parts.push(`<div class="code-card">${lang}<pre><code>${escapeHtml(match[2].trim())}</code></pre></div>`);
    lastIndex = fencePattern.lastIndex;
  }

  const tail = source.slice(lastIndex);
  if (tail.trim()) {
    parts.push(renderSessionMarkdownHtml(tail));
  }

  return parts.join('\n') || '<div class="message-text message-markdown"></div>';
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

function writeEnhancedSessionShareHtmlFile(sourceFile, targetFile) {
  const html = readFileSync(sourceFile, 'utf8');
  writeFileSync(targetFile, enhanceSessionShareHtml(html));
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
    writeEnhancedSessionShareHtmlFile(source, join(deployDir, fileName));
    writeEnhancedSessionShareHtmlFile(source, join(routeDir, shareId));
    writeEnhancedSessionShareHtmlFile(source, join(routeDir, fileName));
  }

  writeEnhancedSessionShareHtmlFile(currentShareFile, join(deployDir, 'index.html'));
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
    .legacy-share-turn {
      display: grid !important;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      align-items: flex-start;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }
    .legacy-share-turn.turn-user,
    .legacy-share-turn.user {
      grid-template-columns: minmax(0, 1fr) 44px;
    }
    .legacy-share-turn.turn-user .avatar,
    .legacy-share-turn.user .avatar {
      grid-column: 2;
      background: var(--user, #1f7a64);
    }
    .legacy-share-turn.turn-user .bubble-wrap,
    .legacy-share-turn.user .bubble-wrap {
      grid-column: 1;
      grid-row: 1;
      align-items: flex-end;
    }
    .legacy-share-turn .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: white;
      background: var(--assistant, #334155);
      font-weight: 800;
      box-shadow: 0 10px 24px rgba(37, 37, 37, .12);
    }
    .legacy-share-turn .bubble-wrap {
      display: flex;
      min-width: 0;
      flex-direction: column;
      align-items: flex-start;
    }
    .legacy-share-turn .meta {
      display: none;
    }
    .legacy-share-turn .turn-meta {
      margin: 0 2px 7px;
      color: var(--muted, #6d716f);
      font-size: 13px;
    }
    .legacy-share-turn .turn-meta span {
      color: var(--ink, var(--text, #252525));
      font-weight: 700;
      margin-right: 8px;
    }
    .legacy-share-turn .bubble {
      position: relative;
      max-width: min(820px, 100%);
      padding: 0;
      border: 1px solid rgba(51, 65, 85, .14);
      border-radius: 8px;
      background: var(--assistant-soft, var(--assistant, #fffdfa));
      box-shadow: 0 10px 28px rgba(76, 61, 44, .07);
      overflow: hidden;
    }
    .legacy-share-turn.turn-user .bubble,
    .legacy-share-turn.user .bubble {
      background: var(--user-soft, var(--user, #f0f7ff));
      border-color: rgba(31, 122, 100, .22);
    }
    .legacy-share-turn .share-content,
    .legacy-share-turn .bubble-body {
      padding: 16px 18px 0;
    }
    .legacy-share-turn .message-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 15px/1.68 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .legacy-share-turn .message-markdown,
    .message-markdown {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .message-markdown p {
      margin: 0;
    }
    .message-markdown p + p,
    .message-markdown p + ul,
    .message-markdown p + ol,
    .message-markdown p + .md-table-wrap,
    .message-markdown ul + p,
    .message-markdown ol + p,
    .message-markdown blockquote + p,
    .message-markdown p + blockquote,
    .message-markdown .md-table-wrap + p {
      margin-top: 10px;
    }
    .message-markdown h1,
    .message-markdown h2,
    .message-markdown h3,
    .message-markdown h4,
    .message-markdown h5,
    .message-markdown h6 {
      margin: 0 0 8px;
      color: var(--ink, var(--text, #252525));
      font-weight: 750;
      line-height: 1.3;
      letter-spacing: 0;
    }
    .message-markdown h1 { font-size: 1.28em; }
    .message-markdown h2 { font-size: 1.18em; }
    .message-markdown h3,
    .message-markdown h4,
    .message-markdown h5,
    .message-markdown h6 { font-size: 1.06em; }
    .message-markdown ul,
    .message-markdown ol {
      margin: 0;
      padding-left: 1.35em;
    }
    .message-markdown li + li {
      margin-top: 4px;
    }
    .message-markdown blockquote {
      margin: 0;
      padding: 6px 0 6px 12px;
      border-left: 3px solid rgba(51, 65, 85, .22);
      color: var(--muted, #6d716f);
    }
    .message-markdown code {
      border-radius: 5px;
      padding: 1px 5px;
      background: rgba(37, 37, 37, .08);
      font: .92em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .message-markdown hr {
      height: 1px;
      margin: 12px 0;
      border: 0;
      background: rgba(51, 65, 85, .16);
    }
    .message-markdown .md-table-wrap {
      max-width: 100%;
      overflow-x: auto;
      margin: 10px 0;
    }
    .message-markdown table {
      width: 100%;
      min-width: 520px;
      border-collapse: collapse;
      font-size: .94em;
      line-height: 1.55;
    }
    .message-markdown th,
    .message-markdown td {
      padding: 7px 9px;
      border: 1px solid rgba(51, 65, 85, .16);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .message-markdown th {
      background: rgba(51, 65, 85, .06);
      font-weight: 700;
      text-align: left;
    }
    .md-task {
      color: var(--muted, #6d716f);
    }
    .legacy-share-turn .message-text + .message-text,
    .legacy-share-turn .message-text + .code-card,
    .legacy-share-turn .code-card + .message-text {
      margin-top: 14px;
    }
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

const SESSION_SHARE_ENHANCER_VERSION = 'v5';

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

      const escapeMarkdownHtml = value => {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };

      const safeMarkdownUrl = value => {
        const raw = String(value || '').trim();
        return /^https?:\\/\\/[^\\s<>"']+$/i.test(raw) ? raw : '';
      };

      const splitTrailingUrlPunctuation = value => {
        let url = String(value || '');
        let suffix = '';
        while (url && /[.,!?;:，。！？；：、)\\]}]$/u.test(url)) {
          suffix = url.slice(-1) + suffix;
          url = url.slice(0, -1);
        }
        return { url, suffix };
      };

      const linkifyEscapedHtml = value => {
        return String(value || '').replace(/https?:\\/\\/[^\\s<]+/g, rawUrl => {
          const split = splitTrailingUrlPunctuation(rawUrl);
          const href = safeMarkdownUrl(split.url.replace(/&amp;/g, '&'));
          if (!href) return rawUrl;
          return '<a href="' + escapeMarkdownHtml(href) + '" target="_blank" rel="noreferrer">' + split.url + '</a>' + split.suffix;
        });
      };

      const renderInlineMarkdown = text => {
        const tokens = [];
        const stash = html => {
          const index = tokens.push(html) - 1;
          return '%%MDTOKEN' + index + '%%';
        };
        const inlineCodePattern = new RegExp('\\\\x60([^\\\\x60\\\\n]+)\\\\x60', 'g');
        const withProtectedInline = String(text || '')
          .replace(inlineCodePattern, (_, code) => {
            return stash('<code>' + escapeMarkdownHtml(code) + '</code>');
          })
          .replace(/\\[([^\\]\\n]+)\\]\\(([^\\s)]+)\\)/g, (match, label, url) => {
            const href = safeMarkdownUrl(url);
            if (!href) return stash(escapeMarkdownHtml(match));
            return stash(
              '<a href="' + escapeMarkdownHtml(href) + '" target="_blank" rel="noreferrer">' +
                escapeMarkdownHtml(label) +
                '</a>',
            );
          });

        let html = escapeMarkdownHtml(withProtectedInline)
          .replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>')
          .replace(/__([^_\\n]+)__/g, '<strong>$1</strong>')
          .replace(/(^|[^\\*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>')
          .replace(/(^|[^_])_([^_\\n]+)_/g, '$1<em>$2</em>');

        html = linkifyEscapedHtml(html);
        return html.replace(/%%MDTOKEN(\\d+)%%/g, (_, index) => tokens[Number(index)] || '');
      };

      const renderMarkdownListItem = text => {
        const checklist = /^\\[([ xX])\\]\\s+(.+)$/.exec(String(text || '').trim());
        if (!checklist) return renderInlineMarkdown(text);
        const checked = checklist[1].toLowerCase() === 'x';
        return '<span class="md-task" aria-hidden="true">' + (checked ? '☑' : '☐') + '</span> ' + renderInlineMarkdown(checklist[2]);
      };

      const splitMarkdownTableRow = line => {
        let source = String(line || '').trim();
        if (!source.includes('|')) return null;
        if (source.startsWith('|')) source = source.slice(1);
        if (source.endsWith('|')) source = source.slice(0, -1);

        const cells = [];
        let current = '';
        for (let index = 0; index < source.length; index += 1) {
          const char = source[index];
          const next = source[index + 1];
          if (char === '\\\\' && next === '|') {
            current += '|';
            index += 1;
            continue;
          }
          if (char === '|') {
            cells.push(current.trim());
            current = '';
            continue;
          }
          current += char;
        }
        cells.push(current.trim());
        return cells.length >= 2 ? cells : null;
      };

      const markdownTableAlignments = line => {
        const cells = splitMarkdownTableRow(line);
        if (!cells || !cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\\s+/g, '')))) {
          return null;
        }
        return cells.map(cell => {
          const normalized = cell.replace(/\\s+/g, '');
          if (normalized.startsWith(':') && normalized.endsWith(':')) return 'center';
          if (normalized.endsWith(':')) return 'right';
          if (normalized.startsWith(':')) return 'left';
          return '';
        });
      };

      const normalizeTableCells = (cells, size) => {
        const normalized = cells.slice(0, size);
        while (normalized.length < size) normalized.push('');
        return normalized;
      };

      const renderMarkdownTableHtml = (headerCells, alignments, rows) => {
        const alignAttr = index => {
          const align = alignments[index];
          return align ? ' style="text-align:' + align + '"' : '';
        };
        const renderCell = (tag, cell, index) => {
          return '<' + tag + alignAttr(index) + '>' + renderInlineMarkdown(cell) + '</' + tag + '>';
        };
        const width = headerCells.length;
        const header = normalizeTableCells(headerCells, width)
          .map((cell, index) => renderCell('th', cell, index))
          .join('');
        const body = rows
          .map(row => {
            const cells = normalizeTableCells(row, width)
              .map((cell, index) => renderCell('td', cell, index))
              .join('');
            return '<tr>' + cells + '</tr>';
          })
          .join('');
        return '<div class="md-table-wrap"><table><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>';
      };

      const parseMarkdownTable = (lines, startIndex) => {
        const headerCells = splitMarkdownTableRow(lines[startIndex]);
        const alignments = markdownTableAlignments(lines[startIndex + 1]);
        if (!headerCells || !alignments) return null;

        const width = headerCells.length;
        const rows = [];
        let index = startIndex + 2;
        while (index < lines.length) {
          const trimmed = String(lines[index] || '').trim();
          if (!trimmed) break;
          const row = splitMarkdownTableRow(lines[index]);
          if (!row) break;
          rows.push(row);
          index += 1;
        }

        return {
          nextIndex: index,
          html: renderMarkdownTableHtml(headerCells, normalizeTableCells(alignments, width), rows),
        };
      };

      const renderMarkdownBlockHtml = text => {
        const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');
        const blocks = [];
        let paragraph = [];
        let listType = '';
        let listItems = [];

        const flushParagraph = () => {
          if (!paragraph.length) return;
          blocks.push('<p>' + paragraph.map(renderInlineMarkdown).join('<br>') + '</p>');
          paragraph = [];
        };

        const flushList = () => {
          if (!listType) return;
          const tag = listType === 'ol' ? 'ol' : 'ul';
          blocks.push('<' + tag + '>' + listItems.map(item => '<li>' + renderMarkdownListItem(item) + '</li>').join('') + '</' + tag + '>');
          listType = '';
          listItems = [];
        };

        const startList = (type, item) => {
          flushParagraph();
          if (listType && listType !== type) flushList();
          listType = type;
          listItems.push(item);
        };

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const trimmed = line.trim();
          if (!trimmed) {
            flushParagraph();
            flushList();
            continue;
          }

          const table = parseMarkdownTable(lines, index);
          if (table) {
            flushParagraph();
            flushList();
            blocks.push(table.html);
            index = table.nextIndex - 1;
            continue;
          }

          const heading = /^(#{1,6})\\s+(.+)$/.exec(trimmed);
          if (heading) {
            flushParagraph();
            flushList();
            const level = Math.min(6, heading[1].length);
            blocks.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
            continue;
          }

          if (/^([-*_])(?:\\s*\\1){2,}\\s*$/.test(trimmed)) {
            flushParagraph();
            flushList();
            blocks.push('<hr>');
            continue;
          }

          const unordered = /^[-*+]\\s+(.+)$/.exec(trimmed);
          if (unordered) {
            startList('ul', unordered[1]);
            continue;
          }

          const ordered = /^\\d+[.)]\\s+(.+)$/.exec(trimmed);
          if (ordered) {
            startList('ol', ordered[1]);
            continue;
          }

          const quote = /^>\\s?(.*)$/.exec(line);
          if (quote) {
            flushParagraph();
            flushList();
            blocks.push('<blockquote>' + renderInlineMarkdown(quote[1]) + '</blockquote>');
            continue;
          }

          flushList();
          paragraph.push(line);
        }

        flushParagraph();
        flushList();
        return blocks.join('\\n');
      };

      const renderMarkdownMessageHtml = text => {
        const source = String(text || '');
        const parts = [];
        const fencePattern = new RegExp('\\\\x60\\\\x60\\\\x60([A-Za-z0-9_-]*)\\\\n?([\\\\s\\\\S]*?)\\\\x60\\\\x60\\\\x60', 'g');
        let lastIndex = 0;
        let match = null;

        while ((match = fencePattern.exec(source))) {
          const plain = source.slice(lastIndex, match.index);
          if (plain.trim()) {
            parts.push('<div class="message-text message-markdown">' + renderMarkdownBlockHtml(plain) + '</div>');
          }
          const lang = match[1] ? '<div class="code-lang">' + escapeMarkdownHtml(match[1]) + '</div>' : '';
          parts.push('<div class="code-card">' + lang + '<pre><code>' + escapeMarkdownHtml(match[2].trim()) + '</code></pre></div>');
          lastIndex = fencePattern.lastIndex;
        }

        const tail = source.slice(lastIndex);
        if (tail.trim()) {
          parts.push('<div class="message-text message-markdown">' + renderMarkdownBlockHtml(tail) + '</div>');
        }
        return parts.join('\\n') || '<div class="message-text message-markdown"></div>';
      };

      const renderMarkdownContent = content => {
        if (!content || content.dataset.markdownHydrated === '1') return;
        const textBlocks = Array.from(content.querySelectorAll(':scope > .message-text:not(.message-markdown)'));
        textBlocks.forEach(block => {
          const template = document.createElement('template');
          template.innerHTML = renderMarkdownMessageHtml(block.innerText || '');
          block.replaceWith(...Array.from(template.content.childNodes));
        });
        const tablePattern = /(^|\\n)\\s*\\|?.+\\|.+\\|?\\s*\\n\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*(\\n|$)/;
        const markdownBlocks = Array.from(content.querySelectorAll(':scope > .message-markdown'));
        markdownBlocks.forEach(block => {
          const text = block.innerText || '';
          if (!tablePattern.test(text)) return;
          const template = document.createElement('template');
          template.innerHTML = renderMarkdownMessageHtml(text);
          block.replaceWith(...Array.from(template.content.childNodes));
        });
        content.dataset.markdownHydrated = '1';
      };

      const roleForTurn = turn => {
        if (!turn) return '';
        if (turn.classList.contains('turn-user') || turn.classList.contains('user')) return 'user';
        if (turn.classList.contains('turn-assistant') || turn.classList.contains('assistant')) return 'assistant';
        return '';
      };

      const normalizeMetaText = text => {
        return String(text || '')
          .replace(/^\\s*\\d+\\.\\s*/u, '')
          .replace(/^Codex\\b/u, 'codex 回复')
          .trim();
      };

      const legacyTurnText = turn => {
        const body = turn.querySelector(':scope .bubble-body, :scope .share-content');
        if (body) return body.innerText.trim();
        const pre = turn.querySelector(':scope > pre, :scope pre');
        return (pre?.innerText || '').trim();
      };

      const ensureTurnId = (turn, index) => {
        if (!turn.id) turn.id = 'turn-' + (index + 1);
        return turn.id;
      };

      const migrateLegacyTurn = (turn, index) => {
        if (!turn || turn.querySelector(':scope > .bubble-wrap')) return;

        const role = roleForTurn(turn);
        if (!role) return;

        const turnId = ensureTurnId(turn, index);
        const meta = normalizeMetaText(turn.querySelector(':scope > .meta')?.textContent || '');
        const text = legacyTurnText(turn);
        copyData[turnId] = copyData[turnId] || text;

        turn.classList.add('legacy-share-turn', role === 'user' ? 'turn-user' : 'turn-assistant');

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = role === 'user' ? '你' : 'C';

        const bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'bubble-wrap';

        const turnMeta = document.createElement('div');
        turnMeta.className = 'turn-meta';
        const label = role === 'user' ? '用户' : 'codex 回复';
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        turnMeta.appendChild(labelEl);
        const timeText = meta
          ? meta.replace(/^用户\\s*·?\\s*/u, '').replace(/^codex 回复\\s*·?\\s*/u, '')
          : '';
        if (timeText) turnMeta.appendChild(document.createTextNode(timeText));

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        const body = document.createElement('div');
        body.className = 'bubble-body';
        body.innerHTML = renderMarkdownMessageHtml(text);
        bubble.appendChild(body);

        const oldMeta = turn.querySelector(':scope > .meta');
        if (oldMeta) oldMeta.remove();
        Array.from(turn.childNodes).forEach(node => {
          if (node !== oldMeta) node.remove();
        });

        bubbleWrap.appendChild(turnMeta);
        bubbleWrap.appendChild(bubble);
        turn.appendChild(avatar);
        turn.appendChild(bubbleWrap);
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

      const appendTurnIntoPrevious = (previousTurn, turn) => {
        const previousBubble = previousTurn.querySelector(':scope .bubble');
        const bubble = turn.querySelector(':scope .bubble');
        if (!previousBubble || !bubble) return false;

        const previousContent = findOrWrapContent(previousBubble);
        const content = findOrWrapContent(bubble);
        const previousId = previousTurn.id || previousBubble.id || '';
        const turnId = turn.id || bubble.id || '';
        const text = copyData[turnId] || content.innerText || '';
        if (previousId && text) {
          copyData[previousId] = [copyData[previousId] || previousContent.innerText || '', text]
            .filter(Boolean)
            .join('\\n\\n');
        }

        Array.from(content.childNodes).forEach(node => {
          previousContent.appendChild(node);
        });
        turn.remove();
        return true;
      };

      const mergeAdjacentConversationTurns = () => {
        const turns = Array.from(document.querySelectorAll('.conversation > .turn'));
        let previousVisibleTurn = null;

        turns.forEach((turn, index) => {
          migrateLegacyTurn(turn, index);
          const role = roleForTurn(turn);
          if (!role) {
            previousVisibleTurn = null;
            return;
          }

          if (previousVisibleTurn && roleForTurn(previousVisibleTurn) === role) {
            appendTurnIntoPrevious(previousVisibleTurn, turn);
            return;
          }

          previousVisibleTurn = turn;
        });
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
        const turns = Array.from(document.querySelectorAll('.conversation .turn, main > .turn, main section.turn'));
        const visibleCount = String(turns.filter(turn => !turn.hidden).length);
        if (count) count.textContent = visibleCount;
        document.querySelectorAll('.pill').forEach(pill => {
          if (/^\\d+\\s+visible messages$/i.test(pill.textContent || '')) {
            pill.textContent = visibleCount + ' visible messages';
          }
        });
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
        renderMarkdownContent(content);
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
        mergeAdjacentConversationTurns();
        let visibleIndex = 0;
        document.querySelectorAll('.bubble').forEach(bubble => {
          const turn = bubble.closest('.turn') || bubble.closest('article');
          const content = findOrWrapContent(bubble);
          renderMarkdownContent(content);
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

function stripMarkedSessionShareEnhancer(html) {
  return html
    .replace(
      /<style\b[^>]*data-session-share-enhancer=["']v\d+["'][^>]*>[\s\S]*?<\/style>\s*/gi,
      '',
    )
    .replace(
      /<script\b[^>]*data-session-share-enhancer=["']v\d+["'][^>]*>[\s\S]*?<\/script>\s*/gi,
      '',
    );
}

function enhanceSessionShareHtml(html) {
  if (html.includes(`data-session-share-enhancer="${SESSION_SHARE_ENHANCER_VERSION}"`)) return html;

  const normalizedHtml = normalizeLegacySessionShareMarkup(
    stripLegacySessionShareScript(stripMarkedSessionShareEnhancer(html)),
  );
  const style = `<style data-session-share-enhancer="${SESSION_SHARE_ENHANCER_VERSION}">\n${sessionShareEnhancementCss()}\n</style>`;
  const script = `<script data-session-share-enhancer="${SESSION_SHARE_ENHANCER_VERSION}">\n${sessionShareEnhancementScript()}\n</script>`;
  const withStyle = normalizedHtml.includes('</head>')
    ? normalizedHtml.replace('</head>', `${style}\n</head>`)
    : `${style}\n${normalizedHtml}`;
  return withStyle.includes('</body>')
    ? withStyle.replace('</body>', `${script}\n</body>`)
    : `${withStyle}\n${script}`;
}

function makeSessionSharePageHtml({ session, transcript, snapshot, shareId }) {
  const providerLabel = sessionProviderLabel(session);
  const providerDisplayName = sessionProviderDisplayName(session);
  const assistantName = sessionAssistantDisplayName(session);
  const assistantAvatar = sessionAssistantAvatar(session);
  const displayedTurns = transcript.turns.slice(0, snapshot.includedTurns);
  const copyData = {};
  const turns = displayedTurns
    .map((turn, index) => {
      const isUser = turn.role === 'user';
      const side = isUser ? 'user' : 'assistant';
      const label = isUser ? '用户' : `${assistantName} 回复`;
      const avatar = isUser ? '你' : assistantAvatar;
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

  const sourceRaw = transcript.meta?.originator || transcript.meta?.source || providerLabel;
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
  <title>${escapeHtml(session.threadName)} · ${escapeHtml(providerDisplayName)} 快照</title>
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
    .message-markdown {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .message-markdown p {
      margin: 0;
    }
    .message-markdown p + p,
    .message-markdown p + ul,
    .message-markdown p + ol,
    .message-markdown p + .md-table-wrap,
    .message-markdown ul + p,
    .message-markdown ol + p,
    .message-markdown blockquote + p,
    .message-markdown p + blockquote,
    .message-markdown .md-table-wrap + p {
      margin-top: 10px;
    }
    .message-markdown h1,
    .message-markdown h2,
    .message-markdown h3,
    .message-markdown h4,
    .message-markdown h5,
    .message-markdown h6 {
      margin: 0 0 8px;
      color: var(--ink);
      font-weight: 750;
      line-height: 1.3;
      letter-spacing: 0;
    }
    .message-markdown h1 { font-size: 1.28em; }
    .message-markdown h2 { font-size: 1.18em; }
    .message-markdown h3,
    .message-markdown h4,
    .message-markdown h5,
    .message-markdown h6 { font-size: 1.06em; }
    .message-markdown ul,
    .message-markdown ol {
      margin: 0;
      padding-left: 1.35em;
    }
    .message-markdown li + li {
      margin-top: 4px;
    }
    .message-markdown blockquote {
      margin: 0;
      padding: 6px 0 6px 12px;
      border-left: 3px solid rgba(51, 65, 85, .22);
      color: var(--muted);
    }
    .message-markdown code {
      border-radius: 5px;
      padding: 1px 5px;
      background: rgba(37, 37, 37, .08);
      font: .92em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .message-markdown hr {
      height: 1px;
      margin: 12px 0;
      border: 0;
      background: rgba(51, 65, 85, .16);
    }
    .message-markdown .md-table-wrap {
      max-width: 100%;
      overflow-x: auto;
      margin: 10px 0;
    }
    .message-markdown table {
      width: 100%;
      min-width: 520px;
      border-collapse: collapse;
      font-size: .94em;
      line-height: 1.55;
    }
    .message-markdown th,
    .message-markdown td {
      padding: 7px 9px;
      border: 1px solid rgba(51, 65, 85, .16);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .message-markdown th {
      background: rgba(51, 65, 85, .06);
      font-weight: 700;
      text-align: left;
    }
    .md-task {
      color: var(--muted);
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
  <style data-session-share-enhancer="${SESSION_SHARE_ENHANCER_VERSION}">
${sessionShareEnhancementCss()}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="title-row">
        <div>
          <div class="eyebrow">${escapeHtml(providerLabel)} Session Snapshot</div>
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
    <footer>Generated by 菌子坦荡荡 · ${escapeHtml(shareId)}</footer>
  </main>
  <script id="copy-data" type="application/json">${copyDataJson}</script>
  <script data-session-share-enhancer="${SESSION_SHARE_ENHANCER_VERSION}">
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
  if (matchType === 'recent') return '最近会话';
  if (matchType === 'project-recent') return '项目最近会话';
  if (matchType === 'content') return '内容包含匹配';
  if (matchType === 'fuzzy') return '标题包含匹配';
  if (matchType === 'id') return 'Session ID 匹配';
  return '标题精确匹配';
}

function buildSessionFoundCard({ session, snapshot, matchType }) {
  const actionText = isSessionShareWebOutput() ? '生成链接' : '生成文档';
  const providerDisplayName = sessionProviderDisplayName(session);
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: `找到 ${providerDisplayName}`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${providerDisplayName}**\n${clampCardText(session.threadName, 500)}`,
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
              provider: sessionProvider(session),
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
  const providerDisplayName = sessionProviderDisplayName(session);
  return [
    `找到 ${providerDisplayName}「${session.threadName}」。`,
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
  const providerDisplayName = sessionProviderDisplayName(session);
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'green',
      title: {
        tag: 'plain_text',
        content: `${providerDisplayName} 网页快照已生成`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${providerDisplayName}**\n${clampCardText(session.threadName, 500)}`,
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
            content: formatLarkMarkdownLink('打开网页快照', share.url),
          },
        ],
      },
    ],
  };
}

function formatSessionShareWebSuccessText({ session, share, snapshot, matchType }) {
  const providerDisplayName = sessionProviderDisplayName(session);
  const matchText = matchType === 'fuzzy' ? '（按标题包含匹配）' : '';
  const truncatedText = snapshot.truncated
    ? `\n注意：session 较长，已导出前 ${snapshot.includedTurns}/${snapshot.totalTurns} 条可见消息。`
    : '';
  return `已生成 ${providerDisplayName}「${session.threadName}」${matchText}的网页快照：\n${formatLarkMarkdownLink('打开网页快照', share.url)}${truncatedText}`;
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
  const provider = command.provider || 'codex';
  const query = cleanSessionTitleQuery(command.query);
  if (!query && provider !== 'claude') {
    await replyToLark(
      event,
      '用法：/session-share <session标题或ID>，也可以说“找一下标题叫 xxx 的 session”。Claude 可以说“分享 Claude 最近会话”或“分享 Claude code.byted.org 的会话”。',
    );
    return;
  }

  const result = findSessionForProvider(provider, query);
  if (result.status === 'ambiguous') {
    await replyToLark(
      event,
      `匹配到多个 ${sessionProviderDisplayName(provider)}，请把标题、项目名、关键词或时间说得更完整一点：\n${formatSessionCandidates(result.matches)}`,
    );
    return;
  }
  if (result.status !== 'ok') {
    await replyToLark(
      event,
      `没有找到匹配「${query || '最近'}」的 ${sessionProviderDisplayName(provider)}。\n最近的 session：\n${formatSessionCandidates(result.matches)}`,
    );
    return;
  }

  const sessionFile = findSessionFileForProvider(result.session);
  const transcript = parseSessionTranscriptForProvider(result.session, sessionFile);
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
    makeProviderSessionShareDocTitle(result.session),
    snapshot.markdown,
  );
  await replyWithSessionShareDocument(event, {
    session: result.session,
    doc,
    snapshot,
    matchType: result.matchType,
  });
}

async function createSessionShareFromQuery(query, options = {}) {
  if (!config.sessionShareEnabled) {
    return { ok: false, status: 403, error: 'session share is disabled' };
  }

  const provider = options.provider || 'codex';
  const cleanedQuery = cleanSessionTitleQuery(query);
  if (!cleanedQuery && provider !== 'claude') {
    return { ok: false, status: 400, error: 'missing session query' };
  }

  const result = findSessionForProvider(provider, cleanedQuery);
  if (result.status === 'ambiguous') {
    return {
      ok: false,
      status: 409,
      error: 'ambiguous session query',
      matches: publicSessionMatches(result.matches),
    };
  }
  if (result.status !== 'ok') {
    return {
      ok: false,
      status: 404,
      error: 'session not found',
      matches: publicSessionMatches(result.matches),
    };
  }

  const sessionFile = findSessionFileForProvider(result.session);
  const transcript = parseSessionTranscriptForProvider(result.session, sessionFile);
  if (!transcript.turns.length) {
    return {
      ok: false,
      status: 422,
      error: 'session has no visible transcript messages',
      session: publicSessionInfo(result.session),
      session_file: sessionFile,
    };
  }

  const snapshot = buildSessionSnapshotMarkdown(result.session, sessionFile, transcript);
  if (options.findOnly) {
    return {
      ok: true,
      intent: 'find',
      session: publicSessionInfo(result.session),
      session_file: sessionFile,
      match_type: result.matchType,
      snapshot: {
        included_turns: snapshot.includedTurns,
        total_turns: snapshot.totalTurns,
        truncated: snapshot.truncated,
      },
    };
  }

  if (isSessionShareWebOutput()) {
    const share = await createSessionShareWebPage(result.session, transcript, snapshot);
    return {
      ok: true,
      intent: 'share',
      output: config.sessionShareOutput,
      session: publicSessionInfo(result.session),
      session_file: sessionFile,
      match_type: result.matchType,
      share,
      snapshot: {
        included_turns: snapshot.includedTurns,
        total_turns: snapshot.totalTurns,
        truncated: snapshot.truncated,
      },
    };
  }

  const doc = await createSessionShareDocument(
    makeProviderSessionShareDocTitle(result.session),
    snapshot.markdown,
  );
  return {
    ok: true,
    intent: 'share',
    output: 'doc',
    session: publicSessionInfo(result.session),
    session_file: sessionFile,
    match_type: result.matchType,
    doc,
    snapshot: {
      included_turns: snapshot.includedTurns,
      total_turns: snapshot.totalTurns,
      truncated: snapshot.truncated,
    },
  };
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
  const provider = String(value.provider || 'codex').trim() === 'claude' ? 'claude' : 'codex';
  if (!sessionId) return false;

  const result = findSessionForProvider(provider, sessionId);
  if (result.status !== 'ok') {
    await replyToLark(event, `生成链接失败：找不到 session ${sessionId}`);
    return true;
  }

  const sessionFile = findSessionFileForProvider(result.session);
  const transcript = parseSessionTranscriptForProvider(result.session, sessionFile);
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
    makeProviderSessionShareDocTitle(result.session),
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

function loadReviewFollowupStore() {
  if (!existsSync(config.reviewFollowupStoreFile)) return { replies: {}, roots: {} };
  try {
    const parsed = tryJson(readFileSync(config.reviewFollowupStoreFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { replies: {}, roots: {} };
    }
    return {
      replies: parsed.replies && typeof parsed.replies === 'object' ? parsed.replies : {},
      roots: parsed.roots && typeof parsed.roots === 'object' ? parsed.roots : {},
    };
  } catch (error) {
    console.error(`[bridge] failed to read review follow-up store: ${error.message}`);
    return { replies: {}, roots: {} };
  }
}

function saveReviewFollowupStore(store) {
  mkdirSync(dirname(config.reviewFollowupStoreFile), { recursive: true });
  writeFileSync(config.reviewFollowupStoreFile, `${JSON.stringify(store, null, 2)}\n`);
}

function reviewFollowupKey(rootMessageId, replyMessageId) {
  return `${rootMessageId || 'unknown'}:${replyMessageId || 'unknown'}`;
}

function getReviewFollowupRoot(rootMessageId) {
  if (!rootMessageId) return null;
  return loadReviewFollowupStore().roots[rootMessageId] || null;
}

function reviewFollowupExistsForReply(rootMessageId, replyMessageId) {
  if (!rootMessageId || !replyMessageId) return false;
  const store = loadReviewFollowupStore();
  return Boolean(store.replies[reviewFollowupKey(rootMessageId, replyMessageId)]);
}

function countReviewFollowupRounds(rootMessageId) {
  if (!rootMessageId) return 0;
  const store = loadReviewFollowupStore();
  return Object.values(store.replies).filter(record => record?.rootMessageId === rootMessageId)
    .length;
}

function updateReviewFollowupRoot(rootMessageId, patch) {
  if (!rootMessageId) return;
  const store = loadReviewFollowupStore();
  store.roots[rootMessageId] = {
    ...(store.roots[rootMessageId] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveReviewFollowupStore(store);
}

function saveReviewFollowupReply(rootMessageId, replyMessageId, patch) {
  const store = loadReviewFollowupStore();
  const key = reviewFollowupKey(rootMessageId, replyMessageId);
  store.replies[key] = {
    ...(store.replies[key] || {}),
    ...patch,
    rootMessageId,
    replyMessageId,
    updatedAt: new Date().toISOString(),
  };
  saveReviewFollowupStore(store);
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

function stripTrailingDraftMetadata(value) {
  const text = String(value || '')
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const metaIndex = text.search(
    /\n\s*(?:证据|依据|参考信息|置信度|confidence|evidence)\s*[：:]/iu,
  );
  return (metaIndex >= 0 ? text.slice(0, metaIndex) : text).trim();
}

function normalizeDirectBotReply(output) {
  const text = clampReply(output);
  const parsed = parseJsonObjectLoose(text);
  const hasDraftFields =
    parsed &&
    ['operation_plan', 'action_plan', 'plan', 'evidence', 'confidence'].some(key =>
      Object.prototype.hasOwnProperty.call(parsed, key),
    );
  const parsedReply = String(parsed?.reply_text || parsed?.reply || parsed?.message || '').trim();
  if (hasDraftFields && parsedReply) return clampReply(parsedReply);

  const wrapperStartPattern =
    /^\s*(?:建议操作|操作计划|行动计划|operation[_\s-]?plan|action[_\s-]?plan)\s*[：:]/iu;
  if (!wrapperStartPattern.test(text)) return text;

  const replyLabelPattern =
    /(?:^|[\r\n])\s*(?:待发送回复|回复内容|reply_text)\s*[：:]\s*([\s\S]+)$/iu;
  const inlineReplyLabelPattern = /(?:待发送回复|回复内容|reply_text)\s*[：:]\s*([\s\S]+)$/iu;
  const match = replyLabelPattern.exec(text) || inlineReplyLabelPattern.exec(text);
  const directReply = stripTrailingDraftMetadata(match?.[1] || '');
  return directReply ? clampReply(directReply) : text;
}

function buildDelegateDraftPrompt(event, rawText) {
  const chatId = extractChatId(event);
  const messageId = extractMessageId(event);
  const requesterId = extractSenderId(event);
  const requesterName = extractSenderName(event) || requesterId || '对方';

  return [
    '你是宋一凡的飞书助理。群里有人 @ 宋一凡，请先替宋一凡想好操作和回复，但绝对不要向群里发送消息。',
    '',
    '你可以使用本机 lark-cli / bytedcli / 文件系统做只读查询。优先读取当前群最近消息，并按需要搜索飞书文档或历史消息。',
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
    '1. 判断对方要宋一凡做什么。',
    '2. 根据群历史、相关文档、文件或上下文找出最可能需要的材料；如果找不到，要明确写“需要人工补充”。',
    '3. 如果对方请求 review/approve MR 或变更，只做只读 review：阅读链接、diff、评论、CI/测试状态和相关上下文，指出风险或确认未发现明显问题；不要直接在代码平台点 approve，除非审批人后续明确确认。',
    '4. 给出建议操作。',
    '5. 写好一段可以发到原消息话题/线程里的回复，不要在回复中伪装成机器人，不要泄露 token/secret。',
    '',
    '只输出一个 JSON 对象，不要输出 Markdown 解释。字段：',
    '{"operation_plan":["..."],"reply_text":"...","evidence":["..."],"confidence":"high|medium|low"}',
  ].join('\n');
}

function buildDelegateReviewAutomationPrompt(event, rawText, mrUrls) {
  const chatId = extractChatId(event);
  const messageId = extractMessageId(event);
  const requesterId = extractSenderId(event);
  const requesterName = extractSenderName(event) || requesterId || '对方';
  const autoApprove = config.delegateReviewAutoApproveEnabled ? '开启' : '关闭';
  const commentOnIssues = config.delegateReviewCommentOnIssues ? '开启' : '关闭';
  const requireCiPass = config.delegateReviewRequireCiPass ? '是' : '否';

  return [
    'MR review 自动化：群里有人 @ 宋一凡或 @ 菌子坦荡荡 review 代码。已配置菌子坦荡荡直接开始 review，不需要再生成待确认草稿。',
    '',
    '你可以使用本机 bytedcli / 文件系统执行代码评审相关操作。除 MR review/comment/approve 之外，不要执行改代码、合入、发布、提单、改配置等其他写操作。不要使用 lark-cli 向飞书群发送或回复消息；bridge 会统一用原消息话题回复通知结果。',
    '硬性限制：不满足 approve 条件时，只能给普通评论或回复问题摘要，不要 disapprove / request changes / 反向审批。',
    `当前群 chat_id：${chatId || 'unknown'}`,
    `原始消息 message_id：${messageId || 'unknown'}`,
    `请求人 open_id：${requesterId || 'unknown'}`,
    `请求人显示名：${requesterName}`,
    `自动 approve 开关：${autoApprove}`,
    `有问题时发 MR comment 开关：${commentOnIssues}`,
    `approve 前是否要求 CI/检查无失败：${requireCiPass}`,
    '',
    '原始群消息：',
    rawText,
    '',
    'MR URL：',
    ...mrUrls.map((url, index) => `${index + 1}. ${url}`),
    '',
    '请按顺序完成：',
    '1. 对每个 MR 使用 bytedcli codebase 查询 MR 详情、diff 文件、关键 diff、现有评论和检查状态；优先用 --json。',
    '2. 做真实代码评审：重点看逻辑 bug、线上风险、兼容性、权限/数据安全、并发/超时、错误处理和测试缺口。不要只看标题。',
    '3. 如果发现问题：若“有问题时发 MR comment 开关”为开启，使用 bytedcli codebase mr review <MR_URL> --comment --body-file <file> 留 MR 级普通评论；只有位置很确定时再使用 draft/publish 行内评论。若开关为关闭，只回复问题摘要，不写代码平台评论。有问题时绝对不要 approve，也不要 disapprove / request changes / 反向审批。',
    '4. 如果没有发现问题：只有在“自动 approve 开关”为开启、置信度 high、MR 未关闭、没有未处理阻塞评论、且检查状态没有失败时，才执行 bytedcli codebase mr review <MR_URL> --approve --body "LGTM，已检查 diff/评论/检查状态。"。如果 CI 无法确认且要求 CI 无失败，则不要 approve，也不要 disapprove / request changes，只回复需要人工确认 CI。',
    '5. 操作完成后，只在最终输出里说明逐个 MR 已评论/已 approve/未操作的原因、评审依据和剩余风险；不要自己回复飞书消息，不要泄露 token/secret/JWT/cookie。',
  ].join('\n');
}

function bridgeReviewRequesterIds() {
  return new Set(
    [
      config.botOpenId,
      config.botAppId,
      ...config.reviewFollowupRequesterIds,
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean),
  );
}

function isBridgeReviewRequester(event) {
  const senderId = extractSenderId(event);
  return senderId && bridgeReviewRequesterIds().has(senderId);
}

function reviewRequestTextLooksActionable(text) {
  const rawText = String(text || '');
  if (shouldTriggerReviewAutomation({
    rawText,
    keywordText: rawText,
    reviewKeywords: config.delegateReviewKeywords,
    allowAiPolishedApproveShorthand: true,
  })) {
    return true;
  }
  if (!extractCodebaseMrUrls(rawText).length) return false;
  return /review|code\s*review|评审|帮忙看|麻烦.*看|看这组\s*MR|看这组MR|MR\s*[:：]/i.test(
    rawText,
  );
}

function isBridgeReviewRequestMessage(chatId, message) {
  const event = listedMessageToEvent(chatId, message);
  if (!isBridgeReviewRequester(event)) return false;
  return reviewRequestTextLooksActionable(extractText(event));
}

function messageThreadReplies(message) {
  const candidates = [
    ...(Array.isArray(message?.thread_replies) ? message.thread_replies : []),
    ...(Array.isArray(message?.threadReplies) ? message.threadReplies : []),
    ...(Array.isArray(message?.replies) ? message.replies : []),
  ];
  const deduped = new Map();
  for (const reply of candidates) {
    const id = reply?.message_id || reply?.id || '';
    if (!id) continue;
    if (!deduped.has(id)) deduped.set(id, reply);
  }
  return [...deduped.values()];
}

function isBridgeSelfSenderId(senderId) {
  return senderId && bridgeReviewRequesterIds().has(senderId);
}

function reviewerMentionText(event) {
  const senderId = extractSenderId(event);
  const senderName = extractSenderName(event) || senderId || 'reviewer';
  if (isMentionableUserOpenId(senderId)) return `<at user_id="${senderId}">${senderName}</at>`;
  if (senderName && !senderName.startsWith('cli_')) return `@${senderName}`;
  return senderName;
}

function shouldHandleReviewFollowupReply(replyEvent, replyText) {
  const senderId = extractSenderId(replyEvent);
  if (!senderId || isBridgeSelfSenderId(senderId)) return false;
  if (config.reviewFollowupReviewerSenderIds.length) {
    return config.reviewFollowupReviewerSenderIds.includes(senderId);
  }
  if (!isKnownBotSender(replyEvent)) return false;
  return String(replyText || '').trim().length > 0;
}

function normalizeReviewFollowupResult(output) {
  const parsed = parseJsonObjectLoose(output) || {};
  const action = String(parsed.action || parsed.status || '').trim().toLowerCase();
  return {
    approved:
      parsed.approved === true ||
      ['approved', 'approve', 'lgtm', 'noop_approved', 'no_changes'].includes(action),
    needsChanges:
      parsed.needs_changes === true ||
      ['changes_required', 'fixed', 'pushed', 're_review_requested'].includes(action),
    changed: parsed.changed === true,
    pushed: parsed.pushed === true,
    action,
    raw: output,
  };
}

function buildReviewFollowupPrompt(rootEvent, rootText, replyEvent, replyText, options = {}) {
  const rootMessageId = extractMessageId(rootEvent);
  const replyMessageId = extractMessageId(replyEvent);
  const chatId = extractChatId(rootEvent);
  const mrUrls = extractCodebaseMrUrls(rootText);
  const reviewer = reviewerMentionText(replyEvent);
  const round = options.round || 1;

  return [
    'Reviewer 回复闭环自动化：菌子坦荡荡之前在群里 @ 其他智能体 review 代码，现在收到了 reviewer 的回复。',
    '',
    '你的任务是判断 reviewer 回复是否要求改代码。如果需要改，就修复、验证、提交、push，然后在同一个话题里重新 @ 同一个 reviewer 复审；如果 reviewer 已 approve / LGTM / 没有问题，就不要回复群里，只输出 JSON 结果给 bridge 记录。',
    '',
    `当前工作目录：${config.codexCwd}`,
    `群 chat_id：${chatId || 'unknown'}`,
    `review 请求原消息 message_id：${rootMessageId || 'unknown'}`,
    `reviewer 回复 message_id：${replyMessageId || 'unknown'}`,
    `reviewer sender_id：${extractSenderId(replyEvent) || 'unknown'}`,
    `reviewer 显示名：${extractSenderName(replyEvent) || 'unknown'}`,
    `复审轮次：${round}/${config.reviewFollowupMaxRounds}`,
    '',
    '原 review 请求：',
    rootText,
    '',
    'reviewer 回复：',
    replyText,
    '',
    'MR URL：',
    ...mrUrls.map((url, index) => `${index + 1}. ${url}`),
    '',
    '严格规则：',
    '1. 如果 reviewer 回复只是授权卡片、排队状态、无关聊天、无法判断是否有代码问题，先不要改代码、不要回复群里，只输出 {"action":"noop","approved":false,"needs_changes":false,"reason":"..."}。',
    '2. 如果 reviewer 回复表达 approve、LGTM、通过、没问题、无需修改，绝对不要回复群里，只输出 {"action":"approved","approved":true,"needs_changes":false,"reason":"..."}。',
    '3. 如果 reviewer 提出明确问题或修改建议：定位对应 MR 和本地仓库，只改相关文件；不要覆盖用户未提交的无关改动，不要 stage 无关文件。',
    '4. 修复后运行与改动相关的最小充分验证；失败要继续修到通过。提交信息遵守仓库 AGENTS.md / Lore Commit Protocol；push 到 MR 的 source branch。',
    '5. push 成功后，用 bot 身份回复原 review 请求的话题，重新 @ reviewer，请它复审。命令形态：',
    `lark-cli im +messages-reply --as bot --message-id ${rootMessageId || '<root_message_id>'} --reply-in-thread --text "${reviewer} 已按反馈修复并推送，麻烦再 review 一下。\\n\\n修复摘要：<summary>\\n验证：<tests>\\nMR：<links>" --idempotency-key review-followup-${rootMessageId || 'root'}-${replyMessageId || 'reply'}-${round}`,
    '6. 如果需要改但因为权限、冲突、测试环境、MR 状态等原因无法完成，不要假装已修复；回复原话题说明 blocker，并输出 JSON 标记 blocked。',
    '',
    '最后只输出一个 JSON 对象给 bridge 记录，不要附 Markdown。字段：',
    '{"action":"approved|noop|changes_required|fixed|blocked","approved":false,"needs_changes":false,"changed":false,"pushed":false,"summary":"...","tests":"...","reason":"..."}',
  ].join('\n');
}

async function createReviewFollowupAutomation(rootEvent, rootText, replyEvent, replyText, round) {
  const rootMessageId = extractMessageId(rootEvent);
  const replyMessageId = extractMessageId(replyEvent);
  const id = `follow-${shortApprovalId()}`;
  saveReviewFollowupReply(rootMessageId, replyMessageId, {
    id,
    status: 'running',
    createdAt: new Date().toISOString(),
    chatId: extractChatId(rootEvent),
    reviewerSenderId: extractSenderId(replyEvent),
    reviewerName: extractSenderName(replyEvent),
    round,
    requestText: rootText,
    replyText,
    mrUrls: extractCodebaseMrUrls(rootText),
  });
  updateReviewFollowupRoot(rootMessageId, {
    status: 'running',
    round,
    lastReplyMessageId: replyMessageId,
  });
  console.error(
    `[bridge] review follow-up ${id} starting for root ${rootMessageId}, reply ${replyMessageId}`,
  );

  const prompt = buildReviewFollowupPrompt(rootEvent, rootText, replyEvent, replyText, { round });
  const progress = config.reviewFollowupProgressCardEnabled
    ? await createProgressReporter(rootEvent, ['review follow-up', replyMessageId || 'unknown'].join('\n'))
    : null;
  try {
    const output = await buildReply(prompt, { progress });
    const result = normalizeReviewFollowupResult(output);
    saveReviewFollowupReply(rootMessageId, replyMessageId, {
      status: 'done',
      completedAt: new Date().toISOString(),
      result,
      resultText: output,
    });
    if (result.approved) {
      updateReviewFollowupRoot(rootMessageId, {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        lastReplyMessageId: replyMessageId,
      });
    }
    if (progress) await progress.finish(output);
    console.error(`[bridge] review follow-up ${id} completed`);
  } catch (error) {
    saveReviewFollowupReply(rootMessageId, replyMessageId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: String(error?.stack || error?.message || error),
    });
    updateReviewFollowupRoot(rootMessageId, {
      status: 'failed',
      lastReplyMessageId: replyMessageId,
      error: String(error?.message || error),
    });
    if (progress) await progress.fail(error.message || error);
    throw error;
  }
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

function buildSensitiveOperationApprovalCard(approval) {
  const labels = Array.isArray(approval.sensitiveLabels) && approval.sensitiveLabels.length
    ? approval.sensitiveLabels.join('、')
    : '疑似非只读操作';
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'orange',
      title: {
        tag: 'plain_text',
        content: '需要你确认本机操作',
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**请求人**：${approval.requesterName || approval.requesterOpenId || '未知'}`,
            `**来源群**：${approval.chatId || 'unknown'}`,
            `**请求 ID**：${approval.id}`,
            `**风险类型**：${labels}`,
          ].join('\n'),
        },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**原消息**\n${clampCardText(approval.requestText, 1200)}`,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `确认前不会启动 Codex 执行；只有宋一凡本人点击按钮有效。按钮不可用时，在本话题 @机器人回复：同意执行 ${approval.id} / 取消执行 ${approval.id}`,
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
              content: '同意执行',
            },
            value: {
              bridge_action: 'sensitive_approve',
              approval_id: approval.id,
            },
          },
          {
            tag: 'button',
            type: 'danger',
            text: {
              tag: 'plain_text',
              content: '拒绝',
            },
            value: {
              bridge_action: 'sensitive_cancel',
              approval_id: approval.id,
            },
          },
        ],
      },
    ],
  };
}

async function sendSensitiveOperationApprovalRequest(approval) {
  const card = buildSensitiveOperationApprovalCard(approval);
  const approvalEvent = eventFromApproval(approval);
  try {
    await sendCardToLark(approvalEvent, card, `sensitive-card-${approval.id}`);
    return { target: 'thread', type: 'card' };
  } catch (error) {
    console.error(`[bridge] failed to send sensitive approval card in thread, falling back to text: ${error.message}`);
  }

  const fallbackText = [
    `有人请求操作你的电脑，等待你确认。请求 ID：${approval.id}`,
    '',
    `请求人：${approval.requesterName || approval.requesterOpenId || '未知'}`,
    `来源群：${approval.chatId || 'unknown'}`,
    `风险类型：${(approval.sensitiveLabels || []).join('、') || '疑似非只读操作'}`,
    '',
    '原消息：',
    approval.requestText,
    '',
    `同意请在本话题回复：同意执行 ${approval.id}`,
    `取消请在本话题回复：取消执行 ${approval.id}`,
  ].join('\n');

  try {
    await replyToLark(approvalEvent, fallbackText, {
      idempotencyKey: `sensitive-text-${approval.id}`,
    });
    return { target: 'thread', type: 'text' };
  } catch (error) {
    console.error(`[bridge] failed to send sensitive approval text in thread, falling back to p2p: ${error.message}`);
  }

  await runCli([
    'im',
    '+messages-send',
    '--as',
    'bot',
    '--user-id',
    approval.approverOpenId,
    '--text',
    fallbackText,
    '--idempotency-key',
    `sensitive-p2p-text-${approval.id}`,
  ]);
  return { target: 'p2p', type: 'text' };
}

async function createSensitiveOperationApproval(event, rawText, classification) {
  if (!config.delegateApproverOpenId) {
    await replyToLark(
      event,
      '这个请求涉及非只读操作，但当前没有配置审批人，已拒绝执行。',
      { idempotencyKey: `sensitive-rejected-${extractMessageId(event) || randomUUID()}` },
    );
    return;
  }

  const id = `op-${shortApprovalId()}`;
  const approval = {
    id,
    kind: 'sensitive_operation',
    status: 'pending',
    createdAt: new Date().toISOString(),
    approverOpenId: config.delegateApproverOpenId,
    chatId: extractChatId(event),
    chatType: extractChatType(event),
    originalMessageId: extractMessageId(event),
    requesterOpenId: extractSenderId(event),
    requesterSenderType: extractSenderType(event),
    requesterName: extractSenderName(event),
    requestText: rawText,
    sensitiveLabels: classification.labels,
    executionKind: classification.executionKind,
  };
  saveApproval(approval);
  const delivery = await sendSensitiveOperationApprovalRequest(approval);
  if (delivery?.target !== 'thread') {
    await replyToLark(
      event,
      `这个请求涉及非只读操作，已发给宋一凡确认；确认前不会执行。请求 ID：${id}`,
      { idempotencyKey: `sensitive-pending-${id}` },
    );
  }
  console.error(`[bridge] sensitive operation ${id} awaiting approval for message ${approval.originalMessageId}`);
}

function snapshotEventForApproval(event) {
  return {
    type: event?.type || '',
    message_id: extractMessageId(event) || '',
    id: extractMessageId(event) || extractEventId(event) || '',
    chat_id: extractChatId(event) || '',
    chat_type: extractChatType(event) || '',
    content: extractText(event) || '',
    sender_id: extractSenderId(event) || '',
    sender_type: extractSenderType(event) || '',
    sender_name: extractSenderName(event) || '',
    mentions: Array.isArray(event?.mentions) ? event.mentions : [],
  };
}

async function createReviewFollowupApproval(rootEvent, rootText, replyEvent, replyText, round) {
  if (!config.delegateApproverOpenId) {
    console.error('[bridge] review follow-up requires owner approval but no approver is configured');
    return;
  }

  const rootMessageId = extractMessageId(rootEvent);
  const replyMessageId = extractMessageId(replyEvent);
  const id = `op-${shortApprovalId()}`;
  const approval = {
    id,
    kind: 'sensitive_operation',
    status: 'pending',
    createdAt: new Date().toISOString(),
    approverOpenId: config.delegateApproverOpenId,
    chatId: extractChatId(rootEvent),
    chatType: extractChatType(rootEvent),
    originalMessageId: replyMessageId || rootMessageId,
    requesterOpenId: extractSenderId(replyEvent),
    requesterSenderType: extractSenderType(replyEvent),
    requesterName: extractSenderName(replyEvent),
    requestText: replyText,
    sensitiveLabels: ['Reviewer 回复闭环自动化可能改代码、提交或 push'],
    executionKind: 'review_followup',
    reviewFollowup: {
      rootMessageId,
      replyMessageId,
      rootText,
      replyText,
      round,
      rootEvent: snapshotEventForApproval(rootEvent),
      replyEvent: snapshotEventForApproval(replyEvent),
    },
  };
  saveApproval(approval);
  saveReviewFollowupReply(rootMessageId, replyMessageId, {
    id,
    status: 'awaiting_owner_approval',
    createdAt: new Date().toISOString(),
    chatId: extractChatId(rootEvent),
    reviewerSenderId: extractSenderId(replyEvent),
    reviewerName: extractSenderName(replyEvent),
    round,
    requestText: rootText,
    replyText,
    mrUrls: extractCodebaseMrUrls(rootText),
  });
  await sendSensitiveOperationApprovalRequest(approval);
  console.error(`[bridge] review follow-up ${id} awaiting owner approval for reply ${replyMessageId}`);
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
  const nonOwnerContext = createNonOwnerCodexExecutionContext(config);
  let draftOutput = '';
  try {
    draftOutput = await buildReply(
      `${buildDelegateDraftPrompt(event, rawText)}\n${nonOwnerGuardNotice(config, nonOwnerContext)}`,
      {
        sandbox: nonOwnerContext.sandbox,
        cwd: nonOwnerContext.cwd,
      },
    );
  } finally {
    nonOwnerContext.cleanup();
  }
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

async function createDelegateReviewAutomation(event, rawText) {
  const id = `rev-${shortApprovalId()}`;
  const mrUrls = extractCodebaseMrUrls(rawText);
  const record = {
    id,
    kind: 'mr_review_automation',
    status: 'running',
    createdAt: new Date().toISOString(),
    chatId: extractChatId(event),
    originalMessageId: extractMessageId(event),
    requesterOpenId: extractSenderId(event),
    requesterSenderType: extractSenderType(event),
    requesterName: extractSenderName(event),
    requestText: rawText,
    mrUrls,
  };
  saveApproval(record);
  console.error(`[bridge] delegate review automation ${id} starting for message ${record.originalMessageId}`);

  const prompt = buildDelegateReviewAutomationPrompt(event, rawText, mrUrls);
  const progress = config.delegateReviewProgressCardEnabled
    ? await createProgressReporter(event, ['MR review 自动化', ...mrUrls].join('\n'))
    : null;
  try {
    const output = await buildReply(prompt, { progress });
    updateApproval(id, {
      status: 'done',
      completedAt: new Date().toISOString(),
      resultText: output,
    });
    console.error(`[bridge] delegate review automation ${id} completed`);
    if (progress) await progress.finish(output);
    if (config.delegateReviewReplyToGroup) {
      await replyToLark(event, output || '已完成 review 自动化，但 Codex 没有返回文本。');
    }
  } catch (error) {
    updateApproval(id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: String(error?.stack || error?.message || error),
    });
    if (progress) await progress.fail(error.message || error);
    throw error;
  }
}

function parseApprovalCommand(rawText) {
  const text = stripBridgeTraceText(stripBotMentionText(rawText)).trim();
  const match = /^(同意发送|确认发送|发送|同意执行|确认执行|执行|approve|\/approve|取消发送|拒绝发送|取消执行|拒绝执行|cancel|\/cancel)\s+([A-Za-z0-9_-]+)\s*$/i.exec(
    text,
  );
  if (!match) return null;
  const verb = match[1].toLowerCase();
  return {
    action:
      verb === '取消发送' ||
      verb === '拒绝发送' ||
      verb === '取消执行' ||
      verb === '拒绝执行' ||
      verb === 'cancel' ||
      verb === '/cancel'
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

function eventFromApproval(approval) {
  return {
    type: 'approval.sensitive_operation',
    message_id: approval.originalMessageId || '',
    id: approval.originalMessageId || approval.id || '',
    chat_id: approval.chatId || '',
    chat_type: approval.chatType || 'group',
    content: approval.requestText || '',
    sender_id: approval.requesterOpenId || '',
    sender_type: approval.requesterSenderType || '',
    sender_name: approval.requesterName || '',
  };
}

function buildDirectCodexPrompt(event, rawText, options = {}) {
  const trace = extractBridgeTrace(rawText);
  const promptBase = config.prefix ? rawText.slice(config.prefix.length).trim() : rawText;
  const prompt = stripBotMentionText(stripBridgeTraceText(promptBase));
  const nonOwnerQueryNotice = options.nonOwnerQuery ? nonOwnerGuardNotice(config, options) : '';
  const profilePromptContext = String(options.profilePromptContext || '').trim();
  const memoryPromptContext = String(options.memoryPromptContext || '').trim();
  const approvalNotice = options.approvedBy
    ? `\n安全审批：这个非只读请求已经由 ${options.approvedBy} 通过 bridge 卡片确认，可以按原请求执行。`
    : '';
  const eventContext = [
    '飞书事件上下文：',
    `chat_id=${extractChatId(event) || 'unknown'}`,
    `chat_type=${extractChatType(event) || 'unknown'}`,
    `message_id=${extractMessageId(event) || 'unknown'}`,
    `sender_id=${extractSenderId(event) || 'unknown'}`,
    `sender_type=${extractSenderType(event) || 'unknown'}`,
    `context_key=${options.contextKey || contextKeyForBridgeEvent(event)}`,
    '',
    '当前处理模式：直接 @机器人 / 私聊机器人，bridge 会把你的最终回答原样发回飞书。',
    '回复格式要求：直接写给提问者；不要套用“建议操作 / 待发送回复 / 操作计划 / 草稿”等代理审批包装。',
    profilePromptContext,
    memoryPromptContext,
    nonOwnerQueryNotice,
    approvalNotice,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    trace,
    prompt,
    codexPrompt: `${eventContext}\n\n${prompt || stripBridgeTraceText(rawText)}`,
  };
}

async function executeDirectCodexTask(event, rawText, options = {}) {
  let nonOwnerContext = null;
  const executionOptions = { ...options };
  const contextKey = executionOptions.contextKey || contextKeyForBridgeEvent(event);
  const startedAt = Date.now();
  const abortController = new AbortController();
  const unregisterStop = stopRegistry.register(contextKey, abortController);
  if (executionOptions.nonOwnerQuery) {
    nonOwnerContext = createNonOwnerCodexExecutionContext(config, {
      realWorkspace: executionOptions.realWorkspace || executionOptions.cwd || config.codexCwd,
    });
    executionOptions.cwd = nonOwnerContext.cwd;
    executionOptions.realWorkspace = nonOwnerContext.realWorkspace;
    executionOptions.sandbox = executionOptions.sandbox || nonOwnerContext.sandbox;
  }

  if (stopRegistry.isCancelled(contextKey, startedAt)) {
    await replyToLark(event, '这条请求已被 /stop 取消，没有启动 Codex。');
    if (nonOwnerContext) nonOwnerContext.cleanup();
    unregisterStop();
    return { ok: false, error: 'cancelled before start' };
  }

  const { trace, prompt, codexPrompt } = buildDirectCodexPrompt(event, rawText, executionOptions);
  const progress = options.progress === false
    ? null
    : await createProgressReporter(event, prompt || stripBridgeTraceText(rawText));
  emitPet('task_started', { contextKey, text: prompt || stripBridgeTraceText(rawText) });
  try {
    const reply = await buildReply(codexPrompt, {
      progress,
      sandbox: executionOptions.sandbox || config.codexSandbox,
      cwd: executionOptions.cwd || config.codexCwd,
      contextKey,
      signal: abortController.signal,
    });
    const finalReply = normalizeDirectBotReply(reply);
    if (progress) await progress.finish(finalReply);
    emitPet('task_done', { contextKey, text: finalReply });
    recordThreadMemoryIfEnabled(event, rawText, finalReply, executionOptions);
    recordMemoryCandidatesIfEnabled(event, rawText, finalReply);
    if (config.progressCardFinalReply || !progress) {
      await replyToLark(
        event,
        trace ? appendBridgeTrace(finalReply, nextTrace(trace)) : finalReply,
        options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {},
      );
    }
    return { ok: true };
  } catch (error) {
    if (abortController.signal.aborted || error?.name === 'AbortError') {
      console.error(`[bridge] direct task stopped in ${contextKey}: ${error.message || error}`);
      if (progress) await progress.fail('任务已停止。');
      emitPet('task_failed', { contextKey, text: '任务已停止', reason: 'stopped' });
      await replyToLark(
        event,
        '任务已停止。',
        options.idempotencyKey ? { idempotencyKey: `${options.idempotencyKey}-stopped` } : {},
      );
      return { ok: false, error: 'stopped' };
    }
    console.error(`[bridge] ${error.stack || error.message}`);
    if (progress) await progress.fail(error.message || error);
    emitPet('task_failed', { contextKey, text: String(error?.message || error), reason: 'error' });
    await replyToLark(
      event,
      `执行失败：${clampReply(error.message || error)}`,
      options.idempotencyKey ? { idempotencyKey: `${options.idempotencyKey}-failed` } : {},
    );
    return { ok: false, error: String(error?.stack || error?.message || error) };
  } finally {
    unregisterStop();
    if (nonOwnerContext) nonOwnerContext.cleanup();
  }
}

async function executeDirectCodexTaskQueued(event, rawText, options = {}) {
  if (!config.contextQueueEnabled) return executeDirectCodexTask(event, rawText, options);

  const contextKey = contextKeyForBridgeEvent(event);
  const result = directTaskQueue.dispatch({ event, rawText, options, contextKey }, {
    front: options.queueFront,
  });
  if (result.status === 'queued' && options.queuedByCommand) {
    await replyToLark(
      event,
      `已加入当前上下文队列，位置：${result.position}。`,
      { idempotencyKey: `queue-ack-${extractMessageId(event) || randomUUID()}` },
    );
  }
  await result.done;
  return { ok: true, queued: result.status === 'queued' };
}

async function handleStopCommand(event) {
  if (!isBridgeOwnerEvent(event)) {
    await replyToLark(event, '只有 bridge owner 可以停止当前上下文的 Codex 任务。');
    return true;
  }
  const contextKey = contextKeyForBridgeEvent(event);
  const cancelled = stopRegistry.cancel(contextKey, `Bridge stop requested by ${extractSenderId(event) || 'unknown'}`);
  const cleared = directTaskQueue.clearQueued(contextKey);
  await replyToLark(
    event,
    [
      '已处理 /stop。',
      `context: ${contextKey}`,
      `已中断运行中任务：${cancelled.aborted}`,
      `已清空排队任务：${cleared}`,
    ].join('\n'),
    { idempotencyKey: `stop-${extractMessageId(event) || randomUUID()}` },
  );
  return true;
}

function readCurrentOncallBindings() {
  return readOncallBindings(config.oncallBindingsFile);
}

function oncallExecutionOptionsForEvent(event, requesterIsOwner) {
  const binding = getOncallBinding(readCurrentOncallBindings(), extractChatId(event));
  if (!binding) return {};
  if (requesterIsOwner) return { cwd: binding.cwd, oncallCwd: binding.cwd };
  return { realWorkspace: binding.cwd, oncallCwd: binding.cwd };
}

async function handleOncallCommand(event, command, requesterIsOwner) {
  const chatId = extractChatId(event);
  if (!chatId) {
    await replyToLark(event, '当前事件没有 chat_id，无法操作 oncall 绑定。');
    return true;
  }

  if (command.action === 'help') {
    await replyToLark(event, [
      'Oncall commands:',
      '/oncall bind <path> - 绑定当前群/会话到本机项目目录（owner only）',
      '/oncall status - 查看当前绑定',
      '/oncall unbind - 解绑当前群/会话（owner only）',
    ].join('\n'));
    return true;
  }

  const bindings = readCurrentOncallBindings();
  if (command.action === 'status') {
    const binding = getOncallBinding(bindings, chatId);
    await replyToLark(event, binding
      ? [
          '当前 oncall 绑定：',
          `chat_id: ${chatId}`,
          `cwd: ${binding.cwd}`,
          binding.ownerOpenId ? `owner: ${binding.ownerOpenId}` : '',
        ].filter(Boolean).join('\n')
      : `当前 chat 未绑定 oncall 项目。\nchat_id: ${chatId}`);
    return true;
  }

  if (!requesterIsOwner) {
    await replyToLark(event, '只有 bridge owner 可以修改 oncall 绑定。');
    return true;
  }

  if (command.action === 'unbind') {
    writeOncallBindings(config.oncallBindingsFile, clearOncallBinding(bindings, chatId));
    await replyToLark(event, `已解绑当前 oncall chat。\nchat_id: ${chatId}`);
    return true;
  }

  if (command.action === 'bind') {
    const cwd = normalizeOncallPath(command.path, { cwd: process.cwd() });
    if (!existsSync(cwd)) {
      await replyToLark(event, `绑定失败：目录不存在。\n${cwd}`);
      return true;
    }
    if (!statSync(cwd).isDirectory()) {
      await replyToLark(event, `绑定失败：目标不是目录。\n${cwd}`);
      return true;
    }
    const next = setOncallBinding(bindings, chatId, {
      cwd,
      ownerOpenId: extractSenderId(event),
    });
    writeOncallBindings(config.oncallBindingsFile, next);
    await replyToLark(event, [
      '已绑定当前 oncall chat。',
      `chat_id: ${chatId}`,
      `cwd: ${cwd}`,
      'owner 请求会直接在该目录运行；非 owner 请求仍在一次性 scratch 中执行，只把该目录作为只读真实工作区上下文。',
    ].join('\n'));
    return true;
  }

  return false;
}

function evaluateDirectProfilePolicy(event, rawText, requesterIsOwner) {
  const promptText = stripBotMentionText(stripBridgeTraceText(rawText));
  const result = evaluateProfilePolicy(
    profilePolicy,
    {
      chatId: extractChatId(event),
      chatType: extractChatType(event),
      senderId: extractSenderId(event),
    },
    promptText,
    { isOwner: requesterIsOwner },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    options: result.enabled
      ? {
          profilePromptContext: result.promptContext,
          profileActor: result.actor,
          profileId: result.profile?.id || '',
          capabilityId: result.capability?.id || '',
        }
      : {},
  };
}

function memoryRouteForEvent(event, rawText) {
  return resolveMemoryRoute(
    config,
    {
      chatId: extractChatId(event),
      chatType: extractChatType(event),
      senderId: extractSenderId(event),
      messageId: extractMessageId(event),
      threadId: findStringDeep(event, ['thread_id', 'threadId']),
      rootId: findStringDeep(event, ['root_id', 'rootId']),
      parentId: findStringDeep(event, ['parent_id', 'parentId']),
    },
    rawText,
  );
}

function memoryPromptContextForEvent(event, rawText) {
  if (!config.memoryEnabled) return '';
  const route = memoryRouteForEvent(event, rawText);
  const bundle = readVisibleMemoryBundle(config, route);
  return buildMemoryPromptContext(bundle, config.memoryPromptBudgetChars);
}

function memoryOptionsForEvent(event, rawText) {
  const memoryPromptContext = memoryPromptContextForEvent(event, rawText);
  return memoryPromptContext ? { memoryPromptContext } : {};
}

function formatVisibleMemoryForEvent(event, rawText) {
  const route = memoryRouteForEvent(event, rawText);
  const bundle = readVisibleMemoryBundle(config, route);
  const text = buildMemoryPromptContext(bundle, config.memoryPromptBudgetChars);
  return text || '当前上下文没有可见记忆。';
}

async function handleMemoryCommand(event, command, rawText) {
  if (!config.memoryEnabled) {
    await replyToLark(event, 'Memory 当前未启用。设置 MEMORY_ENABLED=1 后可用。');
    return true;
  }

  const actor = isBridgeOwnerEvent(event) ? 'owner' : 'member';
  const allowed = canWriteMemory(command, actor);
  if (!allowed.ok) {
    await replyToLark(event, allowed.message || '没有权限操作记忆。');
    return true;
  }

  const route = memoryRouteForEvent(event, rawText);
  const paths = memoryPaths(config.memoryRootDir, route);
  if (command.action === 'show') {
    await replyToLark(event, formatVisibleMemoryForEvent(event, rawText));
    return true;
  }
  if (command.action === 'pending') {
    await replyToLark(event, formatMemoryCandidates(readMemoryCandidates(
      config.memoryRootDir,
      route,
      config.memoryPendingLimit,
    )));
    return true;
  }
  if (command.action === 'approve') {
    const result = approveMemoryCandidates(config.memoryRootDir, route, command.selector);
    await replyToLark(event, formatMemoryCandidateResolution('已批准', result.selected));
    return true;
  }
  if (command.action === 'reject') {
    const result = rejectMemoryCandidates(config.memoryRootDir, route, command.selector);
    await replyToLark(event, formatMemoryCandidateResolution('已拒绝', result.selected));
    return true;
  }
  if (command.action === 'compact') {
    const result = compactMemoryRoute({
      rootDir: config.memoryRootDir,
      route,
      scope: command.scope,
      maxTextChars: config.memoryCompactMaxTextChars,
      maxJsonlRecords: config.memoryCompactMaxJsonlRecords,
    });
    await replyToLark(event, formatMemoryCompactResult(command.scope, result));
    return true;
  }

  if (command.scope === 'global') {
    const file = join(paths.globalDir, 'preferences.md');
    const existing = readTextFile(file, '').trim();
    writeTextFile(file, `${existing ? `${existing}\n` : ''}- ${command.text}\n`);
  } else if (command.scope === 'project') {
    if (!route.projectId) {
      await replyToLark(event, '没有识别到 project_id，无法写入项目记忆。请在消息里包含 repo/MR/activity 锚点，或配置 MEMORY_DEFAULT_PROJECT_ID。');
      return true;
    }
    appendJsonl(join(paths.projectDir, 'decisions.jsonl'), {
      text: command.text,
      source: 'manual',
      updatedBy: extractSenderId(event),
    });
  } else {
    appendJsonl(join(paths.chatDir, 'decisions.jsonl'), {
      text: command.text,
      source: 'manual',
      updatedBy: extractSenderId(event),
    });
  }

  await replyToLark(event, `已写入 ${command.scope} 记忆。`);
  return true;
}

function formatMemoryCandidates(candidates) {
  if (!candidates.length) return '当前上下文没有待审批记忆候选。';
  return [
    '待审批记忆候选：',
    ...candidates.map(candidate => [
      `- id: ${candidate.id}`,
      `  scope: ${candidate.scope || 'chat'}`,
      `  type: ${candidate.type || 'decision'}`,
      candidate.projectId ? `  project: ${candidate.projectId}` : '',
      `  text: ${candidate.text}`,
    ].filter(Boolean).join('\n')),
    '',
    '用法：/memory-approve <id|all> 或 /memory-reject <id|all>',
  ].join('\n');
}

function formatMemoryCandidateResolution(prefix, candidates) {
  if (!candidates.length) return '没有匹配的待审批记忆候选。';
  return [
    `${prefix} ${candidates.length} 条记忆候选：`,
    ...candidates.map(candidate => `- ${candidate.id}: ${candidate.text}`),
  ].join('\n');
}

function formatMemoryCompactResult(scope, result) {
  if (!result.length) return `已完成 ${scope} 记忆压缩。`;
  const changed = result.filter(item => item.before !== item.after);
  return [
    `已完成 ${scope} 记忆压缩。`,
    `处理文件：${result.length}`,
    `发生变化：${changed.length}`,
  ].join('\n');
}

function recordThreadMemoryIfEnabled(event, rawText, finalReply, options = {}) {
  if (!shouldAutoWriteThreadSummary(config, options.profileActor || (isBridgeOwnerEvent(event) ? 'owner' : 'member'))) {
    return;
  }
  const route = memoryRouteForEvent(event, rawText);
  appendThreadExchange({
    rootDir: config.memoryRootDir,
    chatId: route.chatId,
    threadId: route.threadId,
    userText: stripBotMentionText(stripBridgeTraceText(rawText)),
    assistantText: finalReply,
    maxChars: config.memoryThreadMaxChars,
  });
}

function recordMemoryCandidatesIfEnabled(event, rawText, finalReply) {
  if (!config.memoryEnabled || !config.memoryExtractorEnabled) return;
  const route = memoryRouteForEvent(event, rawText);
  const sourceMessageId = extractMessageId(event);
  const sourceText = [
    stripBotMentionText(stripBridgeTraceText(rawText)),
    finalReply,
  ].join('\n');
  const candidates = extractMemoryCandidates(sourceText, {
    source: 'thread-extractor',
    confidence: 'medium',
  });
  for (const candidate of candidates) {
    appendMemoryCandidate(config.memoryRootDir, route, {
      ...candidate,
      scope: route.projectId ? 'project' : 'chat',
      sourceMessageId,
    });
  }
}

async function executeApprovedSensitiveOperation(approval, operatorOpenId) {
  const event = eventFromApproval(approval);
  const executionKind = approval.executionKind || 'direct_codex';

  if (executionKind === 'bot_send') {
    const command = parseBotSendCommand(approval.requestText, event);
    if (!command) throw new Error('审批通过后解析发送给机器人命令失败');
    const confirmation = await sendBotMessage(command);
    await replyToLark(event, confirmation, { idempotencyKey: `sensitive-approved-${approval.id}` });
    return { ok: true };
  }

  if (executionKind === 'session_share') {
    const command = parseSessionShareCommand(approval.requestText);
    if (!command) throw new Error('审批通过后解析 session 分享命令失败');
    await handleSessionShareCommand(event, command);
    return { ok: true };
  }

  if (executionKind === 'review_automation') {
    await createDelegateReviewAutomation(event, approval.requestText);
    return { ok: true };
  }

  if (executionKind === 'review_followup') {
    const followup = approval.reviewFollowup || {};
    await createReviewFollowupAutomation(
      followup.rootEvent || event,
      followup.rootText || approval.requestText,
      followup.replyEvent || event,
      followup.replyText || '',
      followup.round || 1,
    );
    return { ok: true };
  }

  return executeDirectCodexTaskQueued(event, approval.requestText, {
    approvedBy: operatorOpenId,
    sandbox: config.codexSandbox,
    idempotencyKey: `sensitive-approved-${approval.id}`,
  });
}

async function handleSensitiveOperationDecision(approval, command, operatorOpenId, respond) {
  if (command.action === 'cancel') {
    updateApproval(command.id, {
      status: 'cancelled',
      decidedAt: new Date().toISOString(),
      decidedBy: operatorOpenId,
    });
    await replyToLark(
      eventFromApproval(approval),
      `宋一凡已拒绝执行这个非只读请求：${command.id}`,
      { idempotencyKey: `sensitive-cancel-${command.id}` },
    ).catch(error => {
      console.error(`[bridge] failed to notify sensitive cancellation: ${error.message}`);
    });
    await respond(`已拒绝执行：${command.id}`);
    return;
  }

  updateApproval(command.id, {
    status: 'running',
    decidedAt: new Date().toISOString(),
    decidedBy: operatorOpenId,
  });
  await respond(`已同意执行：${command.id}，开始处理。`);
  const result = await executeApprovedSensitiveOperation(approval, operatorOpenId);
  updateApproval(command.id, {
    status: result.ok ? 'done' : 'failed',
    completedAt: new Date().toISOString(),
    decidedBy: operatorOpenId,
    error: result.error || '',
  });
  await respond(result.ok ? `执行完成：${command.id}` : `执行失败：${command.id}`);
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

  if (approval.kind === 'sensitive_operation') {
    await handleSensitiveOperationDecision(approval, command, operatorOpenId, respond);
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
  if (
    !id ||
    !['delegate_approve', 'delegate_cancel', 'sensitive_approve', 'sensitive_cancel'].includes(action)
  ) {
    return;
  }

  const operatorOpenId = extractCardOperatorOpenId(event);
  await handleApprovalDecision(
    {
      id,
      action: action === 'delegate_cancel' || action === 'sensitive_cancel' ? 'cancel' : 'approve',
    },
    operatorOpenId,
    async message => {
      const targetOpenId = operatorOpenId || config.delegateApproverOpenId;
      if (targetOpenId) {
        await runCli([
          'im',
          '+messages-send',
          '--as',
          'bot',
          '--user-id',
          targetOpenId,
          '--text',
          message,
          '--idempotency-key',
          `delegate-action-${id}-${action}-${randomUUID()}`,
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

async function pollReviewFollowupsInChat(chatId, messages, now = Date.now()) {
  if (!config.reviewFollowupEnabled) return;

  for (const message of [...messages].reverse()) {
    const rootMessageId = message?.message_id || '';
    if (!rootMessageId) continue;

    const rootState = getReviewFollowupRoot(rootMessageId);
    if (rootState?.status === 'approved') continue;

    const rootCreatedAt = parseMessageTimeMs(message);
    if (rootCreatedAt && now - rootCreatedAt > config.reviewFollowupMaxAgeMs) continue;
    if (!isBridgeReviewRequestMessage(chatId, message)) continue;

    const rootEvent = listedMessageToEvent(chatId, message);
    const rootText = extractText(rootEvent).trim();
    const replies = messageThreadReplies(message);
    for (const reply of replies) {
      const replyMessageId = reply?.message_id || reply?.id || '';
      if (!replyMessageId || reviewFollowupExistsForReply(rootMessageId, replyMessageId)) {
        continue;
      }
      if (reply?.deleted || reply?.is_deleted || reply?.isDeleted) continue;

      const replyEvent = listedMessageToEvent(chatId, reply);
      replyEvent.type = 'poll.review_followup_reply';
      const replyText = extractText(replyEvent).trim();
      const replyCreatedAt = parseMessageTimeMs(reply);
      if (replyCreatedAt && now - replyCreatedAt > config.reviewFollowupMaxAgeMs) continue;
      if (!shouldHandleReviewFollowupReply(replyEvent, replyText)) continue;

      const round = countReviewFollowupRounds(rootMessageId) + 1;
      if (round > config.reviewFollowupMaxRounds) {
        updateReviewFollowupRoot(rootMessageId, {
          status: 'max_rounds_reached',
          round: round - 1,
          lastReplyMessageId: replyMessageId,
        });
        continue;
      }

      await createReviewFollowupApproval(rootEvent, rootText, replyEvent, replyText, round);
    }
  }
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

  await pollReviewFollowupsInChat(chatId, messages, now);

  for (const message of [...messages].reverse()) {
    const messageId = message?.message_id || '';
    if (!messageId || seenMessages.has(messageId) || approvalExistsForMessage(messageId)) continue;

    const event = listedMessageToEvent(chatId, message);
    const rawText = extractText(event).trim();
    if (!rawText) continue;

    const createdAt = parseMessageTimeMs(message);
    if (createdAt && now - createdAt > config.delegatePollMaxAgeMs) continue;
    if (createdAt && createdAt < bridgeStartedAtMs - config.delegatePollIntervalMs) continue;

    if (await shouldHandleDelegateMention(event, rawText)) {
      seenMessages.add(messageId);
      console.error(`[bridge] delegate poll matched message ${messageId} in ${chatId}`);
      try {
        await reactToLarkMessage(event, rawText);
        console.error(`[bridge] delegate poll reacted to message ${messageId}`);
      } catch (error) {
        console.error(`[bridge] failed to add reaction for polled message: ${error.message}`);
      }
      if (shouldHandleDelegateReviewAutomation(rawText)) {
        await createSensitiveOperationApproval(
          event,
          rawText,
          classifyDirectExecution(rawText, { reviewAutomation: true }),
        );
      } else {
        await createDelegateDraft(event, rawText);
      }
      continue;
    }

    // Recover direct @bot messages when the websocket subscription drops an event.
    if (await shouldHandleEvent(event, rawText)) {
      console.error(`[bridge] direct poll matched message ${messageId} in ${chatId}`);
      try {
        await handleEvent(event);
      } catch (error) {
        console.error(`[bridge] direct poll failed for message ${messageId}: ${error.stack || error.message}`);
      }
    }
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

async function buildReply(prompt, options = {}) {
  const result = await backendRunner.run(prompt, options);
  return result.text || '后端执行完成，但没有返回文本。';
}

function runCli(args, stdin = '', options = {}) {
  return runProcess(config.larkCliBin, args, { stdin, ...options }).then(({ stdout }) => stdout);
}

function bridgeVersion() {
  return packageInfo().version;
}

function uptimeSec() {
  return Math.max(0, Math.round((Date.now() - bridgeStartedAtMs) / 1000));
}

function bridgeHealthPayload() {
  return {
    ok: true,
    mode: config.mode,
    event_enabled: config.eventEnabled,
    codex_cwd: config.codexCwd,
    version: bridgeVersion(),
    pid: process.pid,
    uptime_sec: uptimeSec(),
    codex_sandbox: config.codexSandbox,
    codex_non_owner_sandbox: config.codexNonOwnerSandbox,
    backend_runner: backendRunner.id,
    backend_label: backendRunner.label,
    codex_runner: backendRunner.id,
    codex_runtime: config.codexRuntime,
    session_share_output: config.sessionShareOutput,
    context_queue_enabled: config.contextQueueEnabled,
    context_queue_active: directTaskQueue.activeTotal(),
    context_queue_queued: directTaskQueue.queuedTotal(),
    stop_registry_active: stopRegistry.activeTotal(),
    profile_policy_enabled: profilePolicy.enabled,
    profile_policy_loaded: profilePolicy.loaded,
    profile_config_file: profilePolicy.path,
    memory_enabled: config.memoryEnabled,
    memory_root_dir: config.memoryRootDir,
    memory_extractor_enabled: config.memoryExtractorEnabled,
    memory_pending_limit: config.memoryPendingLimit,
    startup_checks: startupChecks,
  };
}

function bridgeHealthText() {
  return formatHealthReport({
    timeIso: new Date().toISOString(),
    version: bridgeVersion(),
    pid: process.pid,
    uptimeSec: uptimeSec(),
    mode: config.mode,
    eventEnabled: config.eventEnabled,
    httpHost: config.httpHost,
    httpPort: config.httpPort,
    codexCwd: config.codexCwd,
    codexSandbox: config.codexSandbox,
    codexNonOwnerSandbox: config.codexNonOwnerSandbox,
    backendRunner: backendRunner.id,
    backendLabel: backendRunner.label,
    codexRunner: backendRunner.id,
    codexRuntime: config.codexRuntime,
    sessionShareOutput: config.sessionShareOutput,
    contextQueueEnabled: config.contextQueueEnabled,
    contextQueueActive: directTaskQueue.activeTotal(),
    contextQueueQueued: directTaskQueue.queuedTotal(),
    profilePolicyEnabled: profilePolicy.enabled,
    profilePolicyLoaded: profilePolicy.loaded,
    profileConfigFile: profilePolicy.path,
    memoryEnabled: config.memoryEnabled,
    memoryRootDir: config.memoryRootDir,
    memoryExtractorEnabled: config.memoryExtractorEnabled,
    memoryPendingLimit: config.memoryPendingLimit,
    startupChecks,
  });
}

function bridgeVersionText() {
  return formatVersionReport({
    version: bridgeVersion(),
    pid: process.pid,
    uptimeSec: uptimeSec(),
  });
}

function readLastLogLines(file, lines = 30) {
  const limit = Math.max(1, lines);
  if (!existsSync(file)) return `日志文件不存在：${file}`;
  const text = readFileSync(file, 'utf8');
  return text.split(/\r?\n/).slice(-limit).join('\n').trim() || '(日志为空)';
}

async function handleOpsCommand(event, command) {
  if (!isBridgeOwnerEvent(event)) {
    await replyToLark(event, '只有 bridge owner 可以执行 bridge ops 命令。');
    return true;
  }
  if (extractChatType(event) !== 'p2p' && !eventMentionsBot(event) && !textMentionsBot(extractText(event))) {
    return false;
  }

  if (command.action === 'help') {
    await replyToLark(event, formatOpsHelp());
    return true;
  }
  if (command.action === 'version') {
    await replyToLark(event, bridgeVersionText());
    return true;
  }
  if (command.action === 'health') {
    await replyToLark(event, bridgeHealthText());
    return true;
  }
  if (command.action === 'logs') {
    await replyToLark(
      event,
      [
        `Bridge logs: ${config.bridgeLogFile}`,
        '',
        readLastLogLines(config.bridgeLogFile, command.lines),
      ].join('\n').slice(0, 3500),
    );
    return true;
  }
  return false;
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
      '/v1/codex/session-shares': {
        post: {
          operationId: 'createCodexSessionShare',
          summary: 'Create a session-share snapshot. Defaults to Codex; pass provider=claude for Claude.',
          security: config.httpToken ? [{ bearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    session_id: {
                      type: 'string',
                      description: 'Session id or id prefix.',
                    },
                    provider: {
                      type: 'string',
                      enum: ['codex', 'claude'],
                      description: 'Session provider. Defaults to codex.',
                    },
                    query: {
                      type: 'string',
                      description: 'Session title, project path, content query, or recent/current hint.',
                    },
                    find_only: {
                      type: 'boolean',
                      description: 'Return metadata without exporting a share.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Session-share result',
            },
            400: {
              description: 'Bad request',
            },
            401: {
              description: 'Unauthorized',
            },
            403: {
              description: 'Session-share export disabled',
            },
            404: {
              description: 'Session not found',
            },
            409: {
              description: 'Ambiguous session query',
            },
            500: {
              description: 'Export failed',
            },
          },
        },
      },
      '/v1/sessions/session-shares': {
        post: {
          operationId: 'createSessionShare',
          summary: 'Create a Codex or Claude session-share snapshot',
          security: config.httpToken ? [{ bearerAuth: [] }] : [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: {
                      type: 'string',
                      enum: ['codex', 'claude'],
                    },
                    session_id: {
                      type: 'string',
                    },
                    query: {
                      type: 'string',
                    },
                    find_only: {
                      type: 'boolean',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Session-share result',
            },
            400: {
              description: 'Bad request',
            },
            401: {
              description: 'Unauthorized',
            },
            403: {
              description: 'Session-share export disabled',
            },
            404: {
              description: 'Session not found',
            },
            409: {
              description: 'Ambiguous session query',
            },
            500: {
              description: 'Export failed',
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
    jsonResponse(response, 200, bridgeHealthPayload());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/openapi.json') {
    jsonResponse(response, 200, openApiSpec(request));
    return;
  }

  if (request.method === 'GET' && serveSessionSharePage(url, response)) {
    return;
  }

  if (request.method === 'GET' && url.pathname === '/pet/state') {
    if (!petBus) {
      jsonResponse(response, 404, { ok: false, error: 'pet sync disabled' });
      return;
    }
    jsonResponse(response, 200, { ok: true, ...petBus.getState() });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/pet/events') {
    if (!petBus) {
      jsonResponse(response, 404, { ok: false, error: 'pet sync disabled' });
      return;
    }
    handlePetEventStream(response);
    return;
  }

  if (request.method !== 'POST') {
    jsonResponse(response, 404, { ok: false, error: 'not found' });
    return;
  }

  if (!isAuthorized(request)) {
    jsonResponse(response, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (url.pathname === '/v1/codex/session-shares' || url.pathname === '/v1/sessions/session-shares') {
      const query = String(body.session_id || body.sessionId || body.query || '').trim();
      const provider = String(body.provider || 'codex').trim().toLowerCase();
      const result = await createSessionShareFromQuery(query, {
        provider: provider === 'claude' ? 'claude' : 'codex',
        findOnly: Boolean(body.find_only || body.findOnly),
      });
      jsonResponse(response, result.ok ? 200 : result.status || 500, result);
      return;
    }

    if (url.pathname !== '/v1/codex/tasks') {
      jsonResponse(response, 404, { ok: false, error: 'not found' });
      return;
    }

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

// Server-Sent Events stream for the local desktop pet. Pushes every pet event
// as it happens; replays the last few so a freshly-connected pet catches up.
function handlePetEventStream(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  response.write(': connected\n\n');
  const send = event => {
    try {
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client gone; cleanup runs on close */
    }
  };
  const unsubscribe = petBus.subscribe(send, { replay: 5 });
  const heartbeat = setInterval(() => {
    try {
      response.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 15000);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  response.on('close', cleanup);
  response.on('error', cleanup);
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

async function runDoctor() {
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

  if (config.mode === 'claude') {
    const claude = checkCommand(config.claudeCodeBin);
    report(claude.ok ? 'ok' : 'fail', `Claude Code CLI (${config.claudeCodeBin}): ${claude.detail}`);
  }

  if (config.mode === 'coco') {
    const bytedcli = checkCommand(config.bytedCliBin);
    report(bytedcli.ok ? 'ok' : 'fail', `bytedcli for Coco (${config.bytedCliBin}): ${bytedcli.detail}`);
    report(
      ['chat', 'task'].includes(config.cocoRunMode) ? 'ok' : 'fail',
      `COCO_RUN_MODE=${config.cocoRunMode}`,
    );
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

  if (!SUPPORTED_RUNNERS.map(normalizeRunnerId).includes(config.mode)) {
    report('fail', `Unsupported bridge backend: ${config.mode}`);
  }

  if (config.mode === 'codex') {
    const appServerCheck = await checkCodexAppServerSteerSupport({
      codexBin: config.codexBin,
      runProcess,
    });
    startupChecks = [appServerCheck];
    report(
      appServerCheck.ok ? 'ok' : 'warn',
      `Codex app-server steer preflight: ${appServerCheck.detail}`,
    );
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
      ...(config.delegateReplyInThread ? ['--reply-in-thread'] : []),
      '--idempotency-key',
      idempotencyKey,
    ]);
    return extractSentMessageId(stdout);
  }

  const chatId = extractChatId(event);
  if (!chatId) throw new Error('event has neither message_id nor chat_id');
  if (config.delegateReplyInThread && extractChatType(event) !== 'p2p') {
    throw new Error('refusing to send group card without original message_id for thread reply');
  }
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

async function createProgressReporter(event, prompt) {
  if (!config.progressCardEnabled || config.mode === 'jwt-check') return null;
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
      emitPet('task_progress', { text });
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

async function replyToLark(event, text, options = {}) {
  const sendReply = async baseArgs => {
    if (!config.replyMarkdownEnabled) {
      await runCli([...baseArgs, '--text', text]);
      return;
    }

    try {
      await runCli([...baseArgs, '--markdown', closeUnclosedCodeFence(String(text || ''))]);
    } catch (error) {
      console.error(`[bridge] failed to send markdown reply, falling back to text: ${error.message}`);
      await runCli([...baseArgs, '--text', text]);
    }
  };

  const messageId = extractMessageId(event);
  if (messageId) {
    await sendReply([
      'im',
      '+messages-reply',
      '--as',
      'bot',
      '--message-id',
      messageId,
      ...(config.delegateReplyInThread ? ['--reply-in-thread'] : []),
      '--idempotency-key',
      options.idempotencyKey || `bridge-${messageId}`,
    ]);
    emitPet('lark_reply_sent', { text, chatId: extractChatId(event) });
    return;
  }

  const chatId = extractChatId(event);
  if (!chatId) throw new Error('event has neither message_id nor chat_id');
  if (config.delegateReplyInThread && extractChatType(event) !== 'p2p') {
    throw new Error('refusing to send group reply without original message_id for thread reply');
  }
  await sendReply([
    'im',
    '+messages-send',
    '--as',
    'bot',
    '--chat-id',
    chatId,
    '--idempotency-key',
    options.idempotencyKey || `bridge-${randomUUID()}`,
  ]);
  emitPet('lark_reply_sent', { text, chatId });
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
  if (approvalCommand && (extractChatType(event) === 'p2p' || isApprovalOwnerEvent(event))) {
    let approvalResponseCount = 0;
    await handleApprovalDecision(approvalCommand, extractSenderId(event), async message => {
      approvalResponseCount += 1;
      await replyToLark(event, message, {
        idempotencyKey: `approval-command-${approvalCommand.id}-${approvalCommand.action}-${approvalResponseCount}`,
      });
    });
    return;
  }

  const opsCommand = parseOpsCommand(stripBotMentionText(rawText));
  if (opsCommand && await handleOpsCommand(event, opsCommand)) {
    return;
  }

  const memoryCommand = parseMemoryCommand(stripBotMentionText(rawText));
  if (memoryCommand && await handleMemoryCommand(event, memoryCommand, rawText)) {
    return;
  }

  if (await shouldHandleDelegateMention(event, rawText)) {
    try {
      await reactToLarkMessage(event, rawText);
    } catch (error) {
      console.error(`[bridge] failed to add reaction: ${error.stack || error.message}`);
    }
    try {
      if (shouldHandleDelegateReviewAutomation(rawText)) {
        const reviewClassification = classifyDirectExecution(rawText, { reviewAutomation: true });
        if (
          !isReviewAutomationOnlySensitive(reviewClassification) ||
          !canExecuteReviewAutomationDirectly(event, rawText)
        ) {
          await createSensitiveOperationApproval(
            event,
            rawText,
            reviewClassification,
          );
          return;
        }
        await createDelegateReviewAutomation(event, rawText);
      } else {
        await createDelegateDraft(event, rawText);
      }
    } catch (error) {
      console.error(`[bridge] delegate handling failed: ${error.stack || error.message}`);
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

  emitPet('lark_message_received', {
    text: rawText,
    sender: extractSenderId(event),
    chatId: extractChatId(event),
  });

  const requesterIsOwner = isBridgeOwnerEvent(event);
  const controlText = stripBotMentionText(stripBridgeTraceText(rawText));
  const oncallCommand = parseOncallCommand(controlText);
  if (oncallCommand && await handleOncallCommand(event, oncallCommand, requesterIsOwner)) {
    return;
  }

  if (isStopCommand(controlText)) {
    await handleStopCommand(event);
    return;
  }

  const queueCommand = parseQueueCommand(controlText);
  if (queueCommand) {
    if (!queueCommand.text) {
      await replyToLark(event, '用法：/queue <要排队给 Codex 的消息>');
      return;
    }
    const profileDecision = evaluateDirectProfilePolicy(event, queueCommand.text, requesterIsOwner);
    if (!profileDecision.ok) {
      if (!profileDecision.silent && profileDecision.message) {
        await replyToLark(event, profileDecision.message);
      }
      return;
    }
    const oncallOptions = oncallExecutionOptionsForEvent(event, requesterIsOwner);
    await executeDirectCodexTaskQueued(
      event,
      queueCommand.text,
      requesterIsOwner
        ? {
            ...oncallOptions,
            ...profileDecision.options,
            ...memoryOptionsForEvent(event, queueCommand.text),
            queuedByCommand: true,
          }
        : {
            ...oncallOptions,
            ...profileDecision.options,
            ...memoryOptionsForEvent(event, queueCommand.text),
            queuedByCommand: true,
            nonOwnerQuery: true,
            sandbox: config.codexNonOwnerSandbox,
          },
    );
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

  const reviewAutomation = shouldHandleDelegateReviewAutomation(rawText);
  const classification = classifyDirectExecution(rawText, {
    botSendCommand,
    sessionShareCommand,
    reviewAutomation,
  });
  const canRunSensitiveDirectly =
    requesterIsOwner ||
    (
      reviewAutomation &&
      isReviewAutomationOnlySensitive(classification) &&
      canExecuteReviewAutomationDirectly(event, rawText)
    );

  if (classification.sensitive && !canRunSensitiveDirectly) {
    await createSensitiveOperationApproval(event, rawText, classification);
    return;
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

  if (reviewAutomation) {
    await createDelegateReviewAutomation(event, rawText);
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

  const profileDecision = evaluateDirectProfilePolicy(event, rawText, requesterIsOwner);
  if (!profileDecision.ok) {
    if (!profileDecision.silent && profileDecision.message) {
      await replyToLark(event, profileDecision.message);
    }
    return;
  }

  const oncallOptions = oncallExecutionOptionsForEvent(event, requesterIsOwner);
  await executeDirectCodexTaskQueued(
    event,
    rawText,
    requesterIsOwner
      ? {
          ...oncallOptions,
          ...profileDecision.options,
          ...memoryOptionsForEvent(event, rawText),
        }
      : {
          ...oncallOptions,
          ...profileDecision.options,
          ...memoryOptionsForEvent(event, rawText),
          nonOwnerQuery: true,
          sandbox: config.codexNonOwnerSandbox,
        },
  );
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

function startStartupChecks() {
  if (config.mode !== 'codex') return;
  checkCodexAppServerSteerSupport({
    codexBin: config.codexBin,
    runProcess,
  })
    .then(check => {
      startupChecks = [check];
      console.error(`[bridge] startup check ${check.id}: ${check.state} - ${check.detail}`);
    })
    .catch(error => {
      startupChecks = [{
        id: 'codex-app-server-steer',
        label: 'Codex app-server steer',
        state: 'fail',
        ok: false,
        detail: String(error?.message || error).slice(0, 240),
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      }];
      console.error(`[bridge] startup check failed: ${error.stack || error.message || error}`);
    });
}

async function main() {
  if (cli.command === 'doctor') {
    await runDoctor();
    return;
  }

  console.error(
    `[bridge] starting, mode=${config.mode}, eventEnabled=${config.eventEnabled}, httpPort=${config.httpPort || 'off'}`,
  );
  startStartupChecks();
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

main().catch(error => {
  console.error(`[bridge] fatal: ${error.stack || error.message || error}`);
  process.exit(1);
});
