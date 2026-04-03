import { APP_ROUTES } from '../../routes';
import type { Contract, Customer, KnowledgeDoc, Lead, PermissionCode, Project } from '../../../types';

export type GlobalSearchScope = 'leads' | 'customers' | 'contracts' | 'projects' | 'knowledge';

export interface GlobalSearchDataset {
  leads: Lead[];
  customers: Customer[];
  contracts: Contract[];
  projects: Project[];
  knowledgeDocs?: KnowledgeDoc[];
}

export interface GlobalSearchHit {
  scope: GlobalSearchScope;
  label: string;
  route: string;
  count: number;
}

export interface GlobalSearchRecord {
  scope: GlobalSearchScope;
  primary: string;
  secondary?: string;
  route: string;
}

export interface GlobalSearchGroup extends GlobalSearchHit {
  records: GlobalSearchRecord[];
}

export interface GlobalSearchOptions {
  includeScopes?: GlobalSearchScope[];
}

export interface GlobalSearchGroupOptions extends GlobalSearchOptions {
  maxPerScope?: number;
}

export interface GlobalSearchIntent {
  query: string;
  scope?: GlobalSearchScope;
  raw: string;
}

const SCOPE_META: Record<GlobalSearchScope, { label: string; route: string }> = {
  leads: { label: '线索管理', route: APP_ROUTES.LEADS },
  customers: { label: '客户管理', route: APP_ROUTES.CUSTOMERS },
  contracts: { label: '合同管理', route: APP_ROUTES.CONTRACTS },
  projects: { label: '项目管理', route: APP_ROUTES.PROJECTS },
  knowledge: { label: '知识中心', route: APP_ROUTES.KNOWLEDGE }
};

const SCOPE_PERMISSION: Partial<Record<GlobalSearchScope, PermissionCode>> = {
  leads: 'NAV_CRM',
  customers: 'NAV_CRM',
  contracts: 'NAV_CRM',
  projects: 'NAV_DELIVERY',
  knowledge: 'NAV_KNOWLEDGE'
};

const PATH_SCOPE_MAP: Record<string, GlobalSearchScope> = {
  [APP_ROUTES.LEADS]: 'leads',
  [APP_ROUTES.CUSTOMERS]: 'customers',
  [APP_ROUTES.CONTRACTS]: 'contracts',
  [APP_ROUTES.PROJECTS]: 'projects',
  [APP_ROUTES.KNOWLEDGE]: 'knowledge'
};

const SCOPE_ORDER: GlobalSearchScope[] = ['leads', 'customers', 'contracts', 'projects', 'knowledge'];
const DEFAULT_RECORD_LIMIT = 3;

const SEARCH_TRIGGER_RE = /(全局搜索|全局搜|搜索|搜一下|搜下|搜|查找|查询|检索|定位|找一下|找下|帮我找|帮我查)/i;
const SEARCH_PREFIX_RE = /^(请|帮我|麻烦|我想|我要|给我)?\s*(全局)?\s*(搜索|搜一下|搜下|搜|查找|查询|检索|定位|找一下|找下|帮我找|帮我查)\s*/i;

const SCOPE_KEYWORDS: Record<GlobalSearchScope, RegExp> = {
  leads: /(线索管理|线索|潜客)/i,
  customers: /(客户管理|客户|企业档案|企业)/i,
  contracts: /(合同管理|合同|签约)/i,
  projects: /(项目管理|项目|交付)/i,
  knowledge: /(知识中心|知识库|知识|文档|文件|资料|制度|模板|手册)/i
};
const NON_SEARCH_QUERY_RE = /(为什么|怎么|如何|原因|建议|分析|介绍|讲解|教程|原理|区别|对比|方案|是否|要不要|可行吗)/i;

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

const hit = (query: string, ...fields: unknown[]) => {
  if (!query) return false;
  const hay = fields.map(normalize).join(' ');
  return hay.includes(query);
};

const toRouteWithQuery = (route: string, q: string) => {
  const params = new URLSearchParams();
  params.set('q', String(q || '').trim());
  return `${route}?${params.toString()}`;
};

const toHashLink = (route: string) => `#${route}`;

const scopeIndex = (scope: GlobalSearchScope) => SCOPE_ORDER.indexOf(scope);

const pickScopes = (includeScopes?: GlobalSearchScope[]) => {
  if (!Array.isArray(includeScopes) || includeScopes.length === 0) return [...SCOPE_ORDER];
  const selected = new Set(includeScopes);
  return SCOPE_ORDER.filter(scope => selected.has(scope));
};

const matchesLead = (query: string, lead: Lead) =>
  hit(
    query,
    lead.name,
    lead.company,
    lead.mobile,
    lead.wechat,
    lead.industry,
    lead.targetCertifications,
    lead.unifiedSocialCreditCode,
    lead.source
  );

const matchesCustomer = (query: string, customer: Customer) =>
  hit(
    query,
    customer.name,
    customer.contactPerson,
    customer.mobile,
    customer.industry,
    customer.legalRepresentative,
    customer.unifiedSocialCreditCode,
    (customer.existingCertifications || []).join(' ')
  );

const matchesContract = (query: string, contract: Contract) =>
  hit(
    query,
    contract.title,
    contract.contractNo,
    contract.customerName,
    contract.contactPerson,
    contract.serviceLine,
    contract.remarks
  );

const matchesProject = (query: string, project: Project) =>
  hit(
    query,
    project.name,
    project.manager,
    project.contractRef,
    project.customerId,
    (project.serviceItems || []).map(item => item.name).join(' '),
    (project.tasks || []).map(task => task.title).join(' ')
  );

const matchesKnowledge = (query: string, doc: KnowledgeDoc) =>
  hit(
    query,
    doc.title,
    doc.category,
    doc.summary,
    doc.content,
    doc.linkTitle,
    doc.originalFileName,
    (doc.tags || []).join(' ')
  );

const searchLeadRecords = (query: string, data: GlobalSearchDataset): GlobalSearchRecord[] =>
  data.leads
    .filter(item => matchesLead(query, item))
    .map(item => {
      const primary = String(item.company || item.name || '未命名线索');
      const secondaryTokens = [item.name, item.mobile, item.industry].filter(Boolean);
      return {
        scope: 'leads' as const,
        primary,
        secondary: secondaryTokens.join(' · '),
        route: toRouteWithQuery(SCOPE_META.leads.route, primary)
      };
    });

const searchCustomerRecords = (query: string, data: GlobalSearchDataset): GlobalSearchRecord[] =>
  data.customers
    .filter(item => matchesCustomer(query, item))
    .map(item => {
      const primary = String(item.name || '未命名客户');
      const secondaryTokens = [item.contactPerson, item.mobile, item.industry].filter(Boolean);
      return {
        scope: 'customers' as const,
        primary,
        secondary: secondaryTokens.join(' · '),
        route: toRouteWithQuery(SCOPE_META.customers.route, primary)
      };
    });

const searchContractRecords = (query: string, data: GlobalSearchDataset): GlobalSearchRecord[] =>
  data.contracts
    .filter(item => matchesContract(query, item))
    .map(item => {
      const primary = String(item.title || item.contractNo || '未命名合同');
      const routeQuery = String(item.contractNo || item.customerName || item.title || query);
      const secondaryTokens = [item.contractNo, item.customerName, item.signDate].filter(Boolean);
      return {
        scope: 'contracts' as const,
        primary,
        secondary: secondaryTokens.join(' · '),
        route: toRouteWithQuery(SCOPE_META.contracts.route, routeQuery)
      };
    });

const searchProjectRecords = (query: string, data: GlobalSearchDataset): GlobalSearchRecord[] =>
  data.projects
    .filter(item => matchesProject(query, item))
    .map(item => {
      const primary = String(item.name || '未命名项目');
      const secondaryTokens = [item.manager, item.contractRef, item.deadline].filter(Boolean);
      return {
        scope: 'projects' as const,
        primary,
        secondary: secondaryTokens.join(' · '),
        route: toRouteWithQuery(SCOPE_META.projects.route, primary)
      };
    });

const searchKnowledgeRecords = (query: string, data: GlobalSearchDataset): GlobalSearchRecord[] =>
  (data.knowledgeDocs || [])
    .filter(item => matchesKnowledge(query, item))
    .map(item => {
      const primary = String(item.title || '未命名文档');
      const secondaryTokens = [item.category, item.updatedAt, item.originalFileName].filter(Boolean);
      return {
        scope: 'knowledge' as const,
        primary,
        secondary: secondaryTokens.join(' · '),
        route: toRouteWithQuery(SCOPE_META.knowledge.route, primary)
      };
    });

const searchScopeRecords = (scope: GlobalSearchScope, query: string, data: GlobalSearchDataset) => {
  if (!query) return [];
  if (scope === 'leads') return searchLeadRecords(query, data);
  if (scope === 'customers') return searchCustomerRecords(query, data);
  if (scope === 'contracts') return searchContractRecords(query, data);
  if (scope === 'projects') return searchProjectRecords(query, data);
  return searchKnowledgeRecords(query, data);
};

export const readGlobalSearchQuery = (search: string) => {
  const params = new URLSearchParams(String(search || ''));
  return String(params.get('q') || '').trim();
};

export const resolveSearchScopesByPermissions = (permissions: PermissionCode[] = []): GlobalSearchScope[] => {
  if (!Array.isArray(permissions) || permissions.length === 0) return [...SCOPE_ORDER];
  return SCOPE_ORDER.filter(scope => {
    const required = SCOPE_PERMISSION[scope];
    if (!required) return true;
    return permissions.includes(required);
  });
};

export const buildGlobalSearchHits = (
  queryText: string,
  data: GlobalSearchDataset,
  options: GlobalSearchOptions = {}
): GlobalSearchHit[] => {
  const query = normalize(queryText);
  const scopes = pickScopes(options.includeScopes);

  const results: GlobalSearchHit[] = scopes.map(scope => {
    const records = searchScopeRecords(scope, query, data);
    return {
      scope,
      label: SCOPE_META[scope].label,
      route: SCOPE_META[scope].route,
      count: records.length
    };
  });

  return results.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return scopeIndex(a.scope) - scopeIndex(b.scope);
  });
};

export const buildGlobalSearchGroups = (
  queryText: string,
  data: GlobalSearchDataset,
  options: GlobalSearchGroupOptions = {}
): GlobalSearchGroup[] => {
  const query = normalize(queryText);
  const limit = Number(options.maxPerScope || DEFAULT_RECORD_LIMIT);
  const scopes = pickScopes(options.includeScopes);

  const groups: GlobalSearchGroup[] = scopes.map(scope => {
    const records = searchScopeRecords(scope, query, data);
    return {
      scope,
      label: SCOPE_META[scope].label,
      route: SCOPE_META[scope].route,
      count: records.length,
      records: records.slice(0, Math.max(1, limit))
    };
  });

  return groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return scopeIndex(a.scope) - scopeIndex(b.scope);
  });
};

export const resolveGlobalSearchTarget = (
  queryText: string,
  data: GlobalSearchDataset,
  pathname: string,
  options: GlobalSearchOptions = {}
): GlobalSearchHit => {
  const hits = buildGlobalSearchHits(queryText, data, options);
  const firstMatched = hits.find(item => item.count > 0);
  if (firstMatched) return firstMatched;

  const scoped = pickScopes(options.includeScopes);
  const fallbackScopeByPath = PATH_SCOPE_MAP[pathname];
  const fallbackScope = fallbackScopeByPath && scoped.includes(fallbackScopeByPath)
    ? fallbackScopeByPath
    : (scoped[0] || 'leads');
  return {
    scope: fallbackScope,
    label: SCOPE_META[fallbackScope].label,
    route: SCOPE_META[fallbackScope].route,
    count: 0
  };
};

export const isSearchableModulePath = (pathname: string) => Boolean(PATH_SCOPE_MAP[pathname]);

const detectScopeFromText = (text: string): GlobalSearchScope | undefined => {
  for (const scope of SCOPE_ORDER) {
    if (SCOPE_KEYWORDS[scope].test(text)) return scope;
  }
  return undefined;
};

const normalizeSearchKeyword = (raw: string) => {
  const quoted = raw.match(/["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/);
  if (quoted && quoted[1]) return quoted[1].trim();

  const cleaned = raw
    .replace(/^(请|帮我|麻烦|我想|我要|给我|想要|想查|想找)\s*/gi, ' ')
    .replace(/(全局搜索|全局搜|搜索|搜一下|搜下|搜|查找|查询|检索|定位|找一下|找下|帮我找|帮我查)/gi, ' ')
    .replace(/(线索管理|线索|潜客|客户管理|客户|企业档案|企业|合同管理|合同|签约|项目管理|项目|交付|知识中心|知识库|知识|文档|文件|资料|制度|模板|手册)/gi, ' ')
    .replace(/(里面|里|中的|相关|信息|记录|数据|内容|有哪些|有没有|给我看|看下|看一下|列表|详情|一下|下)/gi, ' ')
    .replace(/[：:，,。！？!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
};

export const detectGlobalSearchIntent = (text: string): GlobalSearchIntent | null => {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;
  const hasTrigger = SEARCH_TRIGGER_RE.test(raw);
  const hasPrefix = SEARCH_PREFIX_RE.test(raw);
  const scope = detectScopeFromText(raw);
  const canTreatAsScopedQuickSearch = !hasTrigger && Boolean(scope) && raw.length <= 36 && !NON_SEARCH_QUERY_RE.test(raw);
  if (!hasTrigger && !canTreatAsScopedQuickSearch) return null;
  if (!hasPrefix && !scope && !canTreatAsScopedQuickSearch) return null;

  const query = normalizeSearchKeyword(raw);
  if (!query || query.length < 2) return null;

  return { query, scope, raw };
};

export const buildGlobalSearchReplyMarkdown = (
  intent: GlobalSearchIntent,
  groups: GlobalSearchGroup[]
): string => {
  const scopedGroups = intent.scope ? groups.filter(group => group.scope === intent.scope) : groups;
  const hitGroups = scopedGroups.filter(group => group.count > 0);
  const total = hitGroups.reduce((sum, group) => sum + group.count, 0);
  const query = intent.query;

  const summary = hitGroups
    .map(group => `${group.label} ${group.count}条`)
    .join(' · ');

  const quickJumpGroups = (intent.scope ? scopedGroups : groups).filter(group => group);
  const quickJumps = quickJumpGroups
    .map(group => `[${group.label}](${toHashLink(toRouteWithQuery(group.route, query))})`)
    .join(' · ');

  if (total === 0) {
    return [
      `### 未检索到「${query}」的结果`,
      '可尝试：缩短关键词、换企业简称/合同编号、或先不带“公司/有限公司”等后缀。',
      quickJumps ? `快速进入模块继续查找：${quickJumps}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const lines: string[] = [];
  lines.push(`### 已为你检索「${query}」`);
  lines.push(`命中 ${total} 条：${summary}`);

  hitGroups.forEach(group => {
    lines.push(`#### ${group.label}（${group.count}）`);
    group.records.forEach((record, idx) => {
      const secondary = record.secondary ? ` - ${record.secondary}` : '';
      lines.push(`${idx + 1}. ${record.primary}${secondary} [打开](${toHashLink(record.route)})`);
    });
  });

  if (quickJumps) lines.push(`快速跳转：${quickJumps}`);
  return lines.join('\n\n');
};
