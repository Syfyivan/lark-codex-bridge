import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MEMBER_DISABLED_FEATURES = [
  'apps',
  'hooks',
  'multi_agent',
  'plugins',
  'remote_plugin',
];

export function uniqueSortedStrings(values = []) {
  return [...new Set(
    values
      .map(value => String(value || '').trim())
      .filter(Boolean),
  )].sort();
}

export function discoverCodexSkills(input = {}) {
  const home = input.home || homedir();
  const codexHome = input.codexHome || join(home, '.codex');
  const roots = [
    join(codexHome, 'skills'),
    join(home, '.agents', 'skills'),
    ...projectSkillRoots(input.cwd),
  ];
  const byPath = new Map();
  for (const root of roots) {
    for (const skill of discoverSkillsInRoot(root)) {
      byPath.set(skill.path, skill);
    }
  }
  return [...byPath.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
  ));
}

export function discoverCodexMcpServerNames(input = {}) {
  const home = input.home || homedir();
  const codexHome = input.codexHome || join(home, '.codex');
  const configFile = input.configFile || join(codexHome, 'config.toml');
  let content = '';
  try {
    content = readFileSync(configFile, 'utf8');
  } catch {
    return [];
  }
  const names = [];
  const sectionPattern = /^\s*\[mcp_servers\.((?:"(?:[^"\\]|\\.)*")|(?:[A-Za-z0-9_-]+))\]\s*(?:#.*)?$/gmu;
  for (const match of content.matchAll(sectionPattern)) {
    const raw = match[1];
    if (raw.startsWith('"')) {
      try {
        names.push(JSON.parse(raw));
      } catch {}
    } else {
      names.push(raw);
    }
  }
  return uniqueSortedStrings(names);
}

export function capabilityRuntimeOptions(input = {}) {
  const actor = input.actor || 'member';
  const capability = input.capability || {};
  if (actor === 'owner') {
    return {
      sandbox: input.ownerSandbox || '',
      approvalPolicy: 'never',
      integrationIsolation: false,
      skillVisibility: { mode: 'all', allowedSkills: [] },
      codexConfigOverrides: null,
      codexConfigArgs: [],
      codexAppServerArgs: [],
      capabilityPolicyKey: 'capability:owner:all',
    };
  }

  const knownSkills = input.knownSkills || [];
  const knownMcpServerNames = uniqueSortedStrings(input.knownMcpServerNames || []);
  const allowedSkills = uniqueSortedStrings(capability.allowedSkills || []);
  const knownNames = new Set(knownSkills.map(skill => skill.name));
  const missingAllowedSkills = allowedSkills.filter(name => !knownNames.has(name));
  if (missingAllowedSkills.length) {
    throw new Error(`未找到 capability 声明的 Skill：${missingAllowedSkills.join('、')}`);
  }

  const skillVisibility = allowedSkills.length
    ? { mode: 'allowlist', allowedSkills }
    : { mode: 'none', allowedSkills: [] };
  const approvedWrite = input.approvedByOwner === true
    && (capability.kind === 'exec' || ['export', 'write'].includes(capability.effect));
  const sandbox = approvedWrite
    ? (input.ownerSandbox || 'workspace-write')
    : 'read-only';
  const codexConfigOverrides = memberConfigOverrides(
    skillVisibility,
    knownSkills,
    knownMcpServerNames,
  );
  const codexConfigArgs = memberConfigArgs(
    skillVisibility,
    knownSkills,
    knownMcpServerNames,
  );
  const capabilityPolicyKey = [
    'capability',
    input.approvedByOwner ? 'owner-approved' : 'member',
    capability.id || 'unknown',
    sandbox,
    skillVisibility.mode,
    ...skillVisibility.allowedSkills,
  ].join(':');

  return {
    sandbox,
    approvalPolicy: 'never',
    integrationIsolation: true,
    skillVisibility,
    codexConfigOverrides,
    codexConfigArgs,
    codexAppServerArgs: codexConfigArgs,
    capabilityPolicyKey,
  };
}

function memberConfigOverrides(skillVisibility, knownSkills, knownMcpServerNames) {
  const skills = skillVisibility.mode === 'none'
    ? { include_instructions: false }
    : {
        include_instructions: true,
        config: skillConfigEntries(skillVisibility, knownSkills),
      };
  return {
    features: Object.fromEntries(MEMBER_DISABLED_FEATURES.map(name => [name, false])),
    mcp_servers: Object.fromEntries(
      knownMcpServerNames.map(name => [name, { enabled: false }]),
    ),
    skills,
  };
}

function memberConfigArgs(skillVisibility, knownSkills, knownMcpServerNames) {
  const args = [];
  for (const feature of MEMBER_DISABLED_FEATURES) {
    args.push('--disable', feature);
  }
  args.push('--config', 'mcp_servers={}');
  for (const name of knownMcpServerNames) {
    args.push('--config', `mcp_servers.${tomlPathSegment(name)}.enabled=false`);
  }
  if (skillVisibility.mode === 'none') {
    args.push('--config', 'skills.include_instructions=false');
    return args;
  }
  const entries = skillConfigEntries(skillVisibility, knownSkills)
    .map(entry => `{path=${JSON.stringify(entry.path)},enabled=${entry.enabled}}`);
  args.push('--config', 'skills.include_instructions=true');
  args.push('--config', `skills.config=[${entries.join(',')}]`);
  return args;
}

function tomlPathSegment(value) {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function skillConfigEntries(skillVisibility, knownSkills) {
  const allowed = new Set(skillVisibility.allowedSkills);
  return knownSkills.map(skill => ({
    path: skill.path,
    enabled: allowed.has(skill.name),
  }));
}

function projectSkillRoots(cwd) {
  if (!cwd) return [];
  const roots = [];
  let current = resolve(cwd);
  for (;;) {
    roots.push(join(current, '.codex', 'skills'));
    const parent = resolve(current, '..');
    if (parent === current) return roots;
    current = parent;
  }
}

function discoverSkillsInRoot(root) {
  if (!existsSync(root)) return [];
  const skills = [];
  for (const entry of safeReadDir(root)) {
    const entryPath = join(root, entry);
    if (entry === '.system') {
      for (const systemEntry of safeReadDir(entryPath)) {
        const skill = readSkill(join(entryPath, systemEntry), systemEntry);
        if (skill) skills.push(skill);
      }
      continue;
    }
    const skill = readSkill(entryPath, entry);
    if (skill) skills.push(skill);
  }
  return skills;
}

function readSkill(directory, fallbackName) {
  try {
    if (!statSync(directory).isDirectory()) return null;
  } catch {
    return null;
  }
  const path = join(directory, 'SKILL.md');
  if (!existsSync(path)) return null;
  let name = fallbackName;
  try {
    const content = readFileSync(path, 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
    name = frontmatter?.[1]
      .match(/^name:\s*["']?([^"'\n#]+)["']?\s*$/mu)?.[1]
      ?.trim() || fallbackName;
  } catch {}
  return { name, path: resolve(path) };
}

function safeReadDir(root) {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}
