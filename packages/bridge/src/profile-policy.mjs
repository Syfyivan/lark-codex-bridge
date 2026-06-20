import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

export const defaultProfilePolicyConfig = {
  version: 1,
  authority: {
    owners: [],
    ownerBypassesCapabilities: true,
  },
  defaults: {
    groupBehavior: 'ignore',
    p2pProfile: 'direct',
  },
  profiles: {
    direct: {
      id: 'direct',
      name: 'Direct Codex',
      soul: '你是通过飞书接入的一对一 Codex 助手。请用中文简洁、准确地回答。',
      capabilities: [
        {
          id: 'chat',
          name: '普通对话',
          description: '回答一般问题，但不默认执行本机命令。',
          kind: 'chat',
          safeForMembers: true,
          match: ['.*'],
        },
      ],
    },
  },
  chats: {},
};

export function loadProfilePolicy(input = {}) {
  const {
    enabled = false,
    configFile = '',
    exists = existsSync,
    readFile = readFileSync,
  } = input;

  if (!enabled) {
    return {
      enabled: false,
      loaded: false,
      path: configFile,
      config: defaultProfilePolicyConfig,
    };
  }

  if (!configFile || !exists(configFile)) {
    return {
      enabled: true,
      loaded: false,
      path: configFile,
      config: defaultProfilePolicyConfig,
    };
  }

  const parsed = JSON.parse(readFile(configFile, 'utf8'));
  validateProfilePolicyConfig(parsed, configFile);
  return {
    enabled: true,
    loaded: true,
    path: configFile,
    config: parsed,
  };
}

export function validateProfilePolicyConfig(config, configPath = 'profiles.json') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${configPath}: profile config must be an object`);
  }
  if (config.version !== 1) throw new Error(`${configPath}: unsupported version`);

  if (config.authority !== undefined) {
    if (!config.authority || typeof config.authority !== 'object' || Array.isArray(config.authority)) {
      throw new Error(`${configPath}: authority must be an object`);
    }
    assertStringArray(config.authority.owners, `${configPath}: authority.owners must be a string array`, {
      optional: true,
    });
    if (
      config.authority.ownerBypassesCapabilities !== undefined &&
      typeof config.authority.ownerBypassesCapabilities !== 'boolean'
    ) {
      throw new Error(`${configPath}: authority.ownerBypassesCapabilities must be boolean`);
    }
  }

  if (!config.defaults || typeof config.defaults !== 'object' || Array.isArray(config.defaults)) {
    throw new Error(`${configPath}: missing defaults`);
  }
  if (!['ignore', 'deny'].includes(config.defaults.groupBehavior)) {
    throw new Error(`${configPath}: defaults.groupBehavior must be ignore or deny`);
  }
  if (config.defaults.p2pProfile !== undefined && typeof config.defaults.p2pProfile !== 'string') {
    throw new Error(`${configPath}: defaults.p2pProfile must be string`);
  }

  if (!config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles)) {
    throw new Error(`${configPath}: missing profiles`);
  }
  for (const [profileId, profile] of Object.entries(config.profiles)) {
    validateProfile(profileId, profile, configPath);
  }

  if (!config.chats || typeof config.chats !== 'object' || Array.isArray(config.chats)) {
    throw new Error(`${configPath}: chats must be an object`);
  }
  for (const [chatId, binding] of Object.entries(config.chats)) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      throw new Error(`${configPath}: chat ${chatId} binding must be an object`);
    }
    if (!config.profiles[binding.profile]) {
      throw new Error(`${configPath}: chat ${chatId} references missing profile ${binding.profile}`);
    }
  }

  if (config.defaults.p2pProfile && !config.profiles[config.defaults.p2pProfile]) {
    throw new Error(`${configPath}: defaults.p2pProfile references missing profile ${config.defaults.p2pProfile}`);
  }
}

function validateProfile(profileId, profile, configPath) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`${configPath}: profile ${profileId} must be an object`);
  }
  if (profile.id !== profileId) throw new Error(`${configPath}: profile key/id mismatch for ${profileId}`);
  if (typeof profile.name !== 'string' || !profile.name.trim()) {
    throw new Error(`${configPath}: profile ${profileId} missing name`);
  }
  if (typeof profile.soul !== 'string' && typeof profile.soulFile !== 'string') {
    throw new Error(`${configPath}: profile ${profileId} needs soul or soulFile`);
  }
  if (!Array.isArray(profile.capabilities) || !profile.capabilities.length) {
    throw new Error(`${configPath}: profile ${profileId} needs capabilities`);
  }
  for (const capability of profile.capabilities) {
    validateCapability(profileId, capability, configPath);
  }
}

function validateCapability(profileId, capability, configPath) {
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
    throw new Error(`${configPath}: profile ${profileId} has invalid capability`);
  }
  for (const key of ['id', 'name', 'description']) {
    if (typeof capability[key] !== 'string' || !capability[key].trim()) {
      throw new Error(`${configPath}: profile ${profileId} capability missing ${key}`);
    }
  }
  if (capability.kind !== undefined && !['chat', 'safe_skill', 'safe_exec', 'exec'].includes(capability.kind)) {
    throw new Error(`${configPath}: profile ${profileId} capability ${capability.id} has invalid kind`);
  }
  if (capability.effect !== undefined && !['read', 'export', 'write'].includes(capability.effect)) {
    throw new Error(`${configPath}: profile ${profileId} capability ${capability.id} has invalid effect`);
  }
  if (capability.safeForMembers !== undefined && typeof capability.safeForMembers !== 'boolean') {
    throw new Error(`${configPath}: profile ${profileId} capability ${capability.id} has invalid safeForMembers`);
  }
  if (capability.kind === 'exec' && capability.safeForMembers === true) {
    throw new Error(`${configPath}: profile ${profileId} capability ${capability.id} cannot mark exec as safeForMembers`);
  }
  for (const field of ['match', 'excludeMatch', 'allowedOpenIds', 'allowedChats', 'allowedSkills']) {
    assertStringArray(
      capability[field],
      `${configPath}: profile ${profileId} capability ${capability.id} has invalid ${field}`,
      { optional: true },
    );
  }
  for (const pattern of [...(capability.match || []), ...(capability.excludeMatch || [])]) {
    new RegExp(pattern, 'iu');
  }
}

function assertStringArray(value, message, options = {}) {
  if (value === undefined && options.optional) return;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(message);
  }
}

export function effectiveProfileOwners(config) {
  const owners = config?.authority?.owners || [];
  const seen = new Set();
  return owners
    .map(owner => String(owner || '').trim())
    .filter(owner => {
      if (!owner || seen.has(owner)) return false;
      seen.add(owner);
      return true;
    });
}

export function isProfileOwner(config, senderId) {
  return Boolean(senderId && effectiveProfileOwners(config).includes(senderId));
}

export function resolveProfileForEvent(config, event, options = {}) {
  const chatId = event?.chatId || event?.chat_id || '';
  const chatType = String(event?.chatType || event?.chat_type || '').toLowerCase();
  if (!chatId) return { ok: false, reason: 'missing-chat-id' };

  const binding = config.chats?.[chatId];
  if (binding) {
    const profile = config.profiles[binding.profile];
    if (!profile) return { ok: false, reason: 'missing-profile' };
    return { ok: true, profile, binding };
  }

  if (chatType === 'p2p' && config.defaults.p2pProfile) {
    const profile = config.profiles[config.defaults.p2pProfile];
    if (profile) return { ok: true, profile, binding: null };
  }

  if (chatType === 'group' || chatType === 'topic_group') {
    if (options.allowOwnerFallbackForUnconfiguredGroup && isProfileOwner(config, event.senderId || event.sender_id)) {
      const profileId = config.defaults.p2pProfile || 'direct';
      const profile = config.profiles[profileId];
      if (profile) return { ok: true, profile, binding: null };
    }
    if (config.defaults.groupBehavior === 'deny') {
      return {
        ok: false,
        reason: 'unconfigured-group',
        message: '这个群还没有配置 profile/capability 边界，暂不响应。',
      };
    }
    return { ok: false, reason: 'unconfigured-group' };
  }

  return { ok: false, reason: 'unconfigured-chat' };
}

export function selectCapability(profile, content, options = {}) {
  if (options.isOwner && options.ownerBypassesCapabilities !== false) {
    return {
      ok: true,
      capability: {
        id: 'owner_directive',
        name: 'Owner 指令',
        description: '最高权限用户发出的指令；可以临时越过普通成员 capability 边界。',
        kind: 'exec',
        safeForMembers: false,
        match: ['.*'],
      },
    };
  }

  const text = String(content || '');
  for (const capability of profile.capabilities || []) {
    if (matchesAnyPattern(capability.excludeMatch || [], text)) continue;
    const patterns = capability.match?.length ? capability.match : [capability.name, capability.id];
    if (matchesAnyPattern(patterns, text)) return { ok: true, capability };
  }
  return {
    ok: false,
    message: profile.denyMessage || `这个群的「${profile.name}」profile 没有授权处理这类请求。`,
  };
}

function matchesAnyPattern(patterns, text) {
  return patterns.some(pattern => new RegExp(pattern, 'iu').test(text));
}

export const memberExecutionDenyMessage =
  '普通成员不能触发本机命令、文件读写、外部执行或高风险 skill。这个群只有 owner 可以执行这类动作；普通成员只能进行普通对话，或使用显式标记为 safe_skill/safe_exec 且 safeForMembers=true 的安全能力。';

const memberExecutionPatterns = [
  /(?:执行|运行|跑一下|跑下|调用|启动|重启|安装|卸载|删除|创建|修改|写入|移动|重命名|提交|推送|部署|发布)(?:一下|下|这个|这些)?(?:命令|脚本|文件|目录|代码|项目|服务|进程|程序|skill|工具)/iu,
  /(?:执行|运行|跑一下|跑下)\s*`[^`]+`/iu,
  /\b(?:run|execute|exec|start|restart|install|uninstall|delete|remove|create|modify|write|move|rename|commit|push|deploy|release)\b.{0,30}\b(?:command|script|file|directory|folder|program|process|service|tool|skill)\b/iu,
  /(?:^|\n)\s*(?:\$|>)\s*(?:npm|pnpm|bun|node|python|pip|brew|curl|wget|ssh|scp|rsync|git|rm|mv|cp|chmod|chown|sudo|launchctl|osascript)\b/iu,
  /`[^`]*(?:npm|pnpm|bun|node|python|pip|brew|curl|wget|ssh|scp|rsync|git|rm|mv|cp|chmod|chown|sudo|launchctl|osascript)\b[^`]*`/iu,
  /\b(?:npm|pnpm|bun|node|python|pip|brew|curl|wget|ssh|scp|rsync|git|rm|mv|cp|chmod|chown|sudo|launchctl|osascript)\s+[\w./:@~-]+/iu,
];

export function looksLikeMemberExecutionRequest(content) {
  return memberExecutionPatterns.some(pattern => pattern.test(String(content || '')));
}

export function capabilityKind(capability) {
  return capability?.kind || 'chat';
}

export function isCapabilitySafeForMember(capability) {
  if (capability?.safeForMembers !== undefined) return capability.safeForMembers;
  return capabilityKind(capability) !== 'exec';
}

export function authorizeCapabilityForActor(capability, actor, context = {}) {
  if (actor === 'owner') return { ok: true };

  if (!isCapabilitySafeForMember(capability)) {
    return { ok: false, message: memberExecutionDenyMessage };
  }

  const senderId = context.senderId || context.sender_id || '';
  if (capability.allowedOpenIds !== undefined && !capability.allowedOpenIds.includes(senderId)) {
    return { ok: false, message: `你没有被授权使用「${capability.name}」能力。` };
  }

  const chatId = context.chatId || context.chat_id || '';
  if (capability.allowedChats?.length && !capability.allowedChats.includes(chatId)) {
    return { ok: false, message: `当前会话没有被授权使用「${capability.name}」能力。` };
  }

  if (capabilityKind(capability) === 'chat' && looksLikeMemberExecutionRequest(context.content)) {
    return { ok: false, message: memberExecutionDenyMessage };
  }

  return { ok: true };
}

export function resolveSoulText(profile, configPath = '') {
  if (!profile?.soulFile) return profile?.soul || '';
  const baseDir = configPath ? dirname(configPath) : process.cwd();
  const candidate = normalize(isAbsolute(profile.soulFile) ? profile.soulFile : join(baseDir, profile.soulFile));
  const allowedRoots = [join(baseDir, 'souls')];
  if (!allowedRoots.some(root => isPathInsideDirectory(candidate, root))) {
    throw new Error(`soulFile for profile ${profile.id} must stay under ${join(baseDir, 'souls')}`);
  }
  return readFileSync(candidate, 'utf8').trim();
}

function isPathInsideDirectory(candidate, root) {
  const normalizedRoot = normalize(root);
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalize(candidate).startsWith(rootWithSeparator);
}

export function buildProfilePromptContext(input) {
  const {
    profile,
    capability,
    actor = 'member',
    current = '',
    contextLabel = '聊天',
    soulText = profile?.soul || '',
  } = input || {};
  const actorIsOwner = actor === 'owner';
  return [
    'Profile / capability 边界：',
    actorIsOwner
      ? '下面的 profile 为默认上下文，不限制 owner 的明确指令。'
      : '下面的 profile 是普通成员请求的硬边界，必须严格遵守。',
    'profile 定义的是当前聊天/群的协作语境和能力边界，不代表提问者身份；不要因为产品群、工程群或其他群 profile 改写用户本人的职业、立场或权限。',
    '用户身份应优先来自用户消息、sender 上下文、显式说明和可见记忆；如果不确定，按已知事实回答，不要自行假设。',
    `profile：${profile?.name || profile?.id || 'unknown'}`,
    `soul：\n${soulText || '无'}`,
    `当前允许能力：${capability?.name || 'unknown'}`,
    `能力类型：${capabilityKind(capability)}`,
    `普通成员可用：${isCapabilitySafeForMember(capability) ? '是' : '否'}`,
    capability?.effect ? `能力影响：${formatCapabilityEffect(capability.effect)}` : '',
    capability?.description ? `能力说明：${capability.description}` : '',
    actorIsOwner
      ? 'owner 权限：可以执行本机命令、文件读写、git、部署和外部工具调用；只有工具、网络、凭证或系统客观不可用时才说明阻塞。'
      : '普通成员权限：不得越过当前能力；不得执行本机命令、文件读写、git、部署、飞书外发或高风险 skill，除非当前能力显式允许 safe_skill/safe_exec。',
    `上下文类型：${contextLabel}`,
    `当前用户消息：\n${current}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatCapabilityEffect(effect) {
  if (effect === 'read') return '只读查询，不应修改业务状态';
  if (effect === 'export') return '导出/生成产物，可能创建文件、表格或消息';
  if (effect === 'write') return '写入业务状态，必须严格限制到授权能力范围';
  return '未标注';
}

export function evaluateProfilePolicy(policy, event, content, options = {}) {
  if (!policy?.enabled) return { ok: true, enabled: false };

  const profileEvent = {
    chatId: event?.chatId || event?.chat_id || '',
    chatType: event?.chatType || event?.chat_type || '',
    senderId: event?.senderId || event?.sender_id || '',
  };
  const actor = isProfileOwner(policy.config, profileEvent.senderId) || options.isOwner
    ? 'owner'
    : 'member';
  const profileResult = resolveProfileForEvent(policy.config, profileEvent, {
    allowOwnerFallbackForUnconfiguredGroup: true,
  });
  if (!profileResult.ok) {
    return {
      ok: false,
      actor,
      reason: profileResult.reason,
      silent: !profileResult.message,
      message: profileResult.message || '',
    };
  }

  const selected = selectCapability(profileResult.profile, content, {
    isOwner: actor === 'owner',
    ownerBypassesCapabilities: policy.config.authority?.ownerBypassesCapabilities !== false,
  });
  if (!selected.ok) {
    return { ok: false, actor, reason: 'capability-miss', message: selected.message };
  }

  const authorized = authorizeCapabilityForActor(selected.capability, actor, {
    senderId: profileEvent.senderId,
    chatId: profileEvent.chatId,
    content,
  });
  if (!authorized.ok) {
    return { ok: false, actor, reason: 'capability-denied', message: authorized.message };
  }

  return {
    ok: true,
    enabled: true,
    actor,
    profile: profileResult.profile,
    capability: selected.capability,
    promptContext: buildProfilePromptContext({
      profile: profileResult.profile,
      capability: selected.capability,
      actor,
      current: content,
      contextLabel: profileEvent.chatType || '聊天',
      soulText: resolveSoulText(profileResult.profile, policy.path),
    }),
  };
}
