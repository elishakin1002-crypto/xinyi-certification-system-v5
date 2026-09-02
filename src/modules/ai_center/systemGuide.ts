import { APP_ROUTES } from '../../routes';
import { SYSTEM_ROLES } from '../../../constants';
import type { PermissionCode, RoleID } from '../../../types';

type GuideKey =
  | 'dashboard'
  | 'leads'
  | 'customers'
  | 'contracts'
  | 'projects'
  | 'finance_receivables'
  | 'finance_settlements'
  | 'audit'
  | 'knowledge'
  | 'intel'
  | 'strategy'
  | 'ai_center';

type GuideIntent =
  | { kind: 'overview' }
  | { kind: 'module'; key: GuideKey };

export interface SystemGuideContext {
  activeRole?: RoleID;
  userName?: string;
  userId?: string;
  userPermissions?: PermissionCode[];
}

interface GuideFeature {
  name: string;
  howToUse: string;
}

interface GuideModule {
  key: GuideKey;
  title: string;
  route: string;
  aliases: string[];
  permissions?: PermissionCode[];
  oneLine: string;
  whenToUse: string;
  steps: string[];
  example: string;
  features: GuideFeature[];
}

const toHashLink = (route: string) => `#${route}`;

const GUIDE_MODULES: GuideModule[] = [
  {
    key: 'dashboard',
    title: '工作台',
    route: APP_ROUTES.DASHBOARD,
    aliases: ['工作台', '首页', '看板', 'dashboard'],
    permissions: [],
    oneLine: '像驾驶舱，一眼看到今天最重要的事。',
    whenToUse: '每天上班第一眼先看这里，先抓最急的任务。',
    steps: ['看红色/高风险提醒', '点卡片直接进入对应模块', '处理后回到工作台看是否清零'],
    example: '看到“逾期任务 3 个”，点进去项目管理，把负责人和截止时间补齐。',
    features: [
      { name: '全局提醒聚合', howToUse: '集中看线索/项目/合同的提醒并一键跳转处理。' },
      { name: '经营数据概览', howToUse: '快速看新增、转化、回款等核心指标。' }
    ]
  },
  {
    key: 'leads',
    title: '线索管理',
    route: APP_ROUTES.LEADS,
    aliases: ['线索', '线索管理', '公海', '潜客', 'leads'],
    permissions: ['NAV_CRM'],
    oneLine: '像“待开发名单”，先判断谁最可能成交。',
    whenToUse: '拿到新名单、要做首轮筛选和跟进时。',
    steps: ['新增/导入线索', '补齐基础信息与工商信息', '点击“生成跟进项目”推进成交'],
    example: '把新客户名单导入后，先标记高意向，再转成跟进项目安排拜访。',
    features: [
      { name: '基础信息编辑', howToUse: '电话、微信、来源、信用代码可直接维护。' },
      { name: '工商信息沉淀', howToUse: '法代、注册资本、经营范围等用于后续判断商机。' }
    ]
  },
  {
    key: 'customers',
    title: '客户管理',
    route: APP_ROUTES.CUSTOMERS,
    aliases: ['客户', '客户管理', '客户库', 'customers'],
    permissions: ['NAV_CRM'],
    oneLine: '像“正式档案柜”，记录长期服务关系。',
    whenToUse: '线索已确认、或要复盘老客户价值时。',
    steps: ['建立客户档案', '维护联系人与证书信息', '持续记录跟进，沉淀客户画像'],
    example: '某客户证书快到期，在客户页看到预警后，立刻新建续证项目。',
    features: [
      { name: '客户全景档案', howToUse: '统一维护联系人、证书、历史服务信息。' },
      { name: '跟进记录', howToUse: '每次电话/微信后写记录，团队可接力跟进。' }
    ]
  },
  {
    key: 'contracts',
    title: '合同管理',
    route: APP_ROUTES.CONTRACTS,
    aliases: ['合同', '合同管理', '签约', 'contracts'],
    permissions: ['NAV_CRM'],
    oneLine: '像“成交凭证中心”，签了就要入账入系统。',
    whenToUse: '签约、补录合同、核对款项节点时。',
    steps: ['上传或新建合同', '核对金额与回款节点', '保存后自动关联项目'],
    example: '上传新合同后，系统自动生成交付项目，项目团队直接开工。',
    features: [
      { name: '合同识别/录入', howToUse: '支持文件上传并提取关键信息。' },
      { name: '回款节点维护', howToUse: '按节点记录应收，供财务和项目共同追踪。' }
    ]
  },
  {
    key: 'projects',
    title: '项目管理',
    route: APP_ROUTES.PROJECTS,
    aliases: ['项目', '项目管理', '交付', 'projects'],
    permissions: ['NAV_DELIVERY'],
    oneLine: '像“执行战场”，任务、服务、进度都在这里。',
    whenToUse: '项目启动后到完结，全程都在这里推进。',
    steps: ['明确负责人与任务', '维护服务清单与进度', '满足条件后完结并沉淀结果'],
    example: '把“资料收集、现场审核、整改闭环”拆成任务，按期完成后结项。',
    features: [
      { name: '任务看板', howToUse: '按优先级和截止日期推进，避免卡点。' },
      { name: '服务清单', howToUse: '区分项目承载的具体服务项，便于交付管理。' }
    ]
  },
  {
    key: 'finance_receivables',
    title: '回款概览',
    route: APP_ROUTES.FINANCE,
    aliases: ['回款', '回款概览', '应收', '财务回款', 'finance'],
    permissions: ['NAV_FINANCE'],
    oneLine: '像“收钱进度条”，看哪些钱到了、哪些还没到。',
    whenToUse: '每天核对应收到账、催收进度时。',
    steps: ['查看应收节点列表', '确认到账或标记异常', '回写项目/合同状态'],
    example: '某节点已到账，点“确认到账”后，项目回款进度自动更新。',
    features: [
      { name: '应收台账', howToUse: '按合同查看节点金额、到期日和状态。' },
      { name: '到账确认', howToUse: '到账后更新状态，驱动后续结算流程。' }
    ]
  },
  {
    key: 'finance_settlements',
    title: '顾问结算',
    route: `${APP_ROUTES.FINANCE}/settlements`,
    aliases: ['结算', '顾问结算', '支出', 'finance/settlements'],
    permissions: ['NAV_FINANCE'],
    oneLine: '像“分钱台账”，明确每笔应付给谁。',
    whenToUse: '回款确认后，发起内部/外部结算时。',
    steps: ['选择结算对象和月份', '核对应结金额', '确认并标记支付状态'],
    example: '项目回款完成后，按规则生成顾问结算单并标记已支付。',
    features: [
      { name: '结算单管理', howToUse: '集中管理草稿、已确认、已支付状态。' },
      { name: '支付闭环', howToUse: '结算状态变更会回写财务追踪。' }
    ]
  },
  {
    key: 'audit',
    title: '审核与整改',
    route: APP_ROUTES.AUDIT,
    aliases: ['审核', '整改', '不符合项', '审核运营', 'audit'],
    permissions: ['NAV_AUDIT'],
    oneLine: '像“问题修复站”，发现问题就跟踪到关闭。',
    whenToUse: '出现不符合项、需要整改追踪时。',
    steps: ['登记问题', '下发整改计划', '验证关闭并归档证据'],
    example: '发现文件不合规，登记后设整改期限，完成后验收关闭。',
    features: [
      { name: '问题生命周期', howToUse: '从 Open 到 Closed 全程留痕。' },
      { name: '整改计划', howToUse: '明确责任人与截止时间，避免遗漏。' }
    ]
  },
  {
    key: 'knowledge',
    title: '知识中心',
    route: APP_ROUTES.KNOWLEDGE,
    aliases: ['知识', '知识中心', '知识库', '文档库', 'knowledge'],
    permissions: ['NAV_KNOWLEDGE'],
    oneLine: '像“经验仓库”，把做过的事变成可复用方法。',
    whenToUse: '复盘项目、沉淀模板、让AI更懂公司时。',
    steps: ['上传或生成知识文档', '打标签并关联业务对象', '下次检索直接复用'],
    example: '把一个成功项目的做法写成模板，下次同类客户直接套用。',
    features: [
      { name: '知识沉淀', howToUse: '项目复盘、制度标准都可统一保存。' },
      { name: 'AI可见控制', howToUse: '设置哪些文档可被 AI 在回答时引用。' }
    ]
  },
  {
    key: 'intel',
    title: '情报雷达',
    route: APP_ROUTES.INTEL,
    aliases: ['情报', '情报雷达', '抓取', '行业资讯', '政策', 'intel'],
    permissions: ['NAV_INTEL'],
    oneLine: '像“雷达站”，每天抓政策/行业/企业信号找商机。',
    whenToUse: '每天晨会前看最新机会，筛选可转化情报。',
    steps: ['点击抓取今日情报', '按发布时间和类型筛选', '有价值就转线索/项目'],
    example: '抓到本地产业补贴政策后，马上转为跟进项目联系潜在客户。',
    features: [
      { name: '多维抓取', howToUse: '覆盖政策、行业、企业、招采等信号。' },
      { name: '转化闭环', howToUse: '可直接转线索或项目，进入执行链路。' }
    ]
  },
  {
    key: 'strategy',
    title: '战略管理',
    route: APP_ROUTES.STRATEGY,
    aliases: ['战略', '战略管理', 'strategy'],
    permissions: ['NAV_STRATEGY'],
    oneLine: '像“作战计划室”，决定先打哪一仗。',
    whenToUse: '做月度/季度策略复盘和目标拆解时。',
    steps: ['看系统洞察', '生成战略任务', '跟踪任务落地效果'],
    example: '判断“食品行业机会上升”，立刻下发专项拓客任务。',
    features: [
      { name: '战略洞察', howToUse: '基于业务数据给出方向建议。' },
      { name: '任务下发', howToUse: '把战略目标拆成可执行任务并跟踪。' }
    ]
  },
  {
    key: 'ai_center',
    title: 'AI配置中心',
    route: APP_ROUTES.AI_CENTER,
    aliases: ['AI中心', 'AI配置', '模型配置', 'ai-center'],
    permissions: ['NAV_AI_CENTER'],
    oneLine: '像“大脑控制台”，管理AI能力开关和策略。',
    whenToUse: '要调整模型、提示词、AI策略时。',
    steps: ['进入 AI 配置中心', '调整参数并保存', '在业务模块回归验证效果'],
    example: '修改模型后，在合同识别和情报抓取各跑一轮看质量与速度。',
    features: [
      { name: '模型策略管理', howToUse: '配置模型与调用参数。' },
      { name: '能力开关', howToUse: '按场景控制 AI 自动化行为。' }
    ]
  }
];

const GUIDE_GROUPS: Array<{ title: string; keys: GuideKey[] }> = [
  { title: '入口驾驶舱', keys: ['dashboard'] },
  { title: '客户经营', keys: ['intel', 'leads', 'customers', 'contracts'] },
  { title: '项目交付', keys: ['projects'] },
  { title: '财务闭环', keys: ['finance_receivables', 'finance_settlements'] },
  { title: '质量与复盘', keys: ['audit', 'knowledge'] },
  { title: '机会与方向', keys: ['strategy'] },
  { title: 'AI中枢', keys: ['ai_center'] }
];

/*
  角色显示名**从 constants.ts 的 SYSTEM_ROLES 取**，不在这里另抄一份。

  原来这里是硬编码的，2026-08-24 把 MANAGER 从「交付负责人」改名为「总助」时，
  constants.ts 改了，这份表没改——AI 助手里仍然显示旧名字。
  同一件事两处定义必然漂移，而漂移的表现是「某个角落显示的还是旧叫法」，
  不报错、也没人会专门去检查。
*/
const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SYSTEM_ROLES.map((r) => [r.id, r.name])
);

const ROLE_FOCUS: Record<RoleID, string> = {
  ADMIN: '看全局风险、商机与回款，优先做战略决策。',
  SYS_ADMIN: '维护系统可用性、账号与配置，业务数据以支持排查为主。',
  MANAGER: '盯项目进度、资源分配和交付质量，优先保交付。',
  SALES: '盯线索跟进、客户转化和签约，交付进度只看不改。',
  CONSULTANT: '盯项目执行、任务闭环和客户沟通，优先保质量。',
  FINANCE: '盯应收到账、结算支付和金额准确性，优先保资金安全。'
};

const OVERVIEW_PATTERNS: RegExp[] = [
  /系统.*有哪些.*功能/,
  /系统.*功能.*介绍/,
  /介绍.*系统/,
  /系统.*怎么用/,
  /怎么使用.*系统/,
  /使用说明/,
  /新手.*怎么用/,
  /功能大全/,
  /模块介绍/,
  /我.*(身份|角色).*(功能|模块)/,
  /(老板|总助|交付负责人|销售|顾问|咨询顾问|财务).*(能用|可用).*(功能|模块)/,
  /我能用哪些.*(功能|模块)/
];

const FULL_SCOPE_PATTERNS: RegExp[] = [
  /全部功能/,
  /所有功能/,
  /完整功能/,
  /全量功能/,
  /系统全功能/,
  /全部模块/
];

const MODULE_QUESTION_PATTERNS: RegExp[] = [
  /怎么用/,
  /如何用/,
  /如何使用/,
  /功能/,
  /介绍/,
  /教程/,
  /用法/,
  /是什么/
];

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');

const findModuleByQuery = (query: string): GuideModule | undefined => {
  const q = normalize(query);
  return GUIDE_MODULES.find((m) => m.aliases.some((alias) => q.includes(normalize(alias))));
};

const getVisibleModules = (ctx?: SystemGuideContext, showAll?: boolean): GuideModule[] => {
  if (showAll) return GUIDE_MODULES;
  const permissions = ctx?.userPermissions || [];
  if (permissions.length === 0) return GUIDE_MODULES;
  return GUIDE_MODULES.filter((m) => {
    if (!m.permissions || m.permissions.length === 0) return true;
    return m.permissions.some((p) => permissions.includes(p));
  });
};

const getIdentityLabel = (ctx?: SystemGuideContext) => {
  if (!ctx?.activeRole) return '未识别身份';
  const roleText = ROLE_LABELS[ctx.activeRole] || ctx.activeRole;
  const userName = String(ctx.userName || '').trim();
  return userName ? `${roleText}（${userName}）` : roleText;
};

export const detectSystemGuideIntent = (query: string): GuideIntent | null => {
  const raw = String(query || '').trim();
  if (!raw) return null;

  if (OVERVIEW_PATTERNS.some((re) => re.test(raw))) return { kind: 'overview' };

  const module = findModuleByQuery(raw);
  if (!module) return null;

  if (MODULE_QUESTION_PATTERNS.some((re) => re.test(raw)) || raw.length <= 16) {
    return { kind: 'module', key: module.key };
  }

  return null;
};

const renderFeatureList = (features: GuideFeature[]) => features.map((f) => `- ${f.name}：${f.howToUse}`).join('\n');

const renderModuleDetail = (module: GuideModule) => {
  return [
    `## ${module.title}（${module.oneLine}）`,
    `- 什么时候用：${module.whenToUse}`,
    `- 3步上手：`,
    `1. ${module.steps[0]}`,
    `2. ${module.steps[1]}`,
    `3. ${module.steps[2]}`,
    `- 小例子：${module.example}`,
    `- 这个板块的主要功能：\n${renderFeatureList(module.features)}`,
    `- 立即进入：[打开${module.title}](${toHashLink(module.route)})`
  ].join('\n');
};

const renderMindMap = (modules: GuideModule[]) => {
  const moduleMap = new Map<GuideKey, GuideModule>(modules.map((m) => [m.key, m]));
  const lines: string[] = [`## 系统脑图（按你当前身份，可点击跳转）`];
  GUIDE_GROUPS.forEach((group) => {
    const groupModules = group.keys.map((key) => moduleMap.get(key)).filter(Boolean) as GuideModule[];
    if (groupModules.length === 0) return;
    const links = groupModules.map((m) => `[${m.title}](${toHashLink(m.route)})`).join('、');
    lines.push(`- ${group.title}：${links}`);
  });
  return lines.join('\n');
};

const renderIdentitySummary = (ctx: SystemGuideContext | undefined, visibleModules: GuideModule[], showAll: boolean) => {
  const identityLabel = getIdentityLabel(ctx);
  const focus = ctx?.activeRole ? ROLE_FOCUS[ctx.activeRole] : '先按你当前工作目标筛选需要的模块。';
  return [
    '## 当前身份视角',
    `- 当前身份：${identityLabel}`,
    `- 重点建议：${focus}`,
    showAll
      ? `- 展示范围：已按“全部功能”输出（${GUIDE_MODULES.length} 个板块）。`
      : `- 展示范围：仅展示当前身份可见功能（${visibleModules.length} 个板块）。如需全量，输入“全部功能”。`
  ].join('\n');
};

const renderOverview = (modules: GuideModule[], ctx?: SystemGuideContext, showAll: boolean = false) => {
  const sections = modules.map((m) => renderModuleDetail(m)).join('\n\n---\n\n');
  return [
    `# 信义系统使用说明（身份版，小白可读）`,
    `你可以把系统想成一个“从发现机会 -> 跟进成交 -> 项目交付 -> 回款结算 -> 经验复盘”的流水线。`,
    '',
    renderIdentitySummary(ctx, modules, showAll),
    '',
    renderMindMap(modules),
    '',
    `## 各板块怎么用（每个板块都给你一个小例子）`,
    sections || '当前身份暂未配置可见模块，请联系管理员检查权限。'
  ].join('\n');
};

const renderModuleNotAccessible = (module: GuideModule, visibleModules: GuideModule[], ctx?: SystemGuideContext) => {
  const alternatives = visibleModules
    .slice(0, 6)
    .map((m) => `[${m.title}](${toHashLink(m.route)})`)
    .join('、');
  return [
    `# ${module.title}（当前身份不可见）`,
    `- 当前身份：${getIdentityLabel(ctx)}`,
    `- 原因：该模块不在你当前身份的菜单权限内。`,
    `- 你现在可用的模块：${alternatives || '暂无'}`,
    `- 处理建议：如业务确实需要，请先切换角色后再查看该模块。`
  ].join('\n');
};

const renderModule = (key: GuideKey, visibleModules: GuideModule[], ctx?: SystemGuideContext, showAll: boolean = false) => {
  const module = GUIDE_MODULES.find((m) => m.key === key);
  if (!module) return '';
  const visibleKeys = new Set(visibleModules.map((m) => m.key));
  if (!showAll && !visibleKeys.has(key)) {
    return renderModuleNotAccessible(module, visibleModules, ctx);
  }

  const siblings = visibleModules
    .filter((m) => m.key !== key)
    .slice(0, 3)
    .map((m) => `[${m.title}](${toHashLink(m.route)})`)
    .join('、');

  return [
    `# ${module.title}怎么用（小白版）`,
    `- 当前身份：${getIdentityLabel(ctx)}`,
    renderModuleDetail(module),
    '',
    `## 你下一步可能要去`,
    siblings || '当前没有更多可见板块。'
  ].join('\n');
};

export const buildSystemGuideReply = (query: string, ctx?: SystemGuideContext): string | null => {
  const intent = detectSystemGuideIntent(query);
  if (!intent) return null;
  const showAll = FULL_SCOPE_PATTERNS.some((re) => re.test(String(query || '')));
  const visibleModules = getVisibleModules(ctx, showAll);
  if (intent.kind === 'overview') return renderOverview(visibleModules, ctx, showAll);
  return renderModule(intent.key, visibleModules, ctx, showAll);
};
