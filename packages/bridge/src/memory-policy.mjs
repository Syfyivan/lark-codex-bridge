export function parseMemoryCommand(content) {
  const trimmed = String(content || '').trim();
  if (/^\/(?:memory|记忆)$/iu.test(trimmed)) return { action: 'show', scope: 'chat' };
  if (/^\/(?:project-memory|项目记忆)$/iu.test(trimmed)) return { action: 'show', scope: 'project' };
  if (/^\/(?:memory-pending|记忆待审批)$/iu.test(trimmed)) return { action: 'pending', scope: 'chat' };

  const approve = trimmed.match(/^\/(?:memory-approve|批准记忆)\s+([A-Za-z0-9_-]+|all)$/iu);
  if (approve?.[1]?.trim()) return { action: 'approve', scope: 'chat', selector: approve[1].trim() };

  const reject = trimmed.match(/^\/(?:memory-reject|拒绝记忆)\s+([A-Za-z0-9_-]+|all)$/iu);
  if (reject?.[1]?.trim()) return { action: 'reject', scope: 'chat', selector: reject[1].trim() };

  const compact = trimmed.match(/^\/(?:memory-compact|压缩记忆)(?:\s+(thread|chat|project|global|线程|群|项目|全局))?$/iu);
  if (compact) return { action: 'compact', scope: normalizeCompactScope(compact[1] || 'chat') };

  const remember = trimmed.match(/^\/(?:remember|记住)\s+([\s\S]+)$/iu);
  if (remember?.[1]?.trim()) return { action: 'remember', scope: 'chat', text: remember[1].trim() };

  const rememberProject = trimmed.match(/^\/(?:remember-project|项目记住)\s+([\s\S]+)$/iu);
  if (rememberProject?.[1]?.trim()) {
    return { action: 'remember', scope: 'project', text: rememberProject[1].trim() };
  }

  const rememberGlobal = trimmed.match(/^\/(?:remember-global|全局记住)\s+([\s\S]+)$/iu);
  if (rememberGlobal?.[1]?.trim()) {
    return { action: 'remember', scope: 'global', text: rememberGlobal[1].trim() };
  }

  return null;
}

function normalizeCompactScope(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === '线程') return 'thread';
  if (normalized === '群') return 'chat';
  if (normalized === '项目') return 'project';
  if (normalized === '全局') return 'global';
  if (['thread', 'chat', 'project', 'global'].includes(normalized)) return normalized;
  return 'chat';
}

export function canWriteMemory(command, actor) {
  if (!command) return { ok: false, reason: 'missing-command' };
  if (actor !== 'owner') return { ok: false, reason: 'owner-required', message: '只有 bridge owner 可以写入或查看记忆。' };
  return { ok: true };
}

export function shouldAutoWriteThreadSummary(config, actor) {
  return Boolean(config.memoryEnabled && config.memoryAutoThreadSummary && actor === 'owner');
}
