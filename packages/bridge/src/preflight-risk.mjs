export const RISK_PREFLIGHT_BLOCKED_REPLY =
  '这个操作会修改外部系统，需要宋一凡明确授权。我已暂停执行，等待 owner 审批。';

const PREFLIGHT_RULES = [
  {
    label: 'GitHub / 仓库外部写操作',
    pattern: /(?:github|git\s*hub|仓库|repo|repository).{0,30}(?:push|推送|推到|推|创建|新建|权限|permission|access|admin|write|maintain)|(?:push|推送|推到|推).{0,30}(?:github|git\s*hub|仓库|repo|repository)|(?:创建|新建).{0,20}(?:github|git\s*hub|仓库|repo|repository)/iu,
  },
  {
    label: '仓库成员权限变更',
    pattern: /(?:给|为|帮|添加|增加|新增|授予|赋予|grant|add).{0,50}(?:admin|maintain|write|管理员|维护者|写权限|管理权限|权限|permission|access)|(?:admin|maintain|write).{0,25}(?:权限|permission|access)/iu,
  },
  {
    label: '支付 / 购买 / 下单',
    pattern: /支付|付款|购买|下单|采购|\b(?:pay|purchase|buy|order)\b/iu,
  },
  {
    label: '删除 / 清空数据',
    pattern: /\b(?:rm\s+-[a-z-]*r[a-z-]*f?|delete|remove|drop|truncate|destroy)\b|删除|删掉|移除|清空|销毁/iu,
  },
  {
    label: '线上发布 / 生产部署',
    pattern: /(?:发布|部署|上线|发版).{0,20}(?:线上|生产|prod|production)|(?:线上|生产|prod|production).{0,20}(?:发布|部署|上线|发版)|\bdeploy(?:ment)?\s+(?:to\s+)?(?:prod|production)\b|\brelease\s+(?:to\s+)?(?:prod|production)\b/iu,
  },
  {
    label: '密钥 / token / 凭证读取或修改',
    pattern: /(?:读取|查看|打印|输出|修改|更换|写入|导出|get|read|print|show|view|export|rotate|update).{0,30}(?:密钥|令牌|凭证|token|secret|cookie|jwt|app\s*secret|appsecret|credential)|(?:密钥|令牌|凭证|token|secret|cookie|jwt|app\s*secret|appsecret|credential).{0,30}(?:读取|查看|打印|输出|修改|更换|写入|导出|get|read|print|show|view|export|rotate|update)/iu,
  },
];

export function classifyRiskPreflight(rawText) {
  const text = String(rawText || '').trim();
  const labels = PREFLIGHT_RULES
    .filter(rule => rule.pattern.test(text))
    .map(rule => rule.label);
  return {
    blocked: labels.length > 0,
    labels,
  };
}

export function formatRiskPreflightBlockedReply() {
  return RISK_PREFLIGHT_BLOCKED_REPLY;
}
