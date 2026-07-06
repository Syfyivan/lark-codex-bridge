import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const DEFAULT_MAX_CONTEXT_CHARS = 9000;

export const defaultProjectBindingsConfig = {
  version: 1,
  chats: {},
};

export function loadProjectBindings(input = {}) {
  const {
    configFile = '',
    exists = existsSync,
    readFile = readFileSync,
  } = input;

  if (!configFile || !exists(configFile)) {
    return {
      loaded: false,
      path: configFile,
      config: defaultProjectBindingsConfig,
      chats: {},
    };
  }

  const parsed = JSON.parse(readFile(configFile, 'utf8'));
  validateProjectBindingsConfig(parsed, configFile);
  const chats = Object.fromEntries(
    Object.entries(parsed.chats || {}).map(([chatId, binding]) => [
      chatId,
      normalizeProjectBinding(chatId, binding),
    ]),
  );
  return {
    loaded: true,
    path: configFile,
    config: parsed,
    chats,
  };
}

export function validateProjectBindingsConfig(config, configPath = 'project-bindings.json') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${configPath}: project bindings config must be an object`);
  }
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`${configPath}: unsupported version`);
  }
  if (!config.chats || typeof config.chats !== 'object' || Array.isArray(config.chats)) {
    throw new Error(`${configPath}: chats must be an object`);
  }
  for (const [chatId, binding] of Object.entries(config.chats)) {
    validateProjectBinding(chatId, binding, configPath);
  }
}

function validateProjectBinding(chatId, binding, configPath) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new Error(`${configPath}: chat ${chatId} binding must be an object`);
  }
  for (const field of ['project', 'cwd', 'memory_file', 'todo_file', 'roadmap_file']) {
    if (typeof binding[field] !== 'string' || !binding[field].trim()) {
      throw new Error(`${configPath}: chat ${chatId} missing ${field}`);
    }
  }
  for (const field of ['allowed_actions', 'requires_owner_approval']) {
    if (!Array.isArray(binding[field]) || binding[field].some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error(`${configPath}: chat ${chatId} ${field} must be a string array`);
    }
  }
  if (binding.github_repo !== undefined && typeof binding.github_repo !== 'string') {
    throw new Error(`${configPath}: chat ${chatId} github_repo must be a string`);
  }
}

export function normalizeProjectBinding(chatId, binding) {
  const project = binding.project.trim();
  return {
    chatId,
    project,
    projectId: normalizeProjectId(binding.project_id || binding.project || basename(binding.cwd || project)),
    cwd: binding.cwd.trim(),
    memoryFile: binding.memory_file.trim(),
    todoFile: binding.todo_file.trim(),
    roadmapFile: binding.roadmap_file.trim(),
    allowedActions: uniqueStrings(binding.allowed_actions),
    requiresOwnerApproval: uniqueStrings(binding.requires_owner_approval),
    githubRepo: String(binding.github_repo || '').trim(),
    raw: binding,
  };
}

export function resolveProjectBinding(projectBindings, input = {}) {
  const chatId = input.chatId || input.chat_id || '';
  return chatId ? projectBindings?.chats?.[chatId] || null : null;
}

export function validateProjectBindingSources(binding, input = {}) {
  if (!binding) return [];
  const exists = input.exists || existsSync;
  const stat = input.stat || statSync;
  const missing = [];
  if (!exists(binding.cwd)) {
    missing.push(`cwd ${binding.cwd}`);
  } else {
    try {
      if (!stat(binding.cwd).isDirectory()) missing.push(`cwd ${binding.cwd}`);
    } catch {
      missing.push(`cwd ${binding.cwd}`);
    }
  }
  for (const [label, file] of [
    ['project memory', binding.memoryFile],
    ['TODO', binding.todoFile],
    ['roadmap', binding.roadmapFile],
  ]) {
    if (!exists(file)) missing.push(`${label} ${file}`);
  }
  return missing;
}

export function shouldLookupGroupContext(text, binding = {}) {
  const raw = String(text || '');
  if (/刚才群里|群里刚才|刚刚群里|上面那个|前面那个|刚发的|刚才的|按刚才|继续那个|继续这个|这个链接|那个链接|这个仓库|那个仓库|这个项目|那个项目/iu.test(raw)) {
    return true;
  }
  if (!binding.githubRepo && /(?:github|git\s*hub|仓库|repo|repository|代码地址|项目地址|链接)/iu.test(raw)) {
    return true;
  }
  return false;
}

export function buildProjectPromptContext(binding, input = {}) {
  const readFile = input.readFile || readFileSync;
  const maxChars = Math.max(1200, Number(input.maxChars || DEFAULT_MAX_CONTEXT_CHARS));
  const taskText = String(input.taskText || '').trim();
  const memory = readProjectMemory(binding.memoryFile, readFile);
  const todo = readTextSafe(binding.todoFile, readFile);
  const roadmap = readTextSafe(binding.roadmapFile, readFile);
  const v01 = firstVersion(memory, 'V0.1') || {};
  const context = [
    'Project binding context:',
    `project: ${binding.project}`,
    `project_id: ${binding.projectId}`,
    `project_root: ${binding.cwd}`,
    `chat_id: ${binding.chatId}`,
    `source_memory: ${binding.memoryFile}`,
    `source_todo: ${binding.todoFile}`,
    `source_roadmap: ${binding.roadmapFile}`,
    binding.githubRepo ? `github_repo: ${binding.githubRepo}` : '',
    '',
    'Routing rule:',
    `- This Lark chat is bound to ${binding.project}; run project work with cwd=${binding.cwd}.`,
    '- Treat project memory, TODO, and roadmap files as the primary facts. Chat messages are supplemental context only.',
    '- Do not default to CODEX_CWD when this binding is valid.',
    '',
    'Allowed local actions:',
    renderList(binding.allowedActions),
    '',
    'Actions requiring owner approval:',
    renderList(binding.requiresOwnerApproval),
    '',
    'Current project positioning:',
    textFrom(memory.project?.product_positioning, memory.project?.non_goal_warning),
    '',
    'Current version route:',
    renderVersionRoute(memory.version_plan, roadmap),
    '',
    'Current V0.1 deliverables / exit criteria:',
    renderV01(v01, todo),
    '',
    'Immediate next tasks:',
    renderList(memory.immediate_next_tasks?.length ? memory.immediate_next_tasks : extractCheckboxItems(sectionBetween(todo, /## Immediate Next Tasks/iu), 8)),
    '',
    'Safety boundaries:',
    renderList([
      ...(memory.architecture_principles || []).filter(item => /policy|guard|risky|pause|audit|authorize|purchase|购买|审批|风险/iu.test(item)),
      'Never place raw marketplace passwords, tokens, cookies, or credentials in code, logs, or group replies.',
      'Real purchase, payment, production deploy, GitHub push, repository permission changes, and destructive delete require owner approval.',
    ]),
    '',
    'Group collaboration rules:',
    renderCollaboration(memory.collaboration_protocol),
    '',
    'Group message lookup policy:',
    renderGroupLookupPolicy(taskText, binding),
  ].filter(Boolean).join('\n');

  return clampContext(context, maxChars);
}

function readProjectMemory(file, readFile) {
  const raw = readTextSafe(file, readFile);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw_summary: raw.slice(0, 1600) };
  }
}

function readTextSafe(file, readFile) {
  try {
    return String(readFile(file, 'utf8') || '');
  } catch {
    return '';
  }
}

function firstVersion(memory, version) {
  return (memory?.version_plan || []).find(item => String(item.version || '').toLowerCase() === version.toLowerCase());
}

function renderVersionRoute(versionPlan = [], roadmap = '') {
  const items = Array.isArray(versionPlan) && versionPlan.length
    ? versionPlan.slice(0, 4).map(item => `${item.version} - ${item.name}: ${item.status || 'unknown'}; ${item.goal || ''}`)
    : extractHeadings(roadmap, /^## V\d+\.\d+/imu, 4);
  return renderList(items);
}

function renderV01(v01, todo) {
  const todoV01 = sectionBetween(todo, /### V0\.1\b/iu, /### V0\.2\b/iu);
  const deliverables = extractCheckboxItems(sectionBetween(todoV01, /Deliverables:/iu, /Exit criteria:/iu), 10);
  const exitCriteria = extractCheckboxItems(sectionBetween(todoV01, /Exit criteria:/iu), 8);
  const rows = [];
  if (v01?.goal) rows.push(`Goal: ${v01.goal}`);
  if (deliverables.length) rows.push('Deliverables:\n' + renderList(deliverables));
  if (exitCriteria.length) rows.push('Exit criteria:\n' + renderList(exitCriteria));
  return rows.join('\n') || 'No V0.1 details found.';
}

function renderCollaboration(protocol = {}) {
  if (!protocol || typeof protocol !== 'object') return 'No collaboration protocol found.';
  return renderList([
    protocol.default_interaction,
    protocol.memory_write_policy,
    protocol.operation_policy,
    protocol.message_mirroring,
  ].filter(Boolean));
}

function renderGroupLookupPolicy(taskText, binding) {
  return [
    '- Do not read the latest 50 group messages by default.',
    '- Read group history only when the user explicitly references recent chat context, a just-posted link/repo, unresolved words such as “这个/那个/按刚才的/继续那个”, or when a missing GitHub repo URL is required.',
    `- This task ${shouldLookupGroupContext(taskText, binding) ? 'may need' : 'does not appear to need'} group-history lookup based on the current wording.`,
  ].join('\n');
}

function sectionBetween(text, startPattern, endPattern = null) {
  const raw = String(text || '');
  const start = raw.search(startPattern);
  if (start < 0) return '';
  const rest = raw.slice(start);
  if (!endPattern) return rest;
  const end = rest.slice(1).search(endPattern);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function extractCheckboxItems(text, maxItems = 8) {
  return String(text || '')
    .split('\n')
    .map(line => line.replace(/^\s*[-*]\s+\[[ xX-]\]\s*/, '').trim())
    .filter(line => line && !/^#+\s/.test(line) && !/^(Deliverables|Exit criteria):$/iu.test(line))
    .slice(0, maxItems);
}

function extractHeadings(text, pattern, maxItems = 4) {
  const result = [];
  for (const match of String(text || '').matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
    result.push(match[0].replace(/^#+\s*/, '').trim());
    if (result.length >= maxItems) break;
  }
  return result;
}

function renderList(items) {
  const values = uniqueStrings(items);
  return values.length ? values.map(item => `- ${item}`).join('\n') : '- none';
}

function textFrom(...values) {
  return values.map(value => String(value || '').trim()).filter(Boolean).join('\n');
}

function uniqueStrings(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map(item => String(item || '').trim())
    .filter(item => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function clampContext(text, maxChars) {
  const raw = String(text || '').trim();
  return raw.length > maxChars
    ? `${raw.slice(0, Math.max(0, maxChars - 32)).trim()}\n<project_context_truncated>`
    : raw;
}

export function normalizeProjectId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .slice(0, 160);
}
