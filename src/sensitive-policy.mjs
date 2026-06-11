const SENSITIVE_RULES = [
  {
    label: '删除/移除',
    pattern: /\b(?:rm\s+-[a-z-]*r[a-z-]*f?|delete|remove|drop)\b|删除|删掉|移除|清空|销毁|卸载/iu,
  },
  {
    label: '修改本机文件',
    pattern: /(?:帮我|直接|把|将|去|给我)?(?:改一下|修改|写入|覆盖|替换|重命名|移动|新增|创建|生成文件|保存到|落盘|格式化|修复|实现|接入|迁移)/iu,
  },
  {
    label: 'Git 写操作',
    pattern: /\b(?:commit|push|merge|rebase|reset|checkout\s+-B|cherry-pick|tag)\b|提交|推送|合入|合并|变基|回滚|打标签/iu,
  },
  {
    label: '部署/发布',
    pattern: /\b(?:deploy|publish|release|goofy\s+preview\s+deploy)\b|部署|发布|上线|发版/iu,
  },
  {
    label: '安装/更新依赖',
    pattern: /\b(?:npm|pnpm|yarn|pip|brew)\s+(?:install|add|remove|update|upgrade|uninstall)\b|安装依赖|升级依赖|新增依赖|删除依赖/iu,
  },
  {
    label: '飞书/外部发送',
    pattern: /发消息|通知.*群|提醒.*群|拉群|邀请.*进群|撤回消息|pin\s*消息|置顶消息/iu,
  },
  {
    label: '代码平台写操作',
    pattern: /\b(?:approve|lgtm|comment|request\s*changes)\b|给\s*[aA]\b|审批|批准|评论|留言|打回|驳回/iu,
  },
];

export function sensitiveOperationKeywordMatches(text) {
  const source = String(text || '');
  return SENSITIVE_RULES.filter(rule => rule.pattern.test(source)).map(rule => rule.label);
}

export function classifyDirectExecution(rawText, parsed = {}) {
  const labels = new Set(sensitiveOperationKeywordMatches(rawText));
  let executionKind = 'direct_codex';

  if (parsed.botSendCommand) {
    labels.add('发送给机器人');
    executionKind = 'bot_send';
  }
  if (parsed.sessionShareCommand?.intent === 'share') {
    labels.add('生成/部署会话快照');
    executionKind = 'session_share';
  }
  if (parsed.reviewAutomation) {
    labels.add('MR review 自动化可能写评论或 approve');
    executionKind = 'review_automation';
  }
  if (parsed.reviewFollowup) {
    labels.add('Reviewer 回复闭环自动化可能改代码、提交或 push');
    executionKind = 'review_followup';
  }

  return {
    sensitive: labels.size > 0,
    labels: [...labels],
    executionKind,
  };
}
