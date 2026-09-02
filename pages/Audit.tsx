import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { AuditEvidence, AuditIssue, KnowledgeDoc } from '../types';
import {
  Search,
  AlertTriangle,
  AlertCircle,
  Plus,
  X,
  Sparkles,
  Loader2,
  Save,
  CheckCircle,
  BrainCircuit,
  ArrowUpRight,
  BookOpen,
  Upload,
  Paperclip,
  Eye,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  BarChart3,
  FileText,
  Trash2,
  Clock3
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { aiService } from '../services/aiService';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_ROUTES } from '../src/routes';
import { SearchInput, EmptyState, tableHeadClass, thClass, tdClass, trClass } from '../src/ui';

type AuditExampleTemplate = {
  id: string;
  title: string;
  industryHint?: string;
  auditType: string;
  severity: AuditIssue['severity'];
  findings: string;
  rectificationPlan: string;
  verificationNotes: string;
  evidenceExamples: Array<{ name: string; note: string; color: string }>;
};

type IssueViewModel = {
  issue: AuditIssue;
  relation: ReturnType<typeof buildRelationSnapshot>;
  topic: string;
  industry: string;
  evidenceCount: number;
  verified: boolean;
  overdue: boolean;
};

type DuplicateIssueInsight = {
  item: IssueViewModel;
  score: number;
  reasons: string[];
};

type SopRecommendation = {
  id: string;
  title: string;
  source: 'knowledge' | 'example';
  categoryLabel: string;
  summary: string;
  detail: string;
  tags: string[];
  knowledgeDocId?: string;
};

type SopExampleTemplate = {
  id: string;
  title: string;
  topic: string;
  summary: string;
  detail: string;
  tags: string[];
};

type TrendDatum = {
  key: string;
  name: string;
  新增: number;
  关闭: number;
  待验证: number;
};

type TrendInsight = {
  id: string;
  title: string;
  value: string;
  detail: string;
  tone: 'indigo' | 'emerald' | 'amber';
};

const ISSUE_TOPIC_RULES = [
  { label: '文件/记录控制', keywords: ['文件', '记录', '版本', '表单', '受控'] },
  { label: '培训与人员能力', keywords: ['培训', '上岗', '能力', '胜任', '资格'] },
  { label: '现场标识/环境', keywords: ['现场', '标识', '环境', '区域', '5S'] },
  { label: '供应商/采购控制', keywords: ['供应商', '采购', '外包', '来料'] },
  { label: '监视测量/追溯', keywords: ['校准', '点检', '检验', '监测', '追溯', 'CCP'] },
  { label: '风险/内审管理', keywords: ['风险', '内审', '管理评审', '目标', '纠正预防'] }
] as const;

const AUDIT_SOP_EXAMPLES: SopExampleTemplate[] = [
  {
    id: 'audit-sop-001',
    title: '文件版本切换闭环 SOP 示例',
    topic: '文件/记录控制',
    summary: '适用于受控文件版本失控、现场旧版文件未回收、清单未同步等问题。',
    detail: '1. 建立新版发布、旧版回收、岗位签收三联单；\n2. 文件修订后 24 小时内完成清单同步；\n3. 由部门负责人抽查岗位版本识别并保留记录。',
    tags: ['文件/记录控制', '受控文件', '签收']
  },
  {
    id: 'audit-sop-002',
    title: '岗位培训授权闭环 SOP 示例',
    topic: '培训与人员能力',
    summary: '适用于培训签到缺失、考试记录不完整、授权矩阵未更新等人员能力问题。',
    detail: '1. 统一执行“培训-考试-授权”三联流程；\n2. 对关键岗位建立授权清单与到期复审提醒；\n3. 现场抽查时同步核验课件、签到表与授权记录。',
    tags: ['培训与人员能力', '授权矩阵', '岗位胜任']
  },
  {
    id: 'audit-sop-003',
    title: 'CCP/追溯记录复核 SOP 示例',
    topic: '监视测量/追溯',
    summary: '适用于校准、点检、CCP 监控、批次追溯等记录断档或复核缺失场景。',
    detail: '1. 对关键记录设置班组长日复核；\n2. 异常偏差必须形成原因、纠正、复核三段式闭环；\n3. 每周抽查追溯链条完整性并保留台账。',
    tags: ['监视测量/追溯', 'CCP', '复核机制']
  }
];

const AUDIT_EXAMPLE_TEMPLATES: AuditExampleTemplate[] = [
  {
    id: 'audit-example-001',
    title: '文件版本失控示例',
    industryHint: '包装',
    auditType: 'External',
    severity: 'Major',
    findings: '现场抽查《包装袋来料检验规范》仍使用 2024 旧版文件，受控清单未同步更新，多个岗位无法确认现行版要求。',
    rectificationPlan: '1. 立即回收旧版文件并重新发布受控版本；\n2. 对仓储、品控、采购岗位开展 30 分钟版本识别培训；\n3. 建立文件修订后的 24 小时同步确认机制，并保留签收记录。',
    verificationNotes: '抽查 3 个岗位已全部使用新版文件，文件清单与签收记录一致，可关闭。',
    evidenceExamples: [
      { name: '示例-新版文件签收清单.svg', note: '用于示例展示“新版文件已签收”的证据样式。', color: '#2563eb' },
      { name: '示例-现场旧版回收记录.svg', note: '用于示例展示“旧版文件已回收销毁”的证据样式。', color: '#7c3aed' }
    ]
  },
  {
    id: 'audit-example-002',
    title: '培训记录缺失示例',
    industryHint: '机械',
    auditType: 'Internal',
    severity: 'Minor',
    findings: '新入职检验员已上岗，但岗位培训签到、考试记录及授权清单均未归档，无法证明其具备独立检验资格。',
    rectificationPlan: '1. 当天补齐岗位培训课件、签到与考核记录；\n2. 由质管负责人更新授权矩阵并公示；\n3. 后续新员工上岗前必须完成“培训-考试-授权”三联闭环。',
    verificationNotes: '已核验签到表、考试成绩与授权清单，岗位授权闭环完整，建议关闭。',
    evidenceExamples: [
      { name: '示例-岗位培训签到表.svg', note: '用于示例展示“培训签到表”证据。', color: '#059669' },
      { name: '示例-岗位授权清单.svg', note: '用于示例展示“岗位授权矩阵”证据。', color: '#ea580c' }
    ]
  },
  {
    id: 'audit-example-003',
    title: 'CCP 监控缺失示例',
    industryHint: '食品',
    auditType: 'Surveillance',
    severity: 'Major',
    findings: '抽查杀菌工序 CCP 监控记录，近 3 日关键温度记录存在空档，异常偏差处置未形成追溯闭环。',
    rectificationPlan: '1. 补录缺失监控数据并追溯偏差原因；\n2. 重新培训关键控制点记录要求；\n3. 增加班组长每日复核与异常升级机制。',
    verificationNotes: '连续 5 天抽查 CCP 记录完整，偏差处置台账已补齐并经食品安全小组复核通过。',
    evidenceExamples: [
      { name: '示例-CCP监控记录.svg', note: '用于示例展示“关键控制点监控记录”证据。', color: '#dc2626' },
      { name: '示例-偏差处置闭环单.svg', note: '用于示例展示“偏差处置闭环单”证据。', color: '#0f766e' }
    ]
  }
];

const buildDemoTrendData = (): TrendDatum[] => {
  const monthFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short' });
  const samples = [
    { 新增: 4, 关闭: 1, 待验证: 1 },
    { 新增: 3, 关闭: 2, 待验证: 1 },
    { 新增: 5, 关闭: 2, 待验证: 2 },
    { 新增: 4, 关闭: 3, 待验证: 2 },
    { 新增: 3, 关闭: 4, 待验证: 1 },
    { 新增: 2, 关闭: 3, 待验证: 1 }
  ];

  return samples.map((sample, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (samples.length - 1 - index), 1);
    return {
      key: date.toISOString().slice(0, 7),
      name: monthFormatter.format(date),
      ...sample
    };
  });
};

const formatSize = (bytes: number) => {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
};

const normalizeKeyword = (value: string) => String(value || '').trim().toLowerCase();

const buildSvgDataUrl = (title: string, note: string, color: string) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <rect width="1200" height="720" rx="40" fill="#F8FAFC" />
      <rect x="56" y="56" width="1088" height="608" rx="28" fill="white" stroke="#E2E8F0" stroke-width="4" />
      <rect x="88" y="96" width="220" height="52" rx="18" fill="${color}" opacity="0.12" />
      <text x="110" y="129" font-size="26" font-family="PingFang SC, Arial" fill="${color}" font-weight="700">整改证据示例</text>
      <text x="88" y="220" font-size="44" font-family="PingFang SC, Arial" fill="#0F172A" font-weight="700">${title}</text>
      <text x="88" y="286" font-size="28" font-family="PingFang SC, Arial" fill="#475569">${note}</text>
      <rect x="88" y="352" width="1024" height="220" rx="24" fill="#F8FAFC" stroke="#CBD5E1" stroke-dasharray="12 10" stroke-width="3" />
      <text x="120" y="430" font-size="30" font-family="PingFang SC, Arial" fill="#334155">1. 可替换成现场照片、截图、签收单、复核记录</text>
      <text x="120" y="488" font-size="30" font-family="PingFang SC, Arial" fill="#334155">2. 关闭问题前至少保留 1 份直接证据 + 1 份验证记录</text>
      <text x="120" y="546" font-size="30" font-family="PingFang SC, Arial" fill="#334155">3. 当前示例用于演示上传、预览与验证关闭流程</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const resolveIssueTopic = (findings?: string) => {
  const normalized = normalizeKeyword(String(findings || ''));
  const matched = ISSUE_TOPIC_RULES.find(rule => rule.keywords.some((keyword: string) => normalized.includes(normalizeKeyword(keyword))));
  if (matched) return matched.label;
  const compact = String(findings || '').replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, 14) : '未分类问题';
};

const parseDateMs = (value?: string) => {
  const ts = new Date(String(value || '')).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const diffDays = (start?: string, end?: string) => {
  const from = parseDateMs(start);
  const to = parseDateMs(end);
  if (!from || !to || to < from) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
};

const summarizeText = (value?: string, max = 96) => {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

const getTopicKeywords = (topic: string) => {
  const matched = ISSUE_TOPIC_RULES.find(rule => rule.label === topic);
  return Array.from(new Set([topic, ...(matched?.keywords || [])].map(normalizeKeyword).filter(Boolean)));
};

const buildRelationSnapshot = (
  issue: Partial<AuditIssue>,
  customers: Array<{ id: string; name: string; industry?: string }>,
  projects: Array<{ id: string; name: string; customerId?: string; contractRef?: string }>,
  contracts: Array<{ id: string; contractNo?: string; customerId?: string; customerName: string; serviceLine: string }>
) => {
  const resolveProjectContract = (project?: { contractRef?: string }) => {
    if (!project?.contractRef) return undefined;
    return contracts.find(contract => contract.id === project.contractRef || contract.contractNo === project.contractRef);
  };

  const resolveProjectCustomerId = (project?: { customerId?: string; contractRef?: string }) => {
    if (!project) return '';
    return project.customerId || resolveProjectContract(project)?.customerId || '';
  };

  const linkedContract = issue.contractId
    ? contracts.find(contract => contract.id === issue.contractId)
    : contracts.find(contract => contract.id === issue.contractRef || contract.contractNo === issue.contractRef);
  const linkedProject = issue.projectId
    ? projects.find(project => project.id === issue.projectId)
    : linkedContract
      ? projects.find(project => project.contractRef === linkedContract.id || (linkedContract.contractNo && project.contractRef === linkedContract.contractNo))
      : undefined;
  const resolvedCustomerId = issue.customerId
    || resolveProjectCustomerId(linkedProject)
    || linkedContract?.customerId
    || customers.find(customer => customer.name === issue.customerName)?.id
    || '';
  const linkedCustomer = resolvedCustomerId ? customers.find(customer => customer.id === resolvedCustomerId) : undefined;

  return {
    customer: linkedCustomer,
    project: linkedProject,
    contract: linkedContract,
    customerId: resolvedCustomerId,
    customerName: linkedCustomer?.name || linkedContract?.customerName || issue.customerName || '',
    contractLabel: linkedContract?.contractNo || linkedContract?.id || issue.contractRef || ''
  };
};

const Audit = () => {
  const { auditIssues, addAuditIssue, updateAuditIssue, projects, customers, contracts, knowledgeDocs, addKnowledgeDoc, addReminder, currentUser } = useApp();
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState<'All' | 'Open' | 'Closed'>('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<AuditIssue | null>(null);
  const [isExtracting, setIsExtracting] = useState<string | null>(null);
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<null | { name: string; url: string; kind: 'image' | 'pdf' }>(null);
  const location = useLocation();
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);

  const buildDefaultFormData = (): Partial<AuditIssue> => ({
    customerId: '',
    customerName: '',
    projectId: '',
    contractId: '',
    contractRef: '',
    auditType: 'Internal',
    findings: '',
    severity: 'Minor',
    status: 'Open',
    auditor: currentUser.name || '当前用户',
    rectificationPlan: '',
    createDate: new Date().toISOString().split('T')[0],
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    evidences: [],
    verification: {
      verifiedBy: currentUser.name || '',
      verifiedAt: new Date().toISOString().split('T')[0],
      notes: ''
    }
  });

  const [formData, setFormData] = useState<Partial<AuditIssue>>(buildDefaultFormData());

  const resolveIssueRelations = (issue: Partial<AuditIssue>) => buildRelationSnapshot(issue, customers, projects, contracts);

  const selectedCustomerId = String(formData.customerId || '');
  const availableProjects = useMemo(() => projects.filter(project => {
    if (!selectedCustomerId) return true;
    const relation = resolveIssueRelations({ projectId: project.id });
    return relation.customerId === selectedCustomerId;
  }), [projects, contracts, customers, selectedCustomerId]);

  const availableContracts = useMemo(() => {
    const selectedCustomer = customers.find(customer => customer.id === selectedCustomerId);
    return contracts.filter(contract => {
      if (!selectedCustomerId) return true;
      return contract.customerId === selectedCustomerId || (!!selectedCustomer?.name && contract.customerName === selectedCustomer.name);
    });
  }, [contracts, customers, selectedCustomerId]);

  const currentRelation = resolveIssueRelations(formData);

  const issueViewModels = useMemo<IssueViewModel[]>(() => auditIssues.map(issue => {
    const relation = resolveIssueRelations(issue);
    const verificationDate = issue.verification?.verifiedAt;
    const evidenceCount = Array.isArray(issue.evidences) ? issue.evidences.length : 0;
    const verified = issue.status === 'Closed' && !!issue.verification?.verifiedBy && !!verificationDate;
    const overdue = issue.status !== 'Closed' && !!issue.deadline && parseDateMs(issue.deadline) < Date.now();
    return {
      issue,
      relation,
      topic: resolveIssueTopic(issue.findings),
      industry: relation.customer?.industry || '未标注行业',
      evidenceCount,
      verified,
      overdue
    };
  }).sort((a, b) => {
    const closedDiff = Number(a.issue.status === 'Closed') - Number(b.issue.status === 'Closed');
    if (closedDiff !== 0) return closedDiff;
    return parseDateMs(b.issue.deadline || b.issue.createDate) - parseDateMs(a.issue.deadline || a.issue.createDate);
  }), [auditIssues, customers, projects, contracts]);

  const filteredIssues = useMemo(() => issueViewModels.filter(({ issue, relation, topic }) => {
    if (filterStatus === 'Open' && issue.status === 'Closed') return false;
    if (filterStatus === 'Closed' && issue.status !== 'Closed') return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      relation.customerName,
      relation.project?.name,
      relation.contractLabel,
      issue.findings,
      issue.rectificationPlan,
      issue.auditor,
      issue.verification?.verifiedBy,
      topic
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  }), [issueViewModels, filterStatus, searchQuery]);

  const openIssues = issueViewModels.filter(item => item.issue.status !== 'Closed').length;
  const majorIssues = issueViewModels.filter(item => item.issue.severity === 'Major' && item.issue.status !== 'Closed').length;
  const verifyingIssues = issueViewModels.filter(item => item.issue.status === 'Verifying').length;
  const evidenceCoverageRate = issueViewModels.length > 0
    ? Math.round((issueViewModels.filter(item => item.evidenceCount > 0).length / issueViewModels.length) * 100)
    : 0;
  const closedIssues = issueViewModels.filter(item => item.issue.status === 'Closed');
  const verifiedClosedRate = issueViewModels.length > 0 ? Math.round((closedIssues.length / issueViewModels.length) * 100) : 0;
  const avgCloseDays = (() => {
    const values = closedIssues
      .map(item => diffDays(item.issue.createDate, item.issue.verification?.verifiedAt || item.issue.deadline))
      .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  })();

  const trendData = useMemo<TrendDatum[]>(() => {
    const monthFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short' });
    const months: TrendDatum[] = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index), 1);
      const key = date.toISOString().slice(0, 7);
      return {
        key,
        name: monthFormatter.format(date),
        新增: 0,
        关闭: 0,
        待验证: 0
      };
    });
    const monthMap = new Map(months.map(item => [item.key, item]));
    issueViewModels.forEach(({ issue }) => {
      const createdKey = String(issue.createDate || '').slice(0, 7);
      if (monthMap.has(createdKey)) monthMap.get(createdKey)!.新增 += 1;
      const closedKey = String(issue.verification?.verifiedAt || (issue.status === 'Closed' ? issue.deadline : '') || '').slice(0, 7);
      if (closedKey && monthMap.has(closedKey)) monthMap.get(closedKey)!.关闭 += 1;
      if (issue.status === 'Verifying' && monthMap.has(createdKey)) monthMap.get(createdKey)!.待验证 += 1;
    });
    return months;
  }, [issueViewModels]);

  const hasRealTrendData = issueViewModels.length > 0;
  const displayTrendData = useMemo<TrendDatum[]>(() => hasRealTrendData ? trendData : buildDemoTrendData(), [hasRealTrendData, trendData]);
  const displayClosedCount = hasRealTrendData ? closedIssues.length : displayTrendData.reduce((sum, item) => sum + item.关闭, 0);
  const displayAvgCloseDays = hasRealTrendData ? avgCloseDays : 9;
  const latestTrendPoint = displayTrendData[displayTrendData.length - 1];
  const previousTrendPoint = displayTrendData[displayTrendData.length - 2];
  const trendTotals = useMemo(() => displayTrendData.reduce((acc, item) => ({
    新增: acc.新增 + item.新增,
    关闭: acc.关闭 + item.关闭,
    待验证: acc.待验证 + item.待验证
  }), { 新增: 0, 关闭: 0, 待验证: 0 }), [displayTrendData]);

  const consultantStats = useMemo(() => Object.values(issueViewModels.reduce<Record<string, { name: string; count: number; open: number; closed: number; major: number }>>((acc, item) => {
    const key = item.issue.auditor || '未分配';
    if (!acc[key]) acc[key] = { name: key, count: 0, open: 0, closed: 0, major: 0 };
    acc[key].count += 1;
    if (item.issue.status === 'Closed') acc[key].closed += 1;
    else acc[key].open += 1;
    if (item.issue.severity === 'Major') acc[key].major += 1;
    return acc;
  }, {})).map(item => ({
    ...item,
    closeRate: item.count > 0 ? Math.round((item.closed / item.count) * 100) : 0
  })).sort((a, b) => b.count - a.count || b.closeRate - a.closeRate).slice(0, 5), [issueViewModels]);

  const industryStats = useMemo(() => Object.values(issueViewModels.reduce<Record<string, { name: string; count: number; open: number; major: number; overdue: number }>>((acc, item) => {
    const key = item.industry;
    if (!acc[key]) acc[key] = { name: key, count: 0, open: 0, major: 0, overdue: 0 };
    acc[key].count += 1;
    if (item.issue.status !== 'Closed') acc[key].open += 1;
    if (item.issue.severity === 'Major') acc[key].major += 1;
    if (item.overdue) acc[key].overdue += 1;
    return acc;
  }, {})).sort((a, b) => b.count - a.count || b.major - a.major).slice(0, 5), [issueViewModels]);

  const topicStats = useMemo(() => Object.values(issueViewModels.reduce<Record<string, { topic: string; count: number; open: number; sample: string; sampleCustomer: string }>>((acc, item) => {
    const key = item.topic;
    if (!acc[key]) {
      acc[key] = {
        topic: key,
        count: 0,
        open: 0,
        sample: item.issue.findings,
        sampleCustomer: item.relation.customerName || '未绑定客户'
      };
    }
    acc[key].count += 1;
    if (item.issue.status !== 'Closed') acc[key].open += 1;
    return acc;
  }, {})).sort((a, b) => b.count - a.count || b.open - a.open).slice(0, 6), [issueViewModels]);

  const trendInsights = useMemo<TrendInsight[]>(() => {
    const gap = trendTotals.新增 - trendTotals.关闭;
    const latestDelta = latestTrendPoint && previousTrendPoint ? latestTrendPoint.新增 - previousTrendPoint.新增 : 0;
    const topTopic = topicStats[0];
    const topIndustry = industryStats[0];

    if (!hasRealTrendData) {
      return [
        {
          id: 'demo-closure',
          title: '示例闭环节奏',
          value: '新增趋缓、关闭追上',
          detail: '演示口径里近 6 个月后两个月“关闭 ≥ 新增”，说明整改闭环开始追上问题暴露速度。',
          tone: 'emerald'
        },
        {
          id: 'demo-verifying',
          title: '示例验证压力',
          value: `尾月待验证 ${latestTrendPoint?.待验证 || 0} 项`,
          detail: '这类项通常代表整改动作已做，但验证确认还未完成，最容易卡在“已整改未关单”。',
          tone: 'amber'
        },
        {
          id: 'demo-focus',
          title: '示例关注主题',
          value: '文件控制 / 培训授权 / CCP 记录',
          detail: '这 3 类问题最适合先沉淀成标准 SOP 和证据模板，演示区右侧已经给了可直接带入的案例。',
          tone: 'indigo'
        }
      ];
    }

    return [
      {
        id: 'closure',
        title: '闭环效率',
        value: gap > 0 ? `净积压 ${gap} 项` : `净消化 ${Math.abs(gap)} 项`,
        detail: `近 6 个月累计新增 ${trendTotals.新增} 项、关闭 ${trendTotals.关闭} 项，${gap > 0 ? '问题库存仍在增加，需要追闭环。' : '关闭速度已追平或超过新增。'}`,
        tone: gap > 0 ? 'amber' : 'emerald'
      },
      {
        id: 'trend',
        title: '本月走势',
        value: latestDelta > 0 ? `新增较上月 +${latestDelta}` : latestDelta < 0 ? `新增较上月 ${latestDelta}` : '新增与上月持平',
        detail: `当前月新增 ${latestTrendPoint?.新增 || 0} 项、关闭 ${latestTrendPoint?.关闭 || 0} 项、待验证 ${latestTrendPoint?.待验证 || 0} 项。`,
        tone: (latestTrendPoint?.待验证 || 0) > 0 ? 'amber' : 'indigo'
      },
      {
        id: 'focus',
        title: '风险焦点',
        value: topTopic ? topTopic.topic : '暂无集中问题',
        detail: topTopic
          ? `当前高频问题共 ${topTopic.count} 次，未闭环 ${topTopic.open} 项${topIndustry ? `；${topIndustry.name} 行业问题最多（${topIndustry.count} 项）。` : '。'}`
          : '当前还没有足够的问题数据来判断集中风险。',
        tone: 'indigo'
      }
    ];
  }, [trendTotals, latestTrendPoint, previousTrendPoint, topicStats, industryStats, hasRealTrendData]);

  const trendNarrative = useMemo(() => {
    if (!latestTrendPoint) return '暂无趋势数据。';
    if (!hasRealTrendData) {
      return '当前图表与下方洞察先展示系统演示口径，帮助你说明“新增、关闭、待验证”分别代表什么。点击右侧任一示例模板，可直接带出问题事实、整改动作、验证结论和示例证据。';
    }

    const gap = trendTotals.新增 - trendTotals.关闭;
    const topTopic = topicStats[0];
    return `近 6 个月累计新增 ${trendTotals.新增} 项、关闭 ${trendTotals.关闭} 项、待验证 ${trendTotals.待验证} 项，当前月关闭 ${latestTrendPoint.关闭} 项。${gap > 0 ? '整体仍存在闭环积压，建议优先追踪待验证和超期项。' : '整体闭环节奏良好，可转向沉淀 SOP 和复用案例。'}${topTopic ? `目前最集中的问题类型是“${topTopic.topic}”，可优先做专项预防。` : ''}`;
  }, [latestTrendPoint, hasRealTrendData, trendTotals, topicStats]);

  const currentTopic = useMemo(() => resolveIssueTopic(formData.findings), [formData.findings]);
  const currentIndustry = currentRelation.customer?.industry || '';
  const duplicateInsights = useMemo<DuplicateIssueInsight[]>(() => {
    const findings = String(formData.findings || '').trim();
    if (!findings) return [];

    const normalizedFindings = normalizeKeyword(findings);
    const findingsPrefix = normalizedFindings.slice(0, 16);

    return issueViewModels
      .filter(({ issue }) => issue.id !== editingIssue?.id)
      .map(item => {
        const reasons: string[] = [];
        let score = 0;
        const sameTopic = item.topic === currentTopic;
        const sameCustomer = !!currentRelation.customerId && item.relation.customerId === currentRelation.customerId;
        const sameIndustry = !!currentIndustry && item.industry === currentIndustry;
        const otherFindings = normalizeKeyword(item.issue.findings);
        const otherPrefix = otherFindings.slice(0, 16);
        const textSimilar = !!findingsPrefix && !!otherPrefix && (normalizedFindings.includes(otherPrefix) || otherFindings.includes(findingsPrefix));

        if (sameTopic) {
          score += 4;
          reasons.push(`同类问题：${item.topic}`);
        }
        if (sameCustomer) {
          score += 3;
          reasons.push('同一客户');
        } else if (sameIndustry) {
          score += 2;
          reasons.push(`同行业：${currentIndustry}`);
        }
        if (textSimilar) {
          score += 2;
          reasons.push('描述高度相似');
        }
        if (item.issue.status !== 'Closed') {
          score += 1;
          reasons.push('当前仍未闭环');
        }
        if (item.issue.auditType && item.issue.auditType === formData.auditType) {
          score += 1;
          reasons.push(`同审核类型：${item.issue.auditType}`);
        }

        return { item, score, reasons: Array.from(new Set(reasons)) };
      })
      .filter(item => item.score >= 5 || (item.reasons.includes('同一客户') && item.reasons.some(reason => reason.startsWith('同类问题'))))
      .sort((a, b) => b.score - a.score || parseDateMs(b.item.issue.createDate || b.item.issue.deadline) - parseDateMs(a.item.issue.createDate || a.item.issue.deadline))
      .slice(0, 3);
  }, [formData.findings, formData.auditType, currentTopic, currentIndustry, currentRelation.customerId, issueViewModels, editingIssue?.id]);

  const relatedOpenIssueCount = useMemo(() => {
    if (!currentTopic) return 0;
    return issueViewModels.filter(item => item.issue.id !== editingIssue?.id && item.topic === currentTopic && item.issue.status !== 'Closed').length;
  }, [issueViewModels, currentTopic, editingIssue?.id]);

  const sopRecommendations = useMemo<SopRecommendation[]>(() => {
    const findings = String(formData.findings || '').trim();
    const topicKeywords = getTopicKeywords(currentTopic);
    const industryKeyword = normalizeKeyword(currentIndustry);
    const serviceLineKeyword = normalizeKeyword(currentRelation.contract?.serviceLine || '');

    const knowledgeMatches = knowledgeDocs
      .filter(doc => doc.linkType !== 'audit')
      .map(doc => {
        const haystack = normalizeKeyword([
          doc.title,
          doc.category,
          doc.summary,
          doc.content,
          doc.linkTitle,
          (doc.tags || []).join(' ')
        ].filter(Boolean).join(' '));
        let score = 0;
        if (doc.category === 'Template') score += 4;
        if (doc.category === 'Standard') score += 3;
        if (doc.category === 'Training') score += 2;
        if (doc.aiVisible !== false) score += 1;
        if (topicKeywords.some((keyword: string) => haystack.includes(keyword))) score += 4;
        if (industryKeyword && haystack.includes(industryKeyword)) score += 2;
        if (serviceLineKeyword && haystack.includes(serviceLineKeyword)) score += 2;
        if (findings && haystack.includes(normalizeKeyword(findings).slice(0, 10))) score += 1;
        return { doc, score };
      })
      .filter(item => item.score >= (findings ? 5 : 3))
      .sort((a, b) => b.score - a.score || String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)))
      .slice(0, 2)
      .map(({ doc }) => ({
        id: doc.id,
        title: doc.title,
        source: 'knowledge' as const,
        categoryLabel: `知识中心 · ${doc.category}`,
        summary: summarizeText(doc.summary || doc.linkTitle || doc.content, 88) || '可作为整改与预防动作参考。',
        detail: summarizeText(doc.content || doc.summary || doc.linkTitle, 140) || '建议结合知识卡内容完善整改闭环动作。',
        tags: (doc.tags || []).slice(0, 3),
        knowledgeDocId: doc.id
      }));

    const exampleMatches = AUDIT_SOP_EXAMPLES
      .filter(item => !findings || item.topic === currentTopic || item.tags.some((tag: string) => topicKeywords.includes(normalizeKeyword(tag))))
      .map(item => ({
        id: item.id,
        title: item.title,
        source: 'example' as const,
        categoryLabel: 'SOP 示例',
        summary: item.summary,
        detail: item.detail,
        tags: item.tags
      }));

    return [...knowledgeMatches, ...exampleMatches]
      .filter((item, index, arr) => arr.findIndex(candidate => candidate.title === item.title) === index)
      .slice(0, 3);
  }, [formData.findings, currentTopic, currentIndustry, currentRelation.contract?.serviceLine, knowledgeDocs]);

  const handleApplySopRecommendation = (recommendation: SopRecommendation) => {
    const prefix = recommendation.source === 'knowledge' ? '知识卡参考' : 'SOP 示例';
    setFormData(prev => ({
      ...prev,
      rectificationPlan: [
        String(prev.rectificationPlan || '').trim(),
        `【${prefix}】${recommendation.title}\n${recommendation.detail}`
      ].filter(Boolean).join('\n\n')
    }));
  };

  const handleOpenKnowledgeDoc = (knowledgeDocId?: string) => {
    if (!knowledgeDocId) return;
    navigate(APP_ROUTES.KNOWLEDGE, { state: { openDetailId: knowledgeDocId } });
  };

  const handleOpenModal = (issue?: AuditIssue) => {
    if (issue) {
      const relation = resolveIssueRelations(issue);
      setEditingIssue(issue);
      setFormData({
        ...buildDefaultFormData(),
        ...issue,
        customerId: relation.customerId,
        customerName: relation.customerName,
        projectId: relation.project?.id || issue.projectId || '',
        contractId: relation.contract?.id || issue.contractId || '',
        contractRef: relation.contractLabel,
        evidences: Array.isArray(issue.evidences) ? issue.evidences : [],
        verification: {
          verifiedBy: issue.verification?.verifiedBy || currentUser.name || '',
          verifiedAt: issue.verification?.verifiedAt || new Date().toISOString().split('T')[0],
          notes: issue.verification?.notes || ''
        }
      });
    } else {
      setEditingIssue(null);
      setFormData(buildDefaultFormData());
    }
    setIsModalOpen(true);
  };

  useEffect(() => {
    const targetId = (location.state as { openDetailId?: string } | null)?.openDetailId;
    if (!targetId) return;
    const targetIssue = auditIssues.find(issue => issue.id === targetId);
    if (targetIssue) {
      handleOpenModal(targetIssue);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, auditIssues]);

  const handleCustomerChange = (customerId: string) => {
    const selectedCustomer = customers.find(customer => customer.id === customerId);
    setFormData(prev => {
      const currentProject = projects.find(project => project.id === prev.projectId);
      const currentContract = contracts.find(contract => contract.id === prev.contractId);
      const projectRelation = currentProject ? resolveIssueRelations({ projectId: currentProject.id }) : null;
      const keepProject = !!currentProject && projectRelation?.customerId === customerId;
      const keepContract = !!currentContract && (currentContract.customerId === customerId || currentContract.customerName === selectedCustomer?.name);
      return {
        ...prev,
        customerId,
        customerName: selectedCustomer?.name || '',
        projectId: keepProject ? prev.projectId : '',
        contractId: keepContract ? prev.contractId : '',
        contractRef: keepContract && currentContract ? (currentContract.contractNo || currentContract.id) : ''
      };
    });
  };

  const handleProjectChange = (projectId: string) => {
    if (!projectId) {
      setFormData(prev => ({ ...prev, projectId: '' }));
      return;
    }

    const relation = resolveIssueRelations({ projectId });
    setFormData(prev => ({
      ...prev,
      projectId,
      customerId: relation.customerId || prev.customerId || '',
      customerName: relation.customerName || prev.customerName || '',
      contractId: relation.contract?.id || prev.contractId || '',
      contractRef: relation.contractLabel || prev.contractRef || ''
    }));
  };

  const handleContractChange = (contractId: string) => {
    if (!contractId) {
      setFormData(prev => ({ ...prev, contractId: '', contractRef: '' }));
      return;
    }

    const relation = resolveIssueRelations({ contractId });
    setFormData(prev => ({
      ...prev,
      contractId,
      contractRef: relation.contractLabel,
      projectId: relation.project?.id || prev.projectId || '',
      customerId: relation.customerId || prev.customerId || '',
      customerName: relation.customerName || prev.customerName || ''
    }));
  };

  const updateFormStatus = (status: AuditIssue['status']) => {
    setFormData(prev => ({
      ...prev,
      status,
      verification: {
        verifiedBy: prev.verification?.verifiedBy || currentUser.name || '',
        verifiedAt: prev.verification?.verifiedAt || new Date().toISOString().split('T')[0],
        notes: prev.verification?.notes || ''
      }
    }));
  };

  const handleAIPlan = async () => {
    if (!formData.findings) {
      alert('请先填写问题描述（不符合项事实）');
      return;
    }
    setIsGenerating(true);
    try {
      const prompt = `
        Context: ISO 认证审计记录。作为首席审计员，请根据以下发现点生成专业的整改方案。
        客户: ${currentRelation.customerName || '未知客户'}
        项目: ${currentRelation.project?.name || '未绑定项目'}
        审核类型: ${formData.auditType}
        发现点: "${formData.findings}"
        严重性: ${formData.severity}
        
        输出结构：
        1. 原因分析 (Root Cause)
        2. 纠正措施 (Correction)
        3. 预防措施 (Preventive Action)
      `;

      const text = await aiService.generateText('kimi-k2.5', prompt);
      setFormData(prev => ({ ...prev, rectificationPlan: text }));
    } catch (e) {
      console.error(e);
      alert('AI 生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExtractExperience = async (issue: AuditIssue) => {
    if (issue.knowledgeDocId) {
      alert('该问题已完成经验提炼，并已进入知识中心。');
      return;
    }

    const relation = resolveIssueRelations(issue);
    setIsExtracting(issue.id);
    try {
      const prompt = `
        任务：将审计教训转化为“企业百科经验”。
        客户：${relation.customerName || '未知客户'}
        项目：${relation.project?.name || '未绑定项目'}
        合同服务线：${relation.contract?.serviceLine || '未关联'}
        审核类别：${issue.auditType || '未填写'}
        严重度：${issue.severity}
        问题：${issue.findings}
        整改：${issue.rectificationPlan || '未填写'}
        验证结论：${issue.verification?.notes || '未填写'}

        请提炼出一条 100 字以内的“避坑锦囊”，告诉其他项目组成员在遇到类似项目时如何预防此类问题。
        输出 JSON: { "title": "经验标题", "content": "避坑内容" }
      `;

      const result = await aiService.generateJSON('kimi-k2.5', prompt);
      const title = String(result?.title || issue.findings || '审计经验').trim().slice(0, 60);
      const content = String(result?.content || issue.rectificationPlan || issue.findings || '').trim();
      const summary = content.slice(0, 100);
      const evidenceList = (issue.evidences || []).map(evidence => `- ${evidence.name}${evidence.note ? `：${evidence.note}` : ''}`);
      const knowledgeContent = [
        '## 避坑锦囊',
        content,
        '',
        '## 验证结论',
        issue.verification?.notes || '未填写',
        '',
        '## 整改证据清单',
        evidenceList.length > 0 ? evidenceList.join('\n') : '- 暂无同步证据',
        '',
        '## 关联背景',
        `- 客户：${relation.customerName || '未知客户'}`,
        `- 项目：${relation.project?.name || '未绑定项目'}`,
        `- 合同服务线：${relation.contract?.serviceLine || '未关联'}`,
        `- 审核类别：${issue.auditType || '未填写'}`,
        `- 严重度：${issue.severity}`
      ].join('\n');
      const tags = Array.from(new Set([
        '审计教训',
        '验证关闭',
        issue.auditType,
        issue.severity,
        relation.customer?.industry,
        relation.contract?.serviceLine,
        resolveIssueTopic(issue.findings)
      ].filter((tag): tag is string => Boolean(tag && String(tag).trim()))));

      const newDoc: KnowledgeDoc = {
        id: `EXP-${Date.now()}`,
        title: `【审计教训】${title}`,
        category: 'Training',
        format: 'AI-Insight',
        size: `${Math.max(0.1, Number((knowledgeContent.length / 1024).toFixed(1)))} KB`,
        updatedAt: new Date().toISOString().split('T')[0],
        summary,
        content: knowledgeContent,
        aiVisible: true,
        linkType: 'audit',
        linkId: issue.id,
        linkTitle: issue.findings.slice(0, 60),
        tags,
        source: 'ai',
        autoGenerated: true
      };

      const resultOfSave = await addKnowledgeDoc(newDoc);
      const duplicateId = resultOfSave?.duplicateId;
      updateAuditIssue(issue.id, { knowledgeDocId: duplicateId || newDoc.id });
      if (duplicateId) {
        alert('✅ 已发现重复经验，系统已直接关联到现有知识卡片。');
      } else {
        alert('✅ 经验已提取并注入知识中心，后续 AI 将可直接引用。');
      }
    } catch (e) {
      console.error(e);
      alert('经验提炼失败，请稍后重试。');
    } finally {
      setIsExtracting(null);
    }
  };

  /**
   * 证据文件走服务端上传，只保留返回的 URL。
   * 不要再转 base64 存进数据字段：一张手机照片 base64 后 4-7MB，几十张就会撑爆数据库并拖垮列表加载。
   */
  const handleEvidencePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploadingEvidence(true);
    try {
      const body = new FormData();
      files.forEach(file => body.append('files', file));
      const response = await fetch('/api/uploads/audit-evidence', {
        method: 'POST',
        body,
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.code !== 0) {
        throw new Error(payload?.message || `上传失败（${response.status}）`);
      }
      const uploaded: AuditEvidence[] = (payload.data?.files || []).map((file: any, index: number) => ({
        id: `AE-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`,
        name: String(file.name || '未命名文件'),
        size: String(file.size || ''),
        type: String(file.type || 'file'),
        uploadDate: String(file.uploadDate || new Date().toISOString().split('T')[0]),
        uploadedBy: currentUser.name,
        note: '',
        url: String(file.url || '')
      }));
      if (uploaded.length === 0) throw new Error('服务端未返回文件信息');
      setFormData(prev => ({
        ...prev,
        status: prev.status === 'Open' ? 'Rectifying' : prev.status,
        evidences: [...(prev.evidences || []), ...uploaded]
      }));
    } catch (error) {
      console.error(error);
      alert(`证据上传失败：${error instanceof Error ? error.message : '请稍后重试'}`);
    } finally {
      setIsUploadingEvidence(false);
      e.target.value = '';
    }
  };

  const patchEvidence = (evidenceId: string, updates: Partial<AuditEvidence>) => {
    setFormData(prev => ({
      ...prev,
      evidences: (prev.evidences || []).map(item => item.id === evidenceId ? { ...item, ...updates } : item)
    }));
  };

  const removeEvidence = (evidenceId: string) => {
    setFormData(prev => ({
      ...prev,
      evidences: (prev.evidences || []).filter(item => item.id !== evidenceId)
    }));
  };

  const buildExampleEvidenceList = (template: AuditExampleTemplate): AuditEvidence[] => template.evidenceExamples.map((item, index) => ({
    id: `AE-EXAMPLE-${template.id}-${index + 1}`,
    name: item.name,
    size: '示例文件',
    type: 'image/svg+xml',
    uploadDate: new Date().toISOString().split('T')[0],
    uploadedBy: '系统示例',
    note: item.note,
    url: buildSvgDataUrl(item.name, item.note, item.color),
    isExample: true
  }));

  const applyExampleTemplate = (template: AuditExampleTemplate) => {
    const matchedCustomer = customers.find(customer => String(customer.industry || '').includes(String(template.industryHint || '')))
      || customers[0];
    const matchedProject = matchedCustomer
      ? projects.find(project => resolveIssueRelations({ projectId: project.id }).customerId === matchedCustomer.id)
      : undefined;
    const matchedContract = matchedProject
      ? resolveIssueRelations({ projectId: matchedProject.id }).contract
      : matchedCustomer
        ? contracts.find(contract => contract.customerId === matchedCustomer.id || contract.customerName === matchedCustomer.name)
        : undefined;

    setEditingIssue(null);
    setFormData({
      ...buildDefaultFormData(),
      customerId: matchedCustomer?.id || '',
      customerName: matchedCustomer?.name || '',
      projectId: matchedProject?.id || '',
      contractId: matchedContract?.id || '',
      contractRef: matchedContract ? (matchedContract.contractNo || matchedContract.id) : '',
      auditType: template.auditType,
      severity: template.severity,
      findings: template.findings,
      rectificationPlan: template.rectificationPlan,
      status: 'Verifying',
      evidences: buildExampleEvidenceList(template),
      verification: {
        verifiedBy: currentUser.name || '',
        verifiedAt: new Date().toISOString().split('T')[0],
        notes: template.verificationNotes
      }
    });
    setIsModalOpen(true);
  };

  const resolvePreviewKind = (evidence: AuditEvidence) => {
    const type = String(evidence.type || '').toLowerCase();
    const url = String(evidence.url || '');
    if (!url) return null;
    if (type.includes('pdf') || url.startsWith('data:application/pdf')) return { url, kind: 'pdf' as const };
    if (type.includes('image') || url.startsWith('data:image')) return { url, kind: 'image' as const };
    return null;
  };

  const handlePreviewEvidence = (evidence: AuditEvidence) => {
    const resolved = resolvePreviewKind(evidence);
    if (!resolved) {
      alert('当前证据仅支持图片/PDF 预览，请改用下载查看。');
      return;
    }
    setPreviewEvidence({ name: evidence.name, url: resolved.url, kind: resolved.kind });
  };

  const handleDownloadEvidence = (evidence: AuditEvidence) => {
    if (!evidence.url) {
      alert('当前证据暂无可下载地址。');
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = evidence.url;
    anchor.download = evidence.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const buildVerificationPayload = () => {
    const verifiedBy = String(formData.verification?.verifiedBy || '').trim();
    const verifiedAt = String(formData.verification?.verifiedAt || '').trim();
    const notes = String(formData.verification?.notes || '').trim();
    if (!verifiedBy && !verifiedAt && !notes) return undefined;
    return { verifiedBy, verifiedAt, notes };
  };

  const validateBeforeClose = (payload: Omit<AuditIssue, 'id'>) => {
    if (payload.status !== 'Closed') return true;
    const evidences = payload.evidences || [];
    const verification = payload.verification;
    if (evidences.length === 0) {
      alert('验证关闭前请至少上传 1 份整改证据。');
      return false;
    }
    if (!verification?.verifiedBy || !verification?.verifiedAt || !String(verification.notes || '').trim()) {
      alert('验证关闭前请完整填写验证人、验证日期和验证结论。');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const findings = String(formData.findings || '').trim();
    const selectedProject = formData.projectId ? projects.find(project => project.id === formData.projectId) : undefined;
    const selectedContract = formData.contractId
      ? contracts.find(contract => contract.id === formData.contractId)
      : currentRelation.contract;
    const relation = resolveIssueRelations({
      customerId: formData.customerId,
      customerName: formData.customerName,
      projectId: selectedProject?.id,
      contractId: selectedContract?.id,
      contractRef: selectedContract ? (selectedContract.contractNo || selectedContract.id) : formData.contractRef
    });
    const resolvedCustomer = relation.customer;
    const customerName = resolvedCustomer?.name || selectedContract?.customerName || String(formData.customerName || '').trim();

    if (!relation.customerId || !customerName || !findings) return;

    const verification = buildVerificationPayload();
    const payload: Omit<AuditIssue, 'id'> = {
      customerId: relation.customerId,
      customerName,
      projectId: selectedProject?.id || relation.project?.id || undefined,
      contractId: selectedContract?.id || relation.contract?.id || undefined,
      contractRef: selectedContract ? (selectedContract.contractNo || selectedContract.id) : relation.contractLabel || undefined,
      findings,
      severity: formData.severity || 'Minor',
      status: formData.status || 'Open',
      auditor: String(formData.auditor || currentUser.name || '当前用户').trim() || '当前用户',
      rectificationPlan: String(formData.rectificationPlan || '').trim() || undefined,
      auditType: formData.auditType || 'Internal',
      createDate: formData.createDate || new Date().toISOString().split('T')[0],
      deadline: String(formData.deadline || '').trim() || undefined,
      rectificationTaskId: editingIssue?.rectificationTaskId,
      evidences: (formData.evidences || []).map(item => ({ ...item, note: String(item.note || '').trim() || undefined })),
      verification,
      knowledgeDocId: editingIssue?.knowledgeDocId
    };

    if (!validateBeforeClose(payload)) return;

    const issueId = editingIssue ? editingIssue.id : addAuditIssue(payload);
    if (editingIssue) {
      updateAuditIssue(editingIssue.id, payload);
    }

    if (payload.deadline) {
      addReminder({
        id: `REM-AUDIT-DEADLINE-${issueId}`,
        title: '🧾 审计整改跟进',
        content: `${payload.projectId ? `项目【${selectedProject?.name || customerName}】` : `客户【${customerName}】`}存在不符合项待闭环，整改截止：${payload.deadline}。`,
        date: payload.deadline,
        type: payload.severity === 'Major' ? 'risk' : 'task',
        linkType: 'audit',
        linkId: issueId,
        forRole: ['MANAGER', 'CONSULTANT']
      });
    }

    setEditingIssue(null);
    setFormData(buildDefaultFormData());
    setIsModalOpen(false);
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'Major':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold border border-red-200">严重</span>;
      case 'Minor':
        return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium border border-orange-200">一般</span>;
      case 'Observation':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium border border-blue-200">观察</span>;
      default:
        return severity;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Open':
        return <span className="text-sm text-red-600 font-medium">待整改</span>;
      case 'Rectifying':
        return <span className="text-sm text-orange-600 font-medium">整改中</span>;
      case 'Verifying':
        return <span className="text-sm text-blue-600 font-medium">待验证</span>;
      case 'Closed':
        return <span className="text-sm text-green-600 font-medium flex items-center"><CheckCircle className="w-3 h-3 mr-1" />已关闭</span>;
      default:
        return status;
    }
  };

  return (
    <div className="p-6 animate-in fade-in duration-500 space-y-6">
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">不符合项与经验提取</h1>
          <p className="text-sm text-gray-500 mt-1">V5.0：补齐证据上传、验证关闭、重复预警与 SOP 推荐闭环</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => applyExampleTemplate(AUDIT_EXAMPLE_TEMPLATES[0])}
            className="flex items-center px-4 py-2 bg-white text-indigo-700 rounded-lg border border-indigo-200 hover:bg-indigo-50 shadow-sm transition-all active:scale-95 text-sm font-bold"
          >
            <Sparkles className="w-4 h-4 mr-2" /> 加载示例问题
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95 text-sm font-bold"
          >
            <Plus className="w-4 h-4 mr-2" /> 登记不符合项
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-red-200 transition-colors">
          <div className="p-3 bg-red-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><AlertTriangle className="w-6 h-6 text-red-600" /></div>
          <div>
            <div className="text-2xl font-black text-gray-900">{openIssues}</div>
            <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">待整改/验证总数</div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-orange-200 transition-colors">
          <div className="p-3 bg-orange-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><AlertCircle className="w-6 h-6 text-orange-600" /></div>
          <div>
            <div className="text-2xl font-black text-gray-900">{majorIssues}</div>
            <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">严重不符合项 (Major)</div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-blue-200 transition-colors">
          <div className="p-3 bg-blue-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><ShieldCheck className="w-6 h-6 text-blue-600" /></div>
          <div>
            <div className="text-2xl font-black text-gray-900">{verifyingIssues}</div>
            <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">待验证关闭</div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 rounded-2xl shadow-lg flex items-center text-white">
          <div className="p-3 bg-white/20 rounded-xl mr-4"><Paperclip className="w-6 h-6" /></div>
          <div>
            <div className="text-2xl font-black">{evidenceCoverageRate}%</div>
            <div className="text-xs opacity-80 font-bold uppercase tracking-tight">证据覆盖率 / 已关闭 {verifiedClosedRate}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center"><TrendingUp className="w-5 h-5 mr-2 text-indigo-600" /> 审计趋势分析</h2>
              <p className="text-xs text-gray-500 mt-1">不仅看曲线，还直接告诉你闭环节奏、验证压力和当前风险焦点。</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold">
              {!hasRealTrendData && <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">当前显示演示口径</span>}
              <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">平均闭环 {displayAvgCloseDays ?? '-'} 天</span>
              <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">已验证关闭 {displayClosedCount} 项</span>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={displayTrendData}>
                <defs>
                  <linearGradient id="auditOpen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="auditClosed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="auditVerifying" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <Tooltip />
                <Area type="monotone" dataKey="新增" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#auditOpen)" />
                <Area type="monotone" dataKey="关闭" stroke="#059669" strokeWidth={3} fillOpacity={1} fill="url(#auditClosed)" />
                <Area type="monotone" dataKey="待验证" stroke="#F59E0B" strokeWidth={3} fillOpacity={1} fill="url(#auditVerifying)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            {trendInsights.map(item => (
              <div
                key={item.id}
                className={`rounded-2xl border p-4 ${item.tone === 'emerald' ? 'border-emerald-100 bg-emerald-50/70' : item.tone === 'amber' ? 'border-amber-100 bg-amber-50/70' : 'border-indigo-100 bg-indigo-50/70'}`}
              >
                <div className="text-[11px] font-black uppercase tracking-wide text-gray-500">{item.title}</div>
                <div className="mt-2 text-base font-black text-gray-900">{item.value}</div>
                <div className="mt-2 text-xs leading-6 text-gray-600">{item.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-gray-100 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-7">
            {trendNarrative}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-black text-gray-900 flex items-center"><Sparkles className="w-5 h-5 mr-2 text-amber-500" /> 示例模板</h2>
            <p className="text-xs text-gray-500 mt-1">每张卡都自带问题事实、整改动作、验证结论和证据示例，点击即可带入登记弹窗。</p>
          </div>
          <div className="space-y-3">
            {AUDIT_EXAMPLE_TEMPLATES.map(template => (
              <button
                key={template.id}
                onClick={() => applyExampleTemplate(template)}
                className="w-full text-left rounded-2xl border border-gray-100 bg-gray-50 p-4 hover:border-indigo-200 hover:bg-indigo-50/60 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-gray-900">{template.title}</div>
                    <div className="text-[11px] text-gray-400 mt-1">点击后可直接带出表单、证据和验证结论</div>
                  </div>
                  <span className={`text-[11px] font-black px-2 py-1 rounded-full border ${template.severity === 'Major' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{template.severity}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-gray-500">
                  <span className="px-2 py-1 rounded-full bg-white border border-gray-200">{template.auditType}</span>
                  <span className="px-2 py-1 rounded-full bg-white border border-gray-200">{template.evidenceExamples.length} 份示例证据</span>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-[11px] font-black text-gray-400">问题事实</div>
                    <div className="mt-1 text-xs text-gray-600 line-clamp-2">{template.findings}</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-[11px] font-black text-gray-400">整改动作</div>
                    <div className="mt-1 text-xs text-gray-600 line-clamp-2">{template.rectificationPlan}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <div className="text-[11px] font-black text-emerald-700">验证结论</div>
                    <div className="mt-1 text-xs text-emerald-800 line-clamp-2">{template.verificationNotes}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                    {template.evidenceExamples.map(item => (
                      <span key={item.name} className="px-2 py-1 rounded-full bg-white border border-gray-200">{item.name.replace('.svg', '')}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-6">
            示例用途：演示“上传证据 → 待验证 → 验证关闭 → 提炼经验”的完整动作链，不影响你现有字段结构。
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-black text-gray-900 flex items-center"><BarChart3 className="w-4 h-4 mr-2 text-indigo-600" /> 高频问题</h3>
              <p className="text-xs text-gray-500 mt-1">帮助识别最值得沉淀 SOP 的问题类型。</p>
            </div>
          </div>
          <div className="space-y-3">
            {topicStats.map(item => (
              <div key={item.topic} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-gray-900">{item.topic}</div>
                  <span className="text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-1">{item.count} 次</span>
                </div>
                <div className="text-xs text-gray-500 mt-2 line-clamp-2">示例：{item.sample}</div>
                <div className="mt-2 text-[11px] text-gray-400">关联客户：{item.sampleCustomer} · 未闭环 {item.open} 项</div>
              </div>
            ))}
            {topicStats.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">暂无问题数据，可先加载示例模板。</div>}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div>
            <h3 className="font-black text-gray-900 flex items-center"><ShieldAlert className="w-4 h-4 mr-2 text-amber-600" /> 顾问维度</h3>
            <p className="text-xs text-gray-500 mt-1">看谁的问题量高、关闭率低，便于做辅导和复盘。</p>
          </div>
          <div className="space-y-3 mt-4">
            {consultantStats.map(item => (
              <div key={item.name} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-gray-900">{item.name}</div>
                  <span className="text-xs font-black text-gray-700 bg-white border border-gray-200 rounded-full px-2 py-1">{item.count} 项</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${item.closeRate}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                  <span>关闭率 {item.closeRate}%</span>
                  <span>重大 {item.major} · 未闭环 {item.open}</span>
                </div>
              </div>
            ))}
            {consultantStats.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">暂无顾问分析数据。</div>}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div>
            <h3 className="font-black text-gray-900 flex items-center"><FileText className="w-4 h-4 mr-2 text-blue-600" /> 行业维度</h3>
            <p className="text-xs text-gray-500 mt-1">识别哪个行业更容易出重大问题或超期整改。</p>
          </div>
          <div className="space-y-3 mt-4">
            {industryStats.map(item => (
              <div key={item.name} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-bold text-gray-900">{item.name}</div>
                  <span className="text-xs font-black text-gray-700 bg-white border border-gray-200 rounded-full px-2 py-1">{item.count} 项</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                  <span className="px-2 py-1 rounded-full border border-red-100 bg-red-50 text-red-700">重大 {item.major}</span>
                  <span className="px-2 py-1 rounded-full border border-amber-100 bg-amber-50 text-amber-700">未闭环 {item.open}</span>
                  <span className="px-2 py-1 rounded-full border border-gray-200 bg-white text-gray-600">超期 {item.overdue}</span>
                </div>
              </div>
            ))}
            {industryStats.length === 0 && <div className="text-sm text-gray-400 py-8 text-center">暂无行业分析数据。</div>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center flex-wrap gap-2">
          <div className="flex space-x-2">
            {['All', 'Open', 'Closed'].map(status => (
              <button key={status} onClick={() => setFilterStatus(status as 'All' | 'Open' | 'Closed')} className={`px-4 py-1.5 text-sm font-bold rounded-xl transition-all ${filterStatus === status ? 'bg-gray-900 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}>
                {status === 'All' ? '全部' : status === 'Open' ? '未完成' : '已归档'}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索客户 / 项目 / 顾问 / 问题类型…" className="w-full" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 font-bold text-sm uppercase tracking-widest border-b border-gray-100">
              <tr>
                <th className={thClass}>严重度</th>
                <th className={thClass}>客户 / 业务对象</th>
                <th className={thClass}>审计发现点</th>
                <th className={thClass}>证据 / 验证</th>
                <th className={thClass}>经验提炼状态</th>
                <th className={thClass}>状态</th>
                <th className={`${thClass} text-right`}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredIssues.map(({ issue, relation, topic, evidenceCount, verified, overdue }) => (
                <tr key={issue.id} className="hover:bg-gray-50/80 transition-colors group align-top">
                  <td className={tdClass}>{getSeverityBadge(issue.severity)}</td>
                  <td className={tdClass}>
                    <div className="font-black text-gray-900 text-base">{relation.customerName || '未绑定客户'}</div>
                    <div className="mt-1 space-y-0.5">
                      {relation.project?.name && <div className="text-xs text-gray-500">项目：{relation.project.name}</div>}
                      {relation.contractLabel && <div className="text-xs text-gray-400">合同：{relation.contractLabel}</div>}
                      <div className="text-xs text-indigo-500">类型：{topic}</div>
                    </div>
                  </td>
                  <td className={`${tdClass} min-w-[260px]`}>
                    <p className="text-gray-700 text-sm leading-6">{issue.findings}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                      <span className="px-2 py-1 rounded-full border border-gray-200 bg-white text-gray-600">顾问：{issue.auditor}</span>
                      {issue.deadline && <span className={`px-2 py-1 rounded-full border ${overdue ? 'border-red-100 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600'}`}>整改截止：{issue.deadline}</span>}
                      {issue.rectificationTaskId && <span className="px-2 py-1 rounded-full border border-indigo-100 bg-indigo-50 text-indigo-700">已挂整改任务</span>}
                    </div>
                  </td>
                  <td className={tdClass}>
                    <div className="space-y-2 min-w-[180px]">
                      <div className="flex items-center text-xs font-bold text-gray-600">
                        <Paperclip className="w-3 h-3 mr-1" /> 已上传 {evidenceCount} 份证据
                      </div>
                      {issue.verification?.verifiedBy ? (
                        <div className="text-xs text-gray-500 leading-5">
                          <div>验证人：{issue.verification.verifiedBy}</div>
                          <div>验证日期：{issue.verification.verifiedAt || '-'}</div>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-300 italic">待填写验证信息</div>
                      )}
                      {verified && (
                        <div className="inline-flex items-center text-xs font-black px-2 py-1 rounded-lg border bg-emerald-50 text-emerald-600 border-emerald-100">
                          <ShieldCheck className="w-3 h-3 mr-1" /> 已验证关闭
                        </div>
                      )}
                    </div>
                  </td>
                  <td className={tdClass}>
                    {issue.knowledgeDocId ? (
                      <button
                        type="button"
                        onClick={() => handleOpenKnowledgeDoc(issue.knowledgeDocId)}
                        className="inline-flex items-center text-xs font-black px-2 py-1 rounded-lg border bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100 transition-colors"
                      >
                        <BookOpen className="w-3 h-3 mr-1" /> 已入知识库
                      </button>
                    ) : issue.status === 'Closed' ? (
                      <button
                        onClick={() => handleExtractExperience(issue)}
                        disabled={isExtracting === issue.id}
                        className={`flex items-center text-xs font-black px-2 py-1 rounded-lg border transition-all ${isExtracting === issue.id ? 'bg-gray-100 text-gray-400' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white'}`}
                      >
                        {isExtracting === issue.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <BrainCircuit className="w-3 h-3 mr-1" />}
                        {isExtracting === issue.id ? '智能提炼中...' : '提炼避坑锦囊'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300 italic">待关闭后提炼</span>
                    )}
                  </td>
                  <td className={tdClass}>{getStatusBadge(issue.status)}</td>
                  <td className={`${tdClass} text-right`}>
                    <button onClick={() => handleOpenModal(issue)} className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors">
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredIssues.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">暂无匹配问题，可直接加载示例模板开始演示。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl p-8 animate-in fade-in zoom-in duration-300 max-h-[92vh] overflow-y-auto border border-gray-100">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-gray-900 flex items-center">
                {editingIssue ? <Sparkles className="w-6 h-6 mr-3 text-indigo-600" /> : <Plus className="w-6 h-6 mr-3 text-blue-600" />}
                {editingIssue ? '问题深度处理' : '登记新不符合项'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6 text-gray-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">关联客户</label>
                  <select required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.customerId || '')} onChange={e => handleCustomerChange(e.target.value)}>
                    <option value="">请选择客户</option>
                    {customers.map(customer => (
                      <option key={customer.id} value={customer.id}>{customer.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">审核类别</label>
                  <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.auditType || 'Internal')} onChange={e => setFormData({ ...formData, auditType: e.target.value as AuditIssue['auditType'] })}>
                    <option value="Internal">内部审核</option>
                    <option value="External">外部认证审核</option>
                    <option value="Surveillance">监督审核</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">关联项目（可选）</label>
                  <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.projectId || '')} onChange={e => handleProjectChange(e.target.value)}>
                    <option value="">未关联项目</option>
                    {availableProjects.map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">关联合同（可选）</label>
                  <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.contractId || '')} onChange={e => handleContractChange(e.target.value)}>
                    <option value="">未关联合同</option>
                    {availableContracts.map(contract => (
                      <option key={contract.id} value={contract.id}>{contract.contractNo || contract.id} · {contract.customerName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl bg-blue-50/60 border border-blue-100 px-4 py-3 text-xs text-blue-700">
                <div className="font-black uppercase tracking-widest text-[11px] text-blue-400">当前关联</div>
                <div className="mt-1 leading-6">
                  客户：{currentRelation.customerName || '未选择'}
                  <span className="mx-2 text-blue-300">|</span>
                  项目：{currentRelation.project?.name || '未关联'}
                  <span className="mx-2 text-blue-300">|</span>
                  合同：{currentRelation.contractLabel || '未关联'}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">严重度评分</label>
                  <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.severity || 'Minor')} onChange={e => setFormData({ ...formData, severity: e.target.value as AuditIssue['severity'] })}>
                    <option value="Minor">一般不符合 (Minor)</option>
                    <option value="Major">严重不符合 (Major)</option>
                    <option value="Observation">观察项 (Obs)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">状态</label>
                  <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.status || 'Open')} onChange={e => updateFormStatus(e.target.value as AuditIssue['status'])}>
                    <option value="Open">待整改</option>
                    <option value="Rectifying">整改中</option>
                    <option value="Verifying">待验证</option>
                    <option value="Closed">已关闭</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">整改死线</label>
                  <input type="date" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.deadline || '')} onChange={e => setFormData({ ...formData, deadline: e.target.value })} />
                </div>
                <div>
                  {/*
                    发现日期原本写死为"今天"，导致无法补录历史不符合项，
                    趋势图也就永远只有当月一个点。开放此字段后可录入真实历史，曲线才有意义。
                  */}
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">发现日期</label>
                  <input
                    type="date"
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                    value={String(formData.createDate || '')}
                    onChange={e => setFormData({ ...formData, createDate: e.target.value })}
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">补录历史问题时改成当时的实际发现日期，趋势图按这个日期分月统计。</p>
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">责任顾问</label>
                  <input type="text" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none" value={String(formData.auditor || '')} onChange={e => setFormData({ ...formData, auditor: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">问题描述 (Findings)</label>
                <textarea required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none min-h-[100px]" placeholder="详细客观描述现场发现的不符合事实..." value={String(formData.findings || '')} onChange={e => setFormData({ ...formData, findings: e.target.value })}></textarea>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="rounded-3xl border border-amber-100 bg-amber-50/60 p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black text-gray-900 flex items-center"><AlertTriangle className="w-4 h-4 mr-2 text-amber-600" /> 重复问题自动预警</h3>
                      <p className="text-xs text-gray-500 mt-1">同客户 / 同行业 / 同问题类型会自动提示，避免重复登记或遗漏复盘。</p>
                    </div>
                    {relatedOpenIssueCount > 0 && (
                      <span className="px-2 py-1 rounded-full text-[11px] font-black bg-white border border-amber-200 text-amber-700">同类未闭环 {relatedOpenIssueCount} 项</span>
                    )}
                  </div>
                  {!String(formData.findings || '').trim() ? (
                    <div className="rounded-2xl border border-dashed border-amber-200 bg-white/70 px-4 py-6 text-sm text-gray-400 text-center">输入问题描述后，系统会自动匹配历史同类问题。</div>
                  ) : duplicateInsights.length > 0 ? (
                    <div className="space-y-3">
                      {duplicateInsights.map(({ item, reasons, score }) => (
                        <div key={item.issue.id} className="rounded-2xl border border-amber-100 bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-black text-gray-900">{item.relation.customerName || '未绑定客户'}</div>
                              <div className="text-xs text-gray-500 mt-1 line-clamp-2">{item.issue.findings}</div>
                            </div>
                            <span className="px-2 py-1 rounded-full text-[11px] font-black bg-amber-50 border border-amber-100 text-amber-700">匹配度 {score}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                            {reasons.map(reason => (
                              <span key={`${item.issue.id}-${reason}`} className="px-2 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600">{reason}</span>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                            <span>状态：{item.issue.status}</span>
                            <span>·</span>
                            <span>顾问：{item.issue.auditor}</span>
                            <span>·</span>
                            <span>截止：{item.issue.deadline || '-'}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => handleOpenModal(item.issue)} className="px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600">查看原问题</button>
                            {item.issue.knowledgeDocId && (
                              <button type="button" onClick={() => handleOpenKnowledgeDoc(item.issue.knowledgeDocId)} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:bg-gray-50">查看关联经验</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-6 text-sm text-emerald-700">当前未发现高相似问题，可继续登记并沉淀为新案例。</div>
                  )}
                </div>

                <div className="rounded-3xl border border-indigo-100 bg-indigo-50/40 p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black text-gray-900 flex items-center"><BookOpen className="w-4 h-4 mr-2 text-indigo-600" /> SOP 自动推荐</h3>
                      <p className="text-xs text-gray-500 mt-1">基于问题类型、行业和服务线推荐可复用知识卡，并补充示例 SOP。</p>
                    </div>
                    {currentTopic && (
                      <span className="px-2 py-1 rounded-full text-[11px] font-black bg-white border border-indigo-100 text-indigo-700">当前类型：{currentTopic}</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {sopRecommendations.map(recommendation => (
                      <div key={recommendation.id} className="rounded-2xl border border-indigo-100 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-black text-gray-900">{recommendation.title}</div>
                            <div className="text-[11px] text-indigo-500 mt-1">{recommendation.categoryLabel}</div>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-[11px] font-black border ${recommendation.source === 'knowledge' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{recommendation.source === 'knowledge' ? '知识卡' : '示例'}</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-3 leading-6">{recommendation.summary}</div>
                        {recommendation.tags.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-gray-500">
                            {recommendation.tags.map((tag: string) => (
                              <span key={`${recommendation.id}-${tag}`} className="px-2 py-1 rounded-full bg-gray-50 border border-gray-200">#{tag}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => handleApplySopRecommendation(recommendation)} className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700">带入整改方案</button>
                          {recommendation.knowledgeDocId && (
                            <button type="button" onClick={() => handleOpenKnowledgeDoc(recommendation.knowledgeDocId)} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:bg-gray-50">查看知识卡</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {sopRecommendations.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-indigo-200 bg-white/70 px-4 py-6 text-sm text-gray-400 text-center">暂无可推荐 SOP，可先输入问题描述或沉淀一条知识卡。</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50/30 p-6 rounded-3xl border border-indigo-100">
                <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
                  <label className="text-xs font-black text-indigo-400 uppercase tracking-widest">AI 辅助整改决策</label>
                  <button type="button" onClick={handleAIPlan} disabled={isGenerating} className="text-xs font-black flex items-center bg-indigo-600 text-white px-3 py-1.5 rounded-xl hover:bg-indigo-700 transition-all shadow-md active:scale-95">
                    {isGenerating ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Sparkles className="w-3 h-3 mr-2" />}
                    智能生成整改方案
                  </button>
                </div>
                <textarea className="w-full bg-white border-none rounded-2xl p-4 text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500/20 outline-none min-h-[150px] shadow-sm" placeholder="AI 将协助生成原因分析、纠正措施及预防措施..." value={String(formData.rectificationPlan || '')} onChange={e => setFormData({ ...formData, rectificationPlan: e.target.value })}></textarea>
              </div>

              <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-gray-900 flex items-center"><Paperclip className="w-4 h-4 mr-2 text-indigo-600" /> 整改证据</h3>
                    <p className="text-xs text-gray-500 mt-1">支持图片/PDF 上传；关闭前至少保留 1 份直接证据。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input ref={evidenceInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.svg" className="hidden" onChange={handleEvidencePick} disabled={isUploadingEvidence} />
                    <button
                      type="button"
                      onClick={() => evidenceInputRef.current?.click()}
                      disabled={isUploadingEvidence}
                      className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 flex items-center disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isUploadingEvidence
                        ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> 上传中…</>
                        : <><Upload className="w-3 h-3 mr-2" /> 上传证据</>}
                    </button>
                    <button type="button" onClick={() => setFormData(prev => ({ ...prev, evidences: buildExampleEvidenceList(AUDIT_EXAMPLE_TEMPLATES[0]) }))} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:bg-gray-50">
                      填充示例证据
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {(formData.evidences || []).map(evidence => (
                    <div key={evidence.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-black text-gray-900 truncate">{evidence.name}</div>
                            {evidence.isExample && <span className="text-[11px] font-black px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">示例</span>}
                            <span className="text-[11px] text-gray-400">{evidence.size}</span>
                            <span className="text-[11px] text-gray-400">{evidence.uploadDate}</span>
                          </div>
                          <input
                            type="text"
                            value={String(evidence.note || '')}
                            onChange={e => patchEvidence(evidence.id, { note: e.target.value })}
                            placeholder="补充证据说明，例如：新版签收表 / 复核截图 / 现场照片说明"
                            className="mt-3 w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                          <div className="mt-2 text-[11px] text-gray-500">上传人：{evidence.uploadedBy || '未记录'}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button type="button" onClick={() => handlePreviewEvidence(evidence)} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700 hover:bg-gray-100 flex items-center">
                            <Eye className="w-3 h-3 mr-1" /> 预览
                          </button>
                          <button type="button" onClick={() => handleDownloadEvidence(evidence)} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700 hover:bg-gray-100">下载</button>
                          <button type="button" onClick={() => removeEvidence(evidence.id)} className="p-2 rounded-xl border border-red-100 bg-red-50 text-red-600 hover:bg-red-100">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(formData.evidences || []).length === 0 && (
                    <div className="rounded-2xl border-2 border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">暂无整改证据，可上传现场照片、签收表、复核截图或直接填充示例证据。</div>
                  )}
                </div>
              </div>

              <div className="bg-emerald-50/40 rounded-3xl border border-emerald-100 p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-gray-900 flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-emerald-600" /> 验证关闭</h3>
                    <p className="text-xs text-gray-500 mt-1">进入关闭态前，补齐验证人、验证日期和验证结论。</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                    <span className="px-2 py-1 rounded-full bg-white border border-emerald-100 text-emerald-700">当前状态：{formData.status || 'Open'}</span>
                    <span className="px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-600">证据 {(formData.evidences || []).length} 份</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">验证人</label>
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" value={String(formData.verification?.verifiedBy || '')} onChange={e => setFormData(prev => ({ ...prev, verification: { verifiedBy: e.target.value, verifiedAt: String(prev.verification?.verifiedAt || new Date().toISOString().split('T')[0]), notes: String(prev.verification?.notes || '') } }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">验证日期</label>
                    <input type="date" className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" value={String(formData.verification?.verifiedAt || '')} onChange={e => setFormData(prev => ({ ...prev, verification: { verifiedBy: String(prev.verification?.verifiedBy || currentUser.name || ''), verifiedAt: e.target.value, notes: String(prev.verification?.notes || '') } }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">验证结论</label>
                  <textarea className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-sm min-h-[110px] outline-none focus:ring-2 focus:ring-emerald-500/20" placeholder="例如：已抽查 3 个岗位、2 份记录、1 次现场，整改项已满足要求，可关闭。" value={String(formData.verification?.notes || '')} onChange={e => setFormData(prev => ({ ...prev, verification: { verifiedBy: String(prev.verification?.verifiedBy || currentUser.name || ''), verifiedAt: String(prev.verification?.verifiedAt || new Date().toISOString().split('T')[0]), notes: e.target.value } }))}></textarea>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-white/70 px-4 py-3 text-xs leading-6 text-emerald-800">
                  <div className="font-black mb-1 flex items-center"><Clock3 className="w-3 h-3 mr-1" /> 关闭校验规则</div>
                  <div>1. 至少 1 份整改证据；2. 验证人/验证日期/验证结论齐全；3. 保存时状态切到“已关闭”。</div>
                </div>
              </div>

              <div className="flex justify-end space-x-4 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-gray-400 hover:text-gray-600 transition-colors">取消</button>
                <button type="submit" className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 shadow-xl shadow-blue-500/20 transition-all active:scale-95 flex items-center">
                  <Save className="w-4 h-4 mr-2" /> 确认保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewEvidence && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="text-sm font-black text-gray-900 truncate pr-4">{previewEvidence.name}</div>
              <button onClick={() => setPreviewEvidence(null)} className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-gray-50 p-4 max-h-[80vh] overflow-auto">
              {previewEvidence.kind === 'image' ? (
                <img src={previewEvidence.url} alt={previewEvidence.name} className="w-full rounded-2xl border border-gray-200 bg-white" />
              ) : (
                <iframe title={previewEvidence.name} src={previewEvidence.url} className="w-full h-[72vh] rounded-2xl bg-white border border-gray-200" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Audit;
