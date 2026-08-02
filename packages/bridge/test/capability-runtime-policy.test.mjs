import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  capabilityRuntimeOptions,
  discoverCodexMcpServerNames,
  discoverCodexSkills,
} from '../src/capability-runtime-policy.mjs';

test('owner capability policy keeps the normal Codex runtime available', () => {
  const policy = capabilityRuntimeOptions({
    actor: 'owner',
    ownerSandbox: 'danger-full-access',
  });

  assert.equal(policy.sandbox, 'danger-full-access');
  assert.equal(policy.integrationIsolation, false);
  assert.deepEqual(policy.codexConfigArgs, []);
  assert.equal(policy.skillVisibility.mode, 'all');
});

test('member capability policy forces read-only runtime and disables ambient integrations', () => {
  const policy = capabilityRuntimeOptions({
    actor: 'member',
    capability: {
      id: 'read_docs',
      kind: 'safe_exec',
      effect: 'read',
      allowedSkills: ['docs-query'],
    },
    knownSkills: [
      { name: 'docs-query', path: '/skills/docs-query/SKILL.md' },
      { name: 'deploy', path: '/skills/deploy/SKILL.md' },
    ],
    knownMcpServerNames: ['code-search', 'lark.docs'],
  });

  assert.equal(policy.sandbox, 'read-only');
  assert.equal(policy.integrationIsolation, true);
  assert.equal(policy.codexConfigOverrides.features.plugins, false);
  assert.deepEqual(policy.codexConfigOverrides.mcp_servers, {
    'code-search': { enabled: false },
    'lark.docs': { enabled: false },
  });
  assert.deepEqual(policy.codexConfigOverrides.skills.config, [
    { path: '/skills/docs-query/SKILL.md', enabled: true },
    { path: '/skills/deploy/SKILL.md', enabled: false },
  ]);
  assert.equal(policy.codexConfigArgs.includes('mcp_servers={}'), true);
  assert.equal(policy.codexConfigArgs.includes('mcp_servers.code-search.enabled=false'), true);
  assert.equal(policy.codexConfigArgs.includes('mcp_servers."lark.docs".enabled=false'), true);
  assert.deepEqual(policy.codexAppServerArgs, policy.codexConfigArgs);
  assert.match(policy.capabilityPolicyKey, /read_docs.*allowlist.*docs-query/);
});

test('member without an explicit skill allowlist sees no local skills', () => {
  const policy = capabilityRuntimeOptions({
    actor: 'member',
    capability: { id: 'chat', kind: 'chat', effect: 'read' },
  });

  assert.deepEqual(policy.codexConfigOverrides.skills, { include_instructions: false });
  assert.equal(policy.codexConfigArgs.includes('skills.include_instructions=false'), true);
});

test('owner-approved write capability keeps integration isolation but may use owner sandbox', () => {
  const policy = capabilityRuntimeOptions({
    actor: 'member',
    approvedByOwner: true,
    ownerSandbox: 'danger-full-access',
    capability: { id: 'edit_code', kind: 'exec', effect: 'write' },
  });

  assert.equal(policy.sandbox, 'danger-full-access');
  assert.equal(policy.integrationIsolation, true);
  assert.equal(policy.codexConfigOverrides.features.plugins, false);
  assert.match(policy.capabilityPolicyKey, /owner-approved/);
});

test('capability policy fails closed when an allowed skill is not installed', () => {
  assert.throws(
    () => capabilityRuntimeOptions({
      actor: 'member',
      capability: { id: 'query', allowedSkills: ['missing-skill'] },
      knownSkills: [],
    }),
    /未找到 capability 声明的 Skill/,
  );
});

test('discoverCodexSkills reads skill names from Codex and agent roots', () => {
  const home = mkdtempSync(join(tmpdir(), 'capability-skills-'));
  const skillDir = join(home, '.codex', 'skills', 'docs-query');
  const agentSkillDir = join(home, '.agents', 'skills', 'deploy');
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(agentSkillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: docs-query\n---\n');
  writeFileSync(join(agentSkillDir, 'SKILL.md'), '---\nname: deploy\n---\n');

  assert.deepEqual(
    discoverCodexSkills({ home, codexHome: join(home, '.codex') }).map(skill => skill.name),
    ['deploy', 'docs-query'],
  );
});

test('discoverCodexMcpServerNames reads bare and quoted TOML server sections', () => {
  const home = mkdtempSync(join(tmpdir(), 'capability-mcp-'));
  const codexHome = join(home, '.codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), [
    '[mcp_servers.code-search]',
    'command = "code-search"',
    '',
    '[mcp_servers."lark.docs"] # quoted server',
    'command = "lark-docs"',
  ].join('\n'));

  assert.deepEqual(
    discoverCodexMcpServerNames({ home, codexHome }),
    ['code-search', 'lark.docs'],
  );
});
