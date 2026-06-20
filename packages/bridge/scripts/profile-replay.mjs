#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildMemoryPromptContext } from '../src/memory-prompt.mjs';
import { readVisibleMemoryBundle, resolveMemoryRoute } from '../src/memory-router.mjs';
import {
  evaluateProfilePolicy,
  loadProfilePolicy,
} from '../src/profile-policy.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.fixture) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const fixtureDir = resolve(args.fixture);
const fixture = readFixture(fixtureDir);
const chatId = args.chatId || fixture.event.chatId || fixture.event.chat_id || 'oc_shadow_profile_replay';
const chatType = args.chatType || fixture.event.chatType || fixture.event.chat_type || 'group';
const senderId = args.senderId || fixture.event.senderId || fixture.event.sender_id || 'ou_shadow_member';
const question = args.question || fixture.question || '';
const profileId = args.profile || fixture.profile || '';
if (!question) throw new Error('missing --question or fixture question');
if (!profileId) throw new Error('missing --profile or fixture profile');

const profileConfigFile = resolve(fixtureDir, args.profileConfig || 'profiles.json');
const policy = loadProfilePolicy({
  enabled: true,
  configFile: profileConfigFile,
});
if (!policy.loaded) throw new Error(`profile config not found: ${profileConfigFile}`);
policy.config.chats = {
  ...(policy.config.chats || {}),
  [chatId]: { profile: profileId },
};

const event = {
  chatId,
  chatType,
  senderId,
  messageId: args.messageId || fixture.event.messageId || fixture.event.message_id || 'mid_shadow_profile_replay',
  threadId: args.threadId || fixture.event.threadId || fixture.event.thread_id || 'thread_shadow_profile_replay',
};
const profileDecision = evaluateProfilePolicy(policy, event, question, {
  isOwner: flagEnabled(args.owner),
});

const memoryConfig = {
  memoryRootDir: resolve(fixtureDir, args.memoryRoot || 'memory'),
  baseSoulFile: resolve(fixtureDir, args.baseSoulFile || 'souls/base.md'),
  memoryDefaultProjectId: args.projectId || fixture.projectId || '',
  memoryJsonlItemLimit: Number(args.memoryJsonlItemLimit || fixture.memoryJsonlItemLimit || 8),
};
const route = resolveMemoryRoute(memoryConfig, event, question);
const memoryBundle = readVisibleMemoryBundle(memoryConfig, route);
const memoryPromptContext = buildMemoryPromptContext(memoryBundle, Number(args.memoryBudget || fixture.memoryBudget || 12_000));
const promptContext = buildReplayPrompt({
  event,
  question,
  profilePromptContext: profileDecision.promptContext || '',
  memoryPromptContext,
});
const expected = readOptionalJson(resolve(fixtureDir, args.expected || 'expected.json'), {});
const checks = runChecks({
  profileDecision,
  memoryBundle,
  promptContext,
  expected,
});
const result = {
  ok: profileDecision.ok && checks.ok,
  profile: profileDecision.profile?.id || '',
  capability: profileDecision.capability?.id || '',
  actor: profileDecision.actor || '',
  route,
  memoryBlocks: memoryBundle.entries.map(entry => entry.label),
  checks,
  prompt: args.mode === 'prompt' || flagEnabled(args.includePrompt) ? promptContext : undefined,
};

if (args.mode === 'prompt' && !flagEnabled(args.json)) {
  console.log(promptContext);
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (args.mode === 'check' && !result.ok) process.exit(1);

function buildReplayPrompt(input) {
  const { event, question, profilePromptContext, memoryPromptContext } = input;
  return [
    '飞书事件上下文：',
    `chat_id=${event.chatId}`,
    `chat_type=${event.chatType}`,
    `message_id=${event.messageId}`,
    `sender_id=${event.senderId}`,
    `context_key=${event.threadId || event.chatId}`,
    '',
    '当前处理模式：profile replay / shadow product group fixture，不会向真实飞书群发送消息。',
    '回复格式要求：直接写给提问者；不要套用“建议操作 / 待发送回复 / 操作计划 / 草稿”等代理审批包装。',
    profilePromptContext,
    memoryPromptContext,
    '',
    question,
  ].filter(Boolean).join('\n');
}

function runChecks(input) {
  const failures = [];
  const prompt = input.promptContext;
  if (!input.profileDecision.ok) failures.push(input.profileDecision.message || input.profileDecision.reason || 'profile denied');
  for (const item of input.expected.requiredPromptSubstrings || []) {
    if (!prompt.includes(item)) failures.push(`missing required prompt substring: ${item}`);
  }
  for (const item of input.expected.forbiddenPromptSubstrings || []) {
    if (prompt.includes(item)) failures.push(`found forbidden prompt substring: ${item}`);
  }
  for (const item of input.expected.requiredMemoryBlocks || []) {
    if (!input.memoryBundle.entries.some(entry => entry.label === item)) {
      failures.push(`missing memory block: ${item}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    requiredPromptSubstrings: input.expected.requiredPromptSubstrings || [],
    forbiddenPromptSubstrings: input.expected.forbiddenPromptSubstrings || [],
    requiredMemoryBlocks: input.expected.requiredMemoryBlocks || [],
  };
}

function readFixture(dir) {
  if (!existsSync(dir)) throw new Error(`fixture directory not found: ${dir}`);
  return readOptionalJson(join(dir, 'fixture.json'), {});
}

function readOptionalJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const parsed = { mode: 'check' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) parsed[key] = '1';
      else {
        parsed[key] = next;
        index += 1;
      }
    }
  }
  return parsed;
}

function flagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function printHelp() {
  console.log(`Usage:
  node scripts/profile-replay.mjs --fixture <dir> --profile <profile_id> --question <text> [--mode check|prompt] [--json]

Examples:
  node scripts/profile-replay.mjs --fixture test/fixtures/profile-replay/product-group-lottery-progress --mode check
  node scripts/profile-replay.mjs --fixture test/fixtures/profile-replay/product-group-lottery-progress --profile engineering_group_test --question "这个需求落代码先看哪里？" --mode prompt
`);
}
