import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildProjectPromptContext,
  loadProjectBindings,
  resolveProjectBinding,
  shouldLookupGroupContext,
  validateProjectBindingSources,
} from '../src/project-bindings.mjs';

function writeFixture(root) {
  mkdirSync(join(root, '.omx'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, '.omx/project-memory.json'), JSON.stringify({
    project: {
      name: 'BuyTogether',
      product_positioning: 'Shared AI purchasing platform.',
      non_goal_warning: 'Not a simple wishlist.',
    },
    architecture_principles: [
      'Every purchase action must be auditable.',
      'Risky states must pause or require confirmation.',
    ],
    version_plan: [{
      version: 'V0.1',
      name: 'Product Spine And Local Platform',
      status: 'pending',
      goal: 'Establish the permanent product skeleton.',
    }],
    immediate_next_tasks: [
      'Initialize the web application workspace.',
      'Implement the permanent schema before UI polish.',
    ],
    collaboration_protocol: {
      default_interaction: 'Use the group for requirements and implementation progress.',
      memory_write_policy: 'Only confirmed decisions become durable memory.',
      operation_policy: 'Real purchase and production deploy require owner approval.',
      message_mirroring: 'Mirror organized final results back to the group.',
    },
  }));
  writeFileSync(join(root, 'TODO.md'), [
    '# TODO',
    '### V0.1 - Product Spine And Local Platform',
    'Deliverables:',
    '- [ ] Create the web app shell.',
    '- [ ] Add database schema.',
    'Exit criteria:',
    '- [ ] A user can create a shared space.',
    '### V0.2 - AI Research',
    '## Immediate Next Tasks',
    '- [ ] Initialize the web application workspace.',
  ].join('\n'));
  writeFileSync(join(root, 'docs/version-roadmap.md'), [
    '# Roadmap',
    '## V0.1 - Product Spine And Local Platform',
    'Primary work:',
    '- Web app shell.',
  ].join('\n'));
}

function writeBindings(file, root) {
  writeFileSync(file, JSON.stringify({
    version: 1,
    chats: {
      oc_buy: {
        project: 'BuyTogether',
        project_id: 'buy-together',
        cwd: root,
        memory_file: join(root, '.omx/project-memory.json'),
        todo_file: join(root, 'TODO.md'),
        roadmap_file: join(root, 'docs/version-roadmap.md'),
        allowed_actions: ['edit_project_files', 'run_local_tests'],
        requires_owner_approval: ['payment', 'production_deploy'],
      },
    },
  }));
}

test('project bindings load and resolve chat project context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-bindings-'));
  try {
    const root = join(dir, 'buy-together');
    mkdirSync(root, { recursive: true });
    writeFixture(root);
    const file = join(dir, 'project-bindings.json');
    writeBindings(file, root);

    const loaded = loadProjectBindings({ configFile: file });
    const binding = resolveProjectBinding(loaded, { chatId: 'oc_buy' });

    assert.equal(loaded.loaded, true);
    assert.equal(binding.project, 'BuyTogether');
    assert.equal(binding.cwd, root);
    assert.equal(binding.projectId, 'buy-together');
    assert.deepEqual(validateProjectBindingSources(binding), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project bindings report missing required sources before backend start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-bindings-missing-'));
  try {
    const file = join(dir, 'project-bindings.json');
    writeBindings(file, join(dir, 'missing'));
    const binding = resolveProjectBinding(loadProjectBindings({ configFile: file }), { chatId: 'oc_buy' });

    const missing = validateProjectBindingSources(binding);

    assert.equal(missing.some(item => item.includes('cwd')), true);
    assert.equal(missing.some(item => item.includes('project memory')), true);
    assert.equal(missing.some(item => item.includes('TODO')), true);
    assert.equal(missing.some(item => item.includes('roadmap')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project prompt context is bounded and includes roadmap todo and group policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-context-'));
  try {
    const root = join(dir, 'buy-together');
    mkdirSync(root, { recursive: true });
    writeFixture(root);
    const file = join(dir, 'project-bindings.json');
    writeBindings(file, root);
    const binding = resolveProjectBinding(loadProjectBindings({ configFile: file }), { chatId: 'oc_buy' });

    const context = buildProjectPromptContext(binding, {
      taskText: '开始按照顺序进行开发',
      maxChars: 5000,
    });

    assert.match(context, /project: BuyTogether/);
    assert.match(context, /cwd=.*buy-together|project_root:/);
    assert.match(context, /V0\.1/);
    assert.match(context, /Create the web app shell/);
    assert.match(context, /A user can create a shared space/);
    assert.match(context, /Real purchase and production deploy require owner approval/);
    assert.match(context, /Do not read the latest 50 group messages by default/);
    assert.ok(context.length <= 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project group lookup policy only triggers for unresolved recent-chat references', () => {
  const binding = { githubRepo: '' };

  assert.equal(shouldLookupGroupContext('开始按照顺序进行开发', binding), false);
  assert.equal(shouldLookupGroupContext('按刚才群里说的继续那个 GitHub 项目', binding), true);
  assert.equal(shouldLookupGroupContext('看一下这个仓库', binding), true);
  assert.equal(shouldLookupGroupContext('看一下这个仓库', { githubRepo: 'https://github.com/a/b' }), true);
});
