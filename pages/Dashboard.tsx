import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Bell,
  TrendingUp,
  Briefcase,
  Check,
  Sparkles,
  Zap,
  ArrowRight,
  Target,
  AlertTriangle,
  Coins,
  CheckCircle,
  Activity,
  ChevronDown,
  BookOpen,
  BrainCircuit,
  Database
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AggregatedReminder, Reminder, DashboardPersona, Status } from '../types';
import { useLocation, useNavigate } from 'react-router-dom';
import { inferProjectMeta } from '../src/utils/projectCapabilities';
import BossDashboard from './dashboard/BossDashboard';
import SalesDashboard from './dashboard/SalesDashboard';
import ConsultantDashboard from './dashboard/ConsultantDashboard';
import FinanceDashboard from './dashboard/FinanceDashboard';
import { openDashboardRoute } from '../src/modules/dashboardNavigation';

type ReminderView = 'aggregated' | 'detail';
type AIBriefKey = 'opportunity' | 'risk' | 'intel';

type KpiCard = {
  id: string;
  title: string;
  value: string;
  route: string;
  tone: 'green' | 'red' | 'amber' | 'indigo' | 'blue';
  subtitle: string;
};

type HubPreview = {
  id: string;
  label: string;
  meta: string;
  route: string;
};

type HubAction = {
  id: string;
  label: string;
  route: string;
};

type HubCard = {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  route: string;
  tone: 'indigo' | 'emerald' | 'blue';
  icon: React.ReactNode;
  emptyText: string;
  previews: HubPreview[];
  actions: HubAction[];
};

type PersonaPlan = {
  taskDefaultView: ReminderView;
  chartCollapsed: boolean;
  aiDefaultOpen: Record<AIBriefKey, boolean>;
  taskKeywords: string[];
  alertKeywords: string[];
};

const PERSONA_LABEL: Record<DashboardPersona, string> = {
  boss: '老板视角',
  sales: '销售视角',
  consultant: '咨询师视角',
  finance: '财务视角'
};

const PERSONA_PLAN: Record<DashboardPersona, PersonaPlan> = {
  boss: {
    taskDefaultView: 'aggregated',
    chartCollapsed: false,
    aiDefaultOpen: { opportunity: true, risk: true, intel: false },
    taskKeywords: [],
    alertKeywords: []
  },
  sales: {
    taskDefaultView: 'aggregated',
    chartCollapsed: true,
    aiDefaultOpen: { opportunity: true, risk: false, intel: false },
    taskKeywords: ['跟进', '回访', '报价', '催签', '续费', '联系', '商机', '线索'],
    alertKeywords: ['逾期', '流失', '到期', '未跟进', '催签', '续费', '风险']
  },
  consultant: {
    taskDefaultView: 'detail',
    chartCollapsed: true,
    aiDefaultOpen: { opportunity: false, risk: true, intel: false },
    taskKeywords: ['交付', '资料', '提交', '审核', '节点', '任务', '催办', '确认', '整改', '到期'],
    alertKeywords: ['交付', '资料缺失', '催办', '延期', '风险', '超期', '待确认']
  },
  finance: {
    taskDefaultView: 'aggregated',
    chartCollapsed: false,
    aiDefaultOpen: { opportunity: false, risk: false, intel: false },
    taskKeywords: ['到款', '回款', '开票', '结算', '催款', '应收', '实收'],
    alertKeywords: ['回款异常', '结算异常', '超期', '逾期', '金额缺失', '无法完结', '应收']
  }
};

const TONE_CLASS: Record<KpiCard['tone'], { icon: string; value: string; bg: string }> = {
  green: { icon: 'text-green-600', value: 'text-green-600', bg: 'bg-green-50' },
  red: { icon: 'text-red-600', value: 'text-red-600', bg: 'bg-red-50' },
  amber: { icon: 'text-amber-600', value: 'text-amber-600', bg: 'bg-amber-50' },
  indigo: { icon: 'text-indigo-600', value: 'text-indigo-600', bg: 'bg-indigo-50' },
  blue: { icon: 'text-blue-600', value: 'text-blue-600', bg: 'bg-blue-50' }
};

const money = (amount: number) => `¥${Number(amount || 0).toFixed(2)}`;
const hasKeywords = (text: string, keywords: string[]) => keywords.some(keyword => text.includes(keyword.toLowerCase()));

const getReminderText = (reminder: Reminder) => `${reminder.title || ''} ${reminder.content || ''}`.toLowerCase();

const reminderDateTs = (dateText: string | undefined) => {
  const ts = Date.parse(String(dateText || ''));
  return Number.isFinite(ts) ? ts : 0;
};

const dayDiff = (targetDate: string, baseDate: Date) => {
  const ts = reminderDateTs(targetDate);
  if (!ts) return Number.POSITIVE_INFINITY;
  return Math.ceil((ts - baseDate.getTime()) / (24 * 3600 * 1000));
};

const isOwnedByCurrentUser = (reminder: Reminder, userId: string) => {
  if (!reminder.forUserIds || reminder.forUserIds.length === 0) return true;
  return reminder.forUserIds.includes(userId);
};

const severityRank: Record<AggregatedReminder['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2
};

const buildAggregatedFromReminders = (
  sourceAggregated: AggregatedReminder[],
  reminders: Reminder[]
): AggregatedReminder[] => {
  if (!sourceAggregated.length || !reminders.length) return [];

  const byScope = new Map<string, Reminder[]>();
  reminders.forEach(reminder => {
    if (!reminder.linkType || !reminder.linkId) return;
    const scopeKey = `${reminder.linkType}:${reminder.linkId}`;
    const prev = byScope.get(scopeKey) || [];
    prev.push(reminder);
    byScope.set(scopeKey, prev);
  });

  return sourceAggregated
    .map(item => {
      const key = `${item.linkType}:${item.linkId}`;
      const matched = byScope.get(key) || [];
      if (!matched.length) return null;
      const latestDate = matched
        .map(record => record.date || '')
        .sort((a, b) => String(b).localeCompare(String(a)))[0] || item.latestDate;
      return {
        ...item,
        count: matched.length,
        latestDate,
        samples: matched.slice(0, 3)
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const severityDelta = severityRank[a!.severity] - severityRank[b!.severity];
      if (severityDelta !== 0) return severityDelta;
      return String(b!.latestDate || '').localeCompare(String(a!.latestDate || ''));
    }) as AggregatedReminder[];
};

const Dashboard = () => {
  const {
    projects,
    contracts,
    leads,
    settlements,
    visibleReminders,
    aggregatedReminders,
    dismissReminder,
    activePersona,
    currentUser,
    marketSignals,
    knowledgeDocs,
    strategicTasks,
    strategicInsight,
    userProfiles,
    dashboardMetrics,
    resolveDashboardPersona
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const queryPersona = React.useMemo(
    () => new URLSearchParams(location.search).get('persona'),
    [location.search]
  );
  const persona = React.useMemo<DashboardPersona>(() => {
    return resolveDashboardPersona(queryPersona || activePersona);
  }, [queryPersona, activePersona, resolveDashboardPersona]);

  const personaPlan = PERSONA_PLAN[persona];

  const unreadReminders = React.useMemo(
    () => visibleReminders.filter(reminder => !reminder.isRead),
    [visibleReminders]
  );

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);

  const isRevenueProject = React.useCallback((project: typeof projects[number]) => {
    const meta = inferProjectMeta(project);
    if (meta.projectMode !== 'delivery') return false;
    if (project.status !== Status.Completed) return false;
    if ((project as any).isRevenueProject === false) return false;
    return true;
  }, []);

  const projectCompleteMonthKey = React.useCallback((project: typeof projects[number]) => {
    const actualEndDate = String(project.completionRecord?.actualEndDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(actualEndDate)) return actualEndDate.slice(0, 7);
    const completedAt = String(project.completionRecord?.completedAt || '').trim();
    const completedAtTs = Date.parse(completedAt);
    if (Number.isFinite(completedAtTs)) return new Date(completedAtTs).toISOString().slice(0, 7);
    return '';
  }, []);

  const revenueProjectsThisMonth = React.useMemo(
    () => projects.filter(project => isRevenueProject(project) && projectCompleteMonthKey(project) === monthKey),
    [projects, isRevenueProject, projectCompleteMonthKey, monthKey]
  );

  const revenueAmountThisMonth = React.useMemo(
    () => revenueProjectsThisMonth.reduce((sum, project) => sum + Number(project.projectAmount || 0), 0),
    [revenueProjectsThisMonth]
  );

  const receivables = React.useMemo(
    () =>
      contracts.flatMap(contract =>
        (contract.receivables || []).map(receivable => ({
          contractId: contract.id,
          customerName: contract.customerName,
          amount: Number(receivable.amount || 0),
          dueDate: receivable.dueDate,
          status: receivable.status
        }))
      ),
    [contracts]
  );

  const monthContractAmount = React.useMemo(
    () =>
      contracts
        .filter(contract => String(contract.signDate || '').startsWith(monthKey))
        .reduce((sum, contract) => sum + Number(contract.amount || 0), 0),
    [contracts, monthKey]
  );

  const monthReceivableAmount = React.useMemo(
    () => receivables.filter(item => String(item.dueDate || '').startsWith(monthKey)).reduce((sum, item) => sum + item.amount, 0),
    [receivables, monthKey]
  );

  const monthPaidAmount = React.useMemo(
    () => receivables.filter(item => item.status === 'paid' && String(item.dueDate || '').startsWith(monthKey)).reduce((sum, item) => sum + item.amount, 0),
    [receivables, monthKey]
  );

  const overdueReceivableAmount = React.useMemo(
    () => receivables.filter(item => item.status !== 'paid' && dayDiff(item.dueDate, now) < 0).reduce((sum, item) => sum + item.amount, 0),
    [receivables, now]
  );

  const myProjects = React.useMemo(
    () => projects.filter(project => project.manager === currentUser.name || (project.tasks || []).some(task => task.owner === currentUser.name)),
    [projects, currentUser.name]
  );

  const myRevenueProjectsThisMonth = React.useMemo(
    () =>
      revenueProjectsThisMonth.filter(project =>
        project.manager === currentUser.name || (project.tasks || []).some(task => task.owner === currentUser.name)
      ),
    [revenueProjectsThisMonth, currentUser.name]
  );

  const myLeadSet = React.useMemo(
    () =>
      leads.filter(
        lead =>
          (lead.followUpRecords || []).some(record => String(record.operator || '') === currentUser.name) ||
          String(lead.name || '') === currentUser.name
      ),
    [leads, currentUser.name]
  );

  const weekStart = React.useMemo(() => {
    const d = new Date(now);
    d.setDate(now.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  const myWeekNewLeads = React.useMemo(() => {
    return myLeadSet.filter(lead => {
      const idRaw = String(lead.id || '');
      const idTs = Number(idRaw.split('-')[1]);
      if (Number.isFinite(idTs) && idTs > 0) return idTs >= weekStart.getTime();
      const fallbackTs = Date.parse(String(lead.lastContact || ''));
      return Number.isFinite(fallbackTs) ? fallbackTs >= weekStart.getTime() : false;
    }).length;
  }, [myLeadSet, weekStart]);

  const myOpenTaskPairs = React.useMemo(
    () =>
      projects
        .flatMap(project => (project.tasks || []).map(task => ({ project, task })))
        .filter(item => item.task.owner === currentUser.name && item.task.status !== 'Completed'),
    [projects, currentUser.name]
  );

  const myOverdueTasks = React.useMemo(
    () => myOpenTaskPairs.filter(item => dayDiff(item.task.deadline, now) < 0).length,
    [myOpenTaskPairs, now]
  );

  const myWeekDueTasks = React.useMemo(
    () => myOpenTaskPairs.filter(item => {
      const days = dayDiff(item.task.deadline, now);
      return days >= 0 && days <= 7;
    }).length,
    [myOpenTaskPairs, now]
  );

  const myHighRiskProjects = React.useMemo(
    () => myProjects.filter(project => project.status === Status.Risk || project.aiInsight?.riskLevel === 'High').length,
    [myProjects]
  );

  const pendingConfirmSettlementCount = React.useMemo(
    () => settlements.filter(item => item.status === 'draft').length,
    [settlements]
  );

  const risks = visibleReminders.filter(reminder => reminder.type === 'risk');
  const opportunities = visibleReminders.filter(reminder => reminder.type === 'opportunity');

  const intelToday = marketSignals.filter(signal => signal.publishedAt === today);
  const intelHigh = intelToday.filter(signal => signal.urgency === 'high' && signal.status !== 'converted' && signal.status !== 'ignored');

  const buildReminderFilter = React.useCallback(
    (keywords: string[], fallbackType?: Reminder['type']) => {
      return (reminder: Reminder) => {
        const text = getReminderText(reminder);
        if (keywords.length === 0) return true;
        if (hasKeywords(text, keywords)) return true;
        if (fallbackType && reminder.type === fallbackType) return true;
        return false;
      };
    },
    []
  );

  const taskReminderPredicate = React.useMemo(() => {
    if (persona === 'sales') return buildReminderFilter(personaPlan.taskKeywords, 'opportunity');
    if (persona === 'consultant') return buildReminderFilter(personaPlan.taskKeywords, 'risk');
    if (persona === 'finance') return buildReminderFilter(personaPlan.taskKeywords, 'expire');
    return () => true;
  }, [persona, personaPlan.taskKeywords, buildReminderFilter]);

  const alertReminderPredicate = React.useMemo(() => {
    if (persona === 'sales') return buildReminderFilter(personaPlan.alertKeywords, 'risk');
    if (persona === 'consultant') return buildReminderFilter(personaPlan.alertKeywords, 'risk');
    if (persona === 'finance') return buildReminderFilter(personaPlan.alertKeywords, 'risk');
    return () => true;
  }, [persona, personaPlan.alertKeywords, buildReminderFilter]);

  const taskRemindersBase = React.useMemo(
    () => unreadReminders.filter(reminder => isOwnedByCurrentUser(reminder, currentUser.id)),
    [unreadReminders, currentUser.id]
  );

  const scopedTaskReminders = React.useMemo(() => {
    const filtered = taskRemindersBase.filter(taskReminderPredicate);
    return filtered.length > 0 ? filtered : taskRemindersBase;
  }, [taskRemindersBase, taskReminderPredicate]);

  const scopedAlertReminders = React.useMemo(() => {
    const filtered = unreadReminders.filter(alertReminderPredicate);
    return filtered.length > 0 ? filtered : unreadReminders;
  }, [unreadReminders, alertReminderPredicate]);

  const taskAggregatedReminders = React.useMemo(
    () => buildAggregatedFromReminders(aggregatedReminders, scopedTaskReminders),
    [aggregatedReminders, scopedTaskReminders]
  );

  const alertAggregatedReminders = React.useMemo(
    () => buildAggregatedFromReminders(aggregatedReminders, scopedAlertReminders),
    [aggregatedReminders, scopedAlertReminders]
  );

  const [reminderView, setReminderView] = React.useState<ReminderView>(personaPlan.taskDefaultView);
  const [expandedAggId, setExpandedAggId] = React.useState<string | null>(null);
  const [detailScopeKey, setDetailScopeKey] = React.useState<string>('');
  const [detailSearch, setDetailSearch] = React.useState<string>('');
  const [detailGrouped, setDetailGrouped] = React.useState<boolean>(true);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = React.useState<Record<string, boolean>>({});
  const [scopeDropdownOpen, setScopeDropdownOpen] = React.useState<boolean>(false);
  const [scopeDropdownDirection, setScopeDropdownDirection] = React.useState<'up' | 'down'>('down');
  const [trendCollapsed, setTrendCollapsed] = React.useState<boolean>(personaPlan.chartCollapsed);
  const [aiOpenState, setAiOpenState] = React.useState<Record<AIBriefKey, boolean>>(personaPlan.aiDefaultOpen);
  const scopeDropdownRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setReminderView(personaPlan.taskDefaultView);
    setExpandedAggId(null);
    setDetailScopeKey('');
    setDetailSearch('');
    setDetailGrouped(true);
    setCollapsedGroupKeys({});
    setScopeDropdownOpen(false);
    setTrendCollapsed(personaPlan.chartCollapsed);
    setAiOpenState(personaPlan.aiDefaultOpen);
  }, [personaPlan, persona]);

  React.useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(target)) {
        setScopeDropdownOpen(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScopeDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const getScopeLabel = React.useCallback(
    (scopeKey: string) => {
      const item = taskAggregatedReminders.find(record => `${record.linkType}:${record.linkId}` === scopeKey);
      if (item?.projectName && item?.customerName) return `客户【${item.customerName}】 · 项目【${item.projectName}】`;
      if (item?.projectName) return `项目【${item.projectName}】`;
      if (item?.customerName) return `客户【${item.customerName}】`;
      return scopeKey;
    },
    [taskAggregatedReminders]
  );

  const detailReminders = React.useMemo(() => {
    let list = scopedTaskReminders;
    if (detailScopeKey) {
      list = list.filter(reminder => `${reminder.linkType || ''}:${reminder.linkId || ''}` === detailScopeKey);
    }
    const query = detailSearch.trim().toLowerCase();
    if (query) {
      list = list.filter(reminder => `${reminder.title || ''} ${reminder.content || ''}`.toLowerCase().includes(query));
    }
    const sorted = [...list].sort((a, b) => {
      if (persona === 'consultant') return reminderDateTs(a.date) - reminderDateTs(b.date);
      return reminderDateTs(b.date) - reminderDateTs(a.date);
    });
    return sorted;
  }, [scopedTaskReminders, detailScopeKey, detailSearch, persona]);

  const groupedDetail = React.useMemo(() => {
    const groups = new Map<string, Reminder[]>();
    detailReminders.forEach(reminder => {
      const key = `${reminder.linkType || ''}:${reminder.linkId || ''}`;
      const prev = groups.get(key) || [];
      prev.push(reminder);
      groups.set(key, prev);
    });
    const orderedScopes = taskAggregatedReminders
      .map(record => `${record.linkType}:${record.linkId}`)
      .filter(scopeKey => groups.has(scopeKey));
    const remainScopes = Array.from(groups.keys()).filter(scopeKey => !orderedScopes.includes(scopeKey));
    return [...orderedScopes, ...remainScopes].map(scopeKey => ({
      key: scopeKey,
      label: getScopeLabel(scopeKey),
      items: groups.get(scopeKey) || []
    }));
  }, [detailReminders, taskAggregatedReminders, getScopeLabel]);

  const detailScopeLabel = detailScopeKey ? getScopeLabel(detailScopeKey) : '全部对象';
  const toggleScopeDropdown = () => {
    if (!scopeDropdownOpen) {
      const rect = scopeDropdownRef.current?.getBoundingClientRect();
      if (rect) {
        const estimatedMenuHeight = 280;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        setScopeDropdownDirection(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down');
      }
    }
    setScopeDropdownOpen(prev => !prev);
  };

  const monthKeys = React.useMemo(() => {
    const keys: string[] = [];
    const cursor = new Date(now);
    cursor.setDate(1);
    for (let i = 0; i < 7; i++) {
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, '0');
      keys.unshift(`${year}-${month}`);
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return keys;
  }, [now]);

  const paidByMonth = React.useMemo(() => {
    const map: Record<string, number> = {};
    receivables
      .filter(item => item.status === 'paid')
      .forEach(item => {
        const key = String(item.dueDate || '').slice(0, 7);
        if (!key) return;
        map[key] = (map[key] || 0) + Number(item.amount || 0);
      });
    return map;
  }, [receivables]);

  const trendData = React.useMemo(
    () =>
      monthKeys.map(key => ({
        key,
        name: `${Number(key.split('-')[1] || 0)}月`,
        revenue: paidByMonth[key] || 0
      })),
    [monthKeys, paidByMonth]
  );

  const getCardValue = React.useCallback(
    (role: DashboardPersona, cardId: string, fallback: string) => {
      const metrics = dashboardMetrics[role];
      const found = metrics.topCards.find(card => card.id === cardId);
      return found?.value || fallback;
    },
    [dashboardMetrics]
  );

  const salesActionTodayCount = React.useMemo(() => {
    const candidate = scopedTaskReminders.filter(reminder => {
      const text = getReminderText(reminder);
      const isSalesLike = hasKeywords(text, PERSONA_PLAN.sales.taskKeywords);
      if (!isSalesLike) return false;
      const days = dayDiff(reminder.date, now);
      return Number.isFinite(days) ? days <= 0 : true;
    }).length;
    if (candidate > 0) return candidate;
    return scopedTaskReminders.filter(reminder => hasKeywords(getReminderText(reminder), PERSONA_PLAN.sales.taskKeywords)).length;
  }, [scopedTaskReminders, now]);

  const bossCards: KpiCard[] = [
    {
      id: 'boss-revenue-count',
      title: '本月营收项目数',
      value: String(revenueProjectsThisMonth.length),
      route: '/projects?status=completed&mode=delivery',
      tone: 'green',
      subtitle: '本月完成且计入营收口径'
    },
    {
      id: 'boss-revenue-amount',
      title: '本月营收项目金额',
      value: revenueAmountThisMonth > 0 ? money(revenueAmountThisMonth) : money(monthContractAmount),
      route: revenueAmountThisMonth > 0 ? '/projects?status=completed&mode=delivery&field=amount' : '/contracts?month=this',
      tone: 'blue',
      subtitle: revenueAmountThisMonth > 0 ? '按项目金额汇总' : '暂以新增合同金额占位'
    },
    {
      id: 'boss-overdue-amount',
      title: '回款风险金额（逾期）',
      value: getCardValue('boss', 'boss-overdue-amt', money(overdueReceivableAmount)),
      route: '/finance?status=overdue',
      tone: 'red',
      subtitle: '全局异常优先处理'
    },
    {
      id: 'boss-conv',
      title: '销售转化率（线索→营收项目）',
      value: getCardValue('boss', 'boss-conv', '0.0%'),
      route: '/leads?filter=conversion',
      tone: 'indigo',
      subtitle: '已按 005A 口径生效'
    }
  ];

  const salesCards: KpiCard[] = [
    {
      id: 'sales-revenue-count',
      title: '我的营收项目数（本月）',
      value: String(myRevenueProjectsThisMonth.length),
      route: '/projects?owner=me&status=completed&mode=delivery',
      tone: 'green',
      subtitle: '仅统计我负责/我参与'
    },
    {
      id: 'sales-conv',
      title: '我的转化率（线索→营收项目）',
      value: getCardValue('sales', 'sales-conversion', '0.0%'),
      route: '/leads?owner=me&filter=conversion',
      tone: 'indigo',
      subtitle: '已按 005A 口径生效'
    },
    {
      id: 'sales-week-leads',
      title: '本周新线索数',
      value: String(myWeekNewLeads),
      route: '/leads?owner=me&period=week',
      tone: 'blue',
      subtitle: '按 owner=me 统计'
    },
    {
      id: 'sales-today-followup',
      title: '今日需跟进',
      value: String(salesActionTodayCount),
      route: '/leads?owner=me&todo=today',
      tone: 'amber',
      subtitle: '逾期/今日动作'
    }
  ];

  const consultantCards: KpiCard[] = [
    {
      id: 'cons-active-project',
      title: '我负责的进行中项目数',
      value: String(myProjects.filter(project => project.status === Status.Active).length),
      route: '/projects?owner=me&status=active',
      tone: 'blue',
      subtitle: '交付中'
    },
    {
      id: 'cons-overdue-task',
      title: '我逾期任务数',
      value: String(myOverdueTasks),
      route: '/projects?owner=me&task=overdue',
      tone: 'red',
      subtitle: '按截止日期'
    },
    {
      id: 'cons-week-due',
      title: '本周到期交付节点数',
      value: String(myWeekDueTasks),
      route: '/projects?owner=me&task=due_7d',
      tone: 'amber',
      subtitle: '本周到期任务替代'
    },
    {
      id: 'cons-risk',
      title: '我高风险项目数',
      value: String(myHighRiskProjects),
      route: '/projects?owner=me&risk=high',
      tone: 'indigo',
      subtitle: '交付风险聚合'
    }
  ];

  const financeCards: KpiCard[] = [
    {
      id: 'fin-month-receivable',
      title: '本月应收金额',
      value: money(monthReceivableAmount),
      route: '/finance?month=this&view=receivable',
      tone: 'blue',
      subtitle: '现金流入口'
    },
    {
      id: 'fin-month-paid',
      title: '本月已回款金额',
      value: getCardValue('finance', 'fin-month-paid', money(monthPaidAmount)),
      route: '/finance?month=this&view=paid',
      tone: 'green',
      subtitle: '实收'
    },
    {
      id: 'fin-overdue',
      title: '逾期应收金额',
      value: getCardValue('finance', 'fin-overdue', money(overdueReceivableAmount)),
      route: '/finance?status=overdue',
      tone: 'red',
      subtitle: '逾期优先'
    },
    {
      id: 'fin-pending-confirm',
      title: '待确认到款数',
      value: String(pendingConfirmSettlementCount),
      route: '/finance?status=draft',
      tone: 'amber',
      subtitle: '暂用结算草稿占位'
    }
  ];

  const kpiCards = React.useMemo(() => {
    if (persona === 'sales') return salesCards;
    if (persona === 'consultant') return consultantCards;
    if (persona === 'finance') return financeCards;
    return bossCards;
  }, [persona, bossCards, salesCards, consultantCards, financeCards]);

  const bossOverviewCards = React.useMemo(() => {
    const byId = new Map(bossCards.map(card => [card.id, card]));
    const ordered = ['boss-revenue-count', 'boss-revenue-amount', 'boss-conv', 'boss-overdue-amount']
      .map(id => byId.get(id))
      .filter(Boolean);
    if (ordered.length === bossCards.length) return ordered;
    return bossCards;
  }, [bossCards]);

  const bossRiskCards = React.useMemo(() => {
    const byId = new Map(dashboardMetrics.boss.middleCards.map(card => [card.id, card]));
    const ordered = ['boss-high-risk-project', 'boss-overdue-receivable', 'boss-customer-churn', 'boss-near-overdue']
      .map(id => byId.get(id))
      .filter(Boolean);
    if (ordered.length === dashboardMetrics.boss.middleCards.length) return ordered;
    return dashboardMetrics.boss.middleCards;
  }, [dashboardMetrics.boss.middleCards]);

  const bossTeamCards = React.useMemo(() => dashboardMetrics.boss.bottomCards, [dashboardMetrics.boss.bottomCards]);

  const onCardClick = (route: string) => openDashboardRoute(navigate, route);

  const jumpByLink = React.useCallback(
    (linkType?: Reminder['linkType'], linkId?: string) => {
      if (!linkType || !linkId) return;
      if (linkType === 'customer') navigate('/customers', { state: { openDetailId: linkId } });
      else if (linkType === 'lead') navigate('/leads', { state: { openDetailId: linkId } });
      else if (linkType === 'contract') navigate('/contracts', { state: { openDetailId: linkId } });
      else if (linkType === 'project') navigate('/projects', { state: { openDetailId: linkId } });
      else if (linkType === 'intel') navigate('/intel', { state: { openDetailId: linkId } });
      else if (linkType === 'audit') navigate('/audit', { state: { openDetailId: linkId } });
    },
    [navigate]
  );

  const toggleAiBlock = (key: AIBriefKey) => {
    setAiOpenState(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const accessibleKnowledgeDocs = React.useMemo(
    () => knowledgeDocs.filter(doc => {
      if (doc.accessUserIds && doc.accessUserIds.length > 0 && !doc.accessUserIds.includes(currentUser.id)) return false;
      if (doc.accessRoles && doc.accessRoles.length > 0 && !doc.accessRoles.some(role => currentUser.roles.includes(role))) return false;
      return true;
    }),
    [knowledgeDocs, currentUser.id, currentUser.roles]
  );
  const learnedDocsCount = React.useMemo(
    () => accessibleKnowledgeDocs.filter(doc => doc.aiVisible).length,
    [accessibleKnowledgeDocs]
  );
  const auditLinkedKnowledgeCount = React.useMemo(
    () => accessibleKnowledgeDocs.filter(doc => doc.linkType === 'audit').length,
    [accessibleKnowledgeDocs]
  );
  const pdcaKnowledgeCount = React.useMemo(
    () => accessibleKnowledgeDocs.filter(doc => doc.category === 'PDCA').length,
    [accessibleKnowledgeDocs]
  );
  const latestKnowledgeDocs = React.useMemo(
    () => [...accessibleKnowledgeDocs]
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 3),
    [accessibleKnowledgeDocs]
  );
  const strategicPendingCount = React.useMemo(
    () => strategicTasks.filter(task => task.status === 'Pending').length,
    [strategicTasks]
  );
  const strategicInProgressCount = React.useMemo(
    () => strategicTasks.filter(task => task.status === 'In Progress').length,
    [strategicTasks]
  );
  const strategicCompletedCount = React.useMemo(
    () => strategicTasks.filter(task => task.status === 'Completed').length,
    [strategicTasks]
  );
  const strategyBoardTasks = React.useMemo(() => {
    const statusRank: Record<string, number> = { 'In Progress': 0, Pending: 1, Completed: 2 };
    return [...strategicTasks]
      .sort((a, b) => {
        const statusDelta = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
        if (statusDelta !== 0) return statusDelta;
        return String(a.deadline || '9999-99-99').localeCompare(String(b.deadline || '9999-99-99'));
      })
      .slice(0, 3);
  }, [strategicTasks]);
  const strategyUpdatedLabel = String(strategicInsight?.generatedAt || '').trim();
  const aiPreviewItems = React.useMemo<HubPreview[]>(() => [
    {
      id: 'ai-preview-model',
      label: '模型状态',
      meta: `风险提醒 ${risks.length} 条`,
      route: '/ai-center?panel=model-status'
    },
    {
      id: 'ai-preview-security',
      label: '安全治理',
      meta: `${unreadReminders.length} 条未读提醒`,
      route: '/ai-center?panel=security'
    },
    {
      id: 'ai-preview-members',
      label: '成员治理',
      meta: `${userProfiles.length} 位成员可配置`,
      route: '/ai-center?panel=members'
    }
  ], [risks.length, unreadReminders.length, userProfiles.length]);
  const hubCards = React.useMemo<HubCard[]>(() => [
    {
      id: 'hub-knowledge',
      title: '知识复用中心',
      value: `${learnedDocsCount}`,
      subtitle: `AI 可用 ${learnedDocsCount} · 审计经验 ${auditLinkedKnowledgeCount} · PDCA ${pdcaKnowledgeCount}`,
      route: '/knowledge?focus=ai_ready',
      tone: 'indigo',
      icon: <BookOpen className="w-5 h-5" />,
      emptyText: '当前还没有可展示的知识文档。',
      previews: latestKnowledgeDocs.map(doc => ({
        id: doc.id,
        label: doc.title,
        meta: `${doc.category || '未分类'} · ${doc.updatedAt || '未更新'}`,
        route: `/knowledge?docId=${encodeURIComponent(doc.id)}`
      })),
      actions: [
        { id: 'knowledge-ai', label: 'AI 可用知识', route: '/knowledge?focus=ai_ready' },
        { id: 'knowledge-audit', label: '审计经验', route: '/knowledge?focus=audit_linked' },
        { id: 'knowledge-pdca', label: 'PDCA 复盘', route: '/knowledge?category=PDCA' }
      ]
    },
    {
      id: 'hub-strategy',
      title: '战略执行中战役',
      value: `${strategicInProgressCount}`,
      subtitle: `待启动 ${strategicPendingCount} · 已完成 ${strategicCompletedCount}${strategyUpdatedLabel ? ` · 推演 ${strategyUpdatedLabel}` : ''}`,
      route: strategicTasks.length > 0 ? '/strategy?tab=execution&status=In%20Progress' : '/strategy?tab=analysis',
      tone: 'emerald',
      icon: <BrainCircuit className="w-5 h-5" />,
      emptyText: '当前还没有战略任务，可先进入推演视图。',
      previews: strategyBoardTasks.map(task => ({
        id: task.id,
        label: task.title,
        meta: `${task.status}${task.owner ? ` · ${task.owner}` : ''}${task.deadline ? ` · ${task.deadline}` : ''}`,
        route: task.status === 'Completed'
          ? '/strategy?tab=execution&status=Completed'
          : task.status === 'Pending'
            ? '/strategy?tab=execution&status=Pending'
            : '/strategy?tab=execution&status=In%20Progress'
      })),
      actions: [
        { id: 'strategy-progress', label: '攻坚中', route: '/strategy?tab=execution&status=In%20Progress' },
        { id: 'strategy-pending', label: '待启动', route: '/strategy?tab=execution&status=Pending' },
        { id: 'strategy-analysis', label: '战略推演', route: '/strategy?tab=analysis' }
      ]
    },
    {
      id: 'hub-ai',
      title: 'AI 运行与治理',
      value: 'Kimi K2.5',
      subtitle: `成员 ${userProfiles.length} 人 · 训练资料 ${learnedDocsCount} 份`,
      route: '/ai-center?panel=model-status',
      tone: 'blue',
      icon: <Database className="w-5 h-5" />,
      emptyText: '当前没有运行快照。',
      previews: aiPreviewItems,
      actions: [
        { id: 'ai-model', label: '模型状态', route: '/ai-center?panel=model-status' },
        { id: 'ai-security', label: '安全策略', route: '/ai-center?panel=security' },
        { id: 'ai-members', label: '成员治理', route: '/ai-center?panel=members' }
      ]
    }
  ], [
    learnedDocsCount,
    auditLinkedKnowledgeCount,
    pdcaKnowledgeCount,
    latestKnowledgeDocs,
    strategicInProgressCount,
    strategicPendingCount,
    strategicCompletedCount,
    strategyUpdatedLabel,
    strategicTasks.length,
    strategyBoardTasks,
    userProfiles.length,
    aiPreviewItems
  ]);

  const roleHint = PERSONA_LABEL[persona];

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">工作台</h2>
          <p className="text-xs text-gray-500 mt-1">当前：{roleHint}（由顶部“当前视角”统一控制，可用 ?persona= 仅做调试覆盖）</p>
        </div>
      </div>

      {/* A. 顶部 KPI / Boss 三段式 */}
      {persona === 'boss' ? (
        <BossDashboard
          overviewCards={bossOverviewCards.map(card => ({
            id: card.id,
            title: card.title,
            value: card.value,
            route: card.route,
            hint: card.subtitle
          }))}
          riskCards={bossRiskCards}
          teamCards={bossTeamCards}
        />
      ) : persona === 'sales' ? (
        <SalesDashboard metrics={dashboardMetrics.sales} />
      ) : persona === 'consultant' ? (
        <ConsultantDashboard metrics={dashboardMetrics.consultant} />
      ) : (
        <FinanceDashboard metrics={dashboardMetrics.finance} />
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-black text-gray-900">专项联动中心</h3>
            <p className="text-xs text-gray-500 mt-1">不只做跳转，直接在工作台预览知识、战役和 AI 治理焦点。</p>
          </div>
          <span className="text-[11px] font-bold text-gray-400">可直接进入焦点视图或打开最近项</span>
        </div>
        <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
          {hubCards.map(card => {
            const toneClass = card.tone === 'indigo'
              ? { border: 'border-indigo-100', icon: 'bg-indigo-50 text-indigo-600', value: 'text-indigo-700', button: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50', item: 'hover:border-indigo-200 hover:bg-indigo-50/40' }
              : card.tone === 'emerald'
                ? { border: 'border-emerald-100', icon: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700', button: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50', item: 'hover:border-emerald-200 hover:bg-emerald-50/40' }
                : { border: 'border-blue-100', icon: 'bg-blue-50 text-blue-600', value: 'text-blue-700', button: 'border-blue-200 text-blue-700 hover:bg-blue-50', item: 'hover:border-blue-200 hover:bg-blue-50/40' };
            return (
              <div
                key={card.id}
                className={`rounded-2xl border bg-gradient-to-br from-white to-gray-50 p-5 shadow-sm ${toneClass.border}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${toneClass.icon}`}>
                      {card.icon}
                    </div>
                    <div className={`mt-4 text-2xl font-black ${toneClass.value}`}>{card.value}</div>
                    <div className="mt-1 text-sm font-black text-gray-900">{card.title}</div>
                    <div className="mt-2 text-xs leading-5 text-gray-500">{card.subtitle}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCardClick(card.route)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50"
                  >
                    进入
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {card.previews.length > 0 ? card.previews.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onCardClick(item.route)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2 text-left transition ${toneClass.item}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-gray-800">{item.label}</div>
                        <div className="mt-1 truncate text-[11px] text-gray-500">{item.meta}</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    </button>
                  )) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-4 text-xs text-gray-400">
                      {card.emptyText}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {card.actions.map(action => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => onCardClick(action.route)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${toneClass.button}`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* B. AI MORNING BRIEF */}
          <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-2xl shadow-sm border border-indigo-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Sparkles className="w-48 h-48 text-indigo-600" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-indigo-900 flex items-center">
                <Zap className="w-5 h-5 mr-2 text-yellow-500 animate-pulse" />
                AI 智能全域简报 (MORNING BRIEF)
              </h3>
              <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded shadow-sm font-bold">Kimi K2.5 驱动</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-indigo-100 flex items-start space-x-3">
                <div className="bg-blue-100 p-2 rounded-lg text-blue-600 shrink-0"><Target className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">线索商机洞察</p>
                    <button className="text-[11px] font-bold text-indigo-600" onClick={() => toggleAiBlock('opportunity')}>
                      {aiOpenState.opportunity ? '折叠' : '展开'}
                    </button>
                  </div>
                  {aiOpenState.opportunity ? (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed cursor-pointer" onClick={() => navigate('/customers')}>
                      {opportunities.length > 0
                        ? `AI 检测到 ${opportunities.length} 个潜在增购增长点。重点关注：【${opportunities[0].title.split('：')[1] || '待跟进项目'}】等。`
                        : '当前暂无新增商机匹配，建议执行全域巡检以挖掘老客户二次开发潜力。'}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1 truncate">已折叠，点击展开查看详情</p>
                  )}
                </div>
              </div>

              <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-red-100 flex items-start space-x-3">
                <div className="bg-red-100 p-2 rounded-lg text-red-600 shrink-0"><AlertTriangle className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">交付与合规风险</p>
                    <button className="text-[11px] font-bold text-indigo-600" onClick={() => toggleAiBlock('risk')}>
                      {aiOpenState.risk ? '折叠' : '展开'}
                    </button>
                  </div>
                  {aiOpenState.risk ? (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed cursor-pointer" onClick={() => navigate('/projects')}>
                      {risks.length > 0
                        ? `警告：系统内存在 ${risks.length} 项重大风险预警。建议优先处理【${risks[0].title}】等关键卡点。`
                        : '交付链路处于稳定区间，当前未发现新增重大风险。'}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1 truncate">已折叠，点击展开查看详情</p>
                  )}
                </div>
              </div>

              <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-emerald-100 flex items-start space-x-3 md:col-span-2">
                <div className="bg-emerald-100 p-2 rounded-lg text-emerald-700 shrink-0"><Sparkles className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">情报雷达（今日）</p>
                    <button className="text-[11px] font-bold text-indigo-600" onClick={() => toggleAiBlock('intel')}>
                      {aiOpenState.intel ? '折叠' : '展开'}
                    </button>
                  </div>
                  {aiOpenState.intel ? (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed cursor-pointer" onClick={() => navigate('/intel')}>
                      {intelToday.length > 0
                        ? `今日新增 ${intelToday.length} 条情报，高紧急 ${intelHigh.length} 条。点击进入一键转化为跟进项目。`
                        : '暂无今日情报。进入情报雷达抓取最新政策/行业/企业动态。'}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1 truncate">按角色折叠，点击展开查看详情</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* D. 月度回款趋势 */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2 text-blue-500" />
                月度回款趋势（已核销）
              </h3>
              <div className="flex items-center gap-3">
                <button
                  className="text-xs font-black text-gray-500 hover:text-gray-700"
                  onClick={() => setTrendCollapsed(prev => !prev)}
                >
                  {trendCollapsed ? '展开图表' : '折叠图表'}
                </button>
                <button
                  className="text-xs font-black text-indigo-600 hover:text-indigo-700"
                  onClick={() => navigate('/finance', { state: { filterStatus: 'paid' } })}
                  title="查看回款明细"
                >
                  查看回款 <ArrowRight className="w-3.5 h-3.5 inline-block ml-1" />
                </button>
              </div>
            </div>
            {!trendCollapsed ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={trendData}
                    onClick={(event: any) => {
                      const key = event?.activePayload?.[0]?.payload?.key;
                      if (!key) return;
                      navigate('/finance', { state: { filterStatus: 'paid', filterMonth: key } });
                    }}
                  >
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="revenue" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
                图表已折叠。老板/财务默认展开，销售/咨询师默认折叠。
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* C. 任务提醒箱（Action） */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-gray-50/30">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 flex items-center">任务提醒箱</h3>
                <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] rounded-md font-bold animate-pulse">
                  {reminderView === 'aggregated' ? scopedTaskReminders.length : detailReminders.length}
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-xs text-gray-400 uppercase tracking-tight">
                  {reminderView === 'aggregated' ? '按对象聚合：我负责的可执行待办' : '原子化动作：逐条处理并可标记完成'}
                </p>
                <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm w-full">
                  <button
                    onClick={() => setReminderView('aggregated')}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      reminderView === 'aggregated' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    聚合视图
                  </button>
                  <button
                    onClick={() => setReminderView('detail')}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      reminderView === 'detail' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    明细视图
                  </button>
                </div>

                {reminderView === 'detail' && (
                  <div className="space-y-2">
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <div ref={scopeDropdownRef} className="relative w-full md:w-auto md:min-w-[280px]">
                        <button
                          type="button"
                          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none text-left flex items-center justify-between gap-2"
                          onClick={toggleScopeDropdown}
                          title={detailScopeLabel}
                        >
                          <span className="truncate">{detailScopeLabel}</span>
                          <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${scopeDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {scopeDropdownOpen && (
                          <div
                            className={`absolute z-40 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl p-1 max-h-56 overflow-y-auto custom-scrollbar ${
                              scopeDropdownDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
                            }`}
                          >
                            <button
                              type="button"
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                detailScopeKey === '' ? 'bg-indigo-600 text-white font-bold' : 'text-gray-700 hover:bg-gray-50'
                              }`}
                              onClick={() => {
                                setDetailScopeKey('');
                                setCollapsedGroupKeys({});
                                setScopeDropdownOpen(false);
                              }}
                            >
                              全部对象
                            </button>
                            {taskAggregatedReminders.map(agg => {
                              const scopeKey = `${agg.linkType}:${agg.linkId}`;
                              const label = `${agg.projectName ? `项目：${agg.projectName}` : agg.customerName ? `客户：${agg.customerName}` : `${agg.linkType}:${agg.linkId}`}（${agg.count}）`;
                              return (
                                <button
                                  key={agg.id}
                                  type="button"
                                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                    detailScopeKey === scopeKey ? 'bg-indigo-600 text-white font-bold' : 'text-gray-700 hover:bg-gray-50'
                                  }`}
                                  onClick={() => {
                                    setDetailScopeKey(scopeKey);
                                    setCollapsedGroupKeys({});
                                    setScopeDropdownOpen(false);
                                  }}
                                  title={label}
                                >
                                  <span className="block truncate">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <input
                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                        placeholder="搜索提醒关键词…"
                        value={detailSearch}
                        onChange={event => setDetailSearch(event.target.value)}
                      />
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm w-fit">
                        <button
                          onClick={() => setDetailGrouped(true)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            detailGrouped ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          分组
                        </button>
                        <button
                          onClick={() => setDetailGrouped(false)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            !detailGrouped ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          平铺
                        </button>
                      </div>

                      {detailScopeKey && (
                        <div className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                          <span className="text-xs font-bold text-gray-700 truncate">{getScopeLabel(detailScopeKey)}</span>
                          <button
                            className="text-xs font-bold text-gray-500 hover:text-gray-800"
                            onClick={() => {
                              setDetailScopeKey('');
                              setCollapsedGroupKeys({});
                            }}
                          >
                            清除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-y-auto p-4 space-y-3 max-h-[420px] custom-scrollbar">
              {reminderView === 'aggregated' &&
                taskAggregatedReminders.map(agg => (
                  <div
                    key={agg.id}
                    className={`group p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer bg-white border border-gray-100 shadow-sm ${
                      agg.severity === 'high' ? 'border-l-red-500' : agg.severity === 'medium' ? 'border-l-amber-500' : 'border-l-indigo-500'
                    }`}
                    onClick={() => jumpByLink(agg.linkType, agg.linkId)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-[10px] font-extrabold uppercase ${
                              agg.severity === 'high' ? 'text-red-500' : agg.severity === 'medium' ? 'text-amber-500' : 'text-indigo-500'
                            }`}
                          >
                            {agg.severity === 'high' ? '🚨 严重风险' : agg.severity === 'medium' ? '⚠️ 风险提示' : '💡 机会/到期'}
                          </span>
                          <span className="text-gray-300 text-[10px]">•</span>
                          <span className="text-[10px] text-gray-400">{agg.latestDate || '-'}</span>
                          <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-50 text-gray-500">{agg.count} 条</span>
                        </div>
                        <p className="text-sm font-bold text-gray-900 mt-1 group-hover:text-blue-700 transition-colors truncate">{agg.mainScene}</p>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">
                          {(agg.customerName ? `客户【${agg.customerName}】` : '') +
                            (agg.projectName ? ` · 项目【${agg.projectName}】` : '')}
                        </p>
                        {agg.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {agg.tags.slice(0, 4).map(tag => (
                              <span key={tag} className="px-2 py-0.5 bg-gray-50 text-gray-500 text-[10px] rounded-full font-bold">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {expandedAggId === agg.id && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                            {agg.samples.map(reminder => (
                              <div
                                key={reminder.id}
                                className="p-3 rounded-lg bg-gray-50/60 border border-gray-100 hover:bg-gray-50 transition-colors"
                                onClick={event => {
                                  event.stopPropagation();
                                  jumpByLink(reminder.linkType, reminder.linkId);
                                }}
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-gray-800 truncate">{reminder.title}</p>
                                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{reminder.content}</p>
                                  </div>
                                  <button
                                    onClick={event => {
                                      event.stopPropagation();
                                      dismissReminder(reminder.id);
                                    }}
                                    className="p-1.5 bg-white rounded-lg shadow-sm text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all"
                                    title="标记完成"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          setExpandedAggId(expandedAggId === agg.id ? null : agg.id);
                        }}
                        className="opacity-100 p-1.5 bg-gray-50 rounded-lg shadow-sm text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all ml-2"
                        title={expandedAggId === agg.id ? '收起明细' : '查看明细'}
                      >
                        <Bell className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

              {reminderView === 'detail' && !detailGrouped &&
                detailReminders.map(reminder => (
                  <div
                    key={reminder.id}
                    className={`group p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer bg-white border border-gray-100 shadow-sm ${
                      reminder.type === 'risk' ? 'border-l-red-500' : reminder.type === 'opportunity' ? 'border-l-indigo-500' : 'border-l-amber-500'
                    }`}
                    title={reminder.content}
                    onClick={() => jumpByLink(reminder.linkType, reminder.linkId)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-[10px] font-extrabold uppercase ${
                              reminder.type === 'risk' ? 'text-red-500' : reminder.type === 'opportunity' ? 'text-indigo-500' : 'text-amber-500'
                            }`}
                          >
                            {reminder.type === 'risk' ? '⚠️ 紧急风险' : reminder.type === 'opportunity' ? '💡 增购动作' : '📅 常规待办'}
                          </span>
                          <span className="text-gray-300 text-[10px]">•</span>
                          <span className="text-[10px] text-gray-400">{reminder.date}</span>
                        </div>
                        <p className="text-sm font-bold text-gray-900 mt-1 group-hover:text-blue-700 transition-colors">{reminder.title}</p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{reminder.content}</p>
                      </div>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          dismissReminder(reminder.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 bg-gray-50 rounded-lg shadow-sm text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all ml-2"
                        title="标记完成"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

              {reminderView === 'detail' && detailGrouped &&
                groupedDetail.map(group => (
                  <div key={group.key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <button
                      className="w-full px-4 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between"
                      onClick={() => setCollapsedGroupKeys(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                      title={group.label}
                    >
                      <div className="min-w-0 text-left">
                        <p className="text-xs font-black text-gray-800 truncate">{group.label}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{group.items.length} 条</p>
                      </div>
                      <span className="text-xs font-black text-gray-400">{collapsedGroupKeys[group.key] ? '展开' : '收起'}</span>
                    </button>
                    {!collapsedGroupKeys[group.key] && (
                      <div className="p-3 space-y-2">
                        {group.items.map(reminder => (
                          <div
                            key={reminder.id}
                            className={`group p-4 rounded-xl border-l-4 transition-all hover:translate-x-1 cursor-pointer bg-white border border-gray-100 ${
                              reminder.type === 'risk' ? 'border-l-red-500' : reminder.type === 'opportunity' ? 'border-l-indigo-500' : 'border-l-amber-500'
                            }`}
                            title={reminder.content}
                            onClick={() => jumpByLink(reminder.linkType, reminder.linkId)}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <span
                                    className={`text-[10px] font-extrabold uppercase ${
                                      reminder.type === 'risk'
                                        ? 'text-red-500'
                                        : reminder.type === 'opportunity'
                                          ? 'text-indigo-500'
                                          : 'text-amber-500'
                                    }`}
                                  >
                                    {reminder.type === 'risk' ? '⚠️ 紧急风险' : reminder.type === 'opportunity' ? '💡 增购动作' : '📅 常规待办'}
                                  </span>
                                  <span className="text-gray-300 text-[10px]">•</span>
                                  <span className="text-[10px] text-gray-400">{reminder.date}</span>
                                </div>
                                <p className="text-sm font-bold text-gray-900 mt-1 group-hover:text-blue-700 transition-colors">{reminder.title}</p>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{reminder.content}</p>
                              </div>
                              <button
                                onClick={event => {
                                  event.stopPropagation();
                                  dismissReminder(reminder.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1.5 bg-gray-50 rounded-lg shadow-sm text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all ml-2"
                                title="标记完成"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

              {reminderView === 'detail' && detailReminders.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center opacity-40">
                  <CheckCircle className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-gray-400 text-sm font-medium">恭喜！暂无待办任务</p>
                </div>
              )}

              {reminderView === 'aggregated' && taskAggregatedReminders.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center opacity-40">
                  <CheckCircle className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-gray-400 text-sm font-medium">恭喜！暂无待处理对象</p>
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50/50 border-t border-gray-100">
              <button
                onClick={() => navigate('/audit')}
                className="w-full py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center shadow-sm"
              >
                进入全量审计中心 <ArrowRight className="w-3 h-3 ml-2" />
              </button>
            </div>
          </div>

          {/* E. 异常/风险流（Monitor） */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50/40 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">异常/风险流</h3>
              <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] rounded-md font-bold">
                {alertAggregatedReminders.length || scopedAlertReminders.length}
              </span>
            </div>
            <div className="max-h-[260px] overflow-y-auto custom-scrollbar p-3 space-y-2">
              {alertAggregatedReminders.length > 0 ? (
                alertAggregatedReminders.slice(0, 8).map(alert => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => jumpByLink(alert.linkType, alert.linkId)}
                    className="w-full text-left p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-black ${
                          alert.severity === 'high' ? 'text-red-500' : alert.severity === 'medium' ? 'text-amber-500' : 'text-indigo-500'
                        }`}
                      >
                        {alert.severity === 'high' ? '严重' : alert.severity === 'medium' ? '高' : '中低'}
                      </span>
                      <span className="text-[10px] text-gray-400">{alert.latestDate || '-'}</span>
                    </div>
                    <p className="text-sm font-bold text-gray-900 mt-1 line-clamp-1">{alert.mainScene}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">
                      {(alert.customerName ? `客户【${alert.customerName}】` : '') +
                        (alert.projectName ? ` · 项目【${alert.projectName}】` : '')}
                    </p>
                  </button>
                ))
              ) : scopedAlertReminders.length > 0 ? (
                scopedAlertReminders.slice(0, 8).map(reminder => (
                  <button
                    key={reminder.id}
                    type="button"
                    onClick={() => jumpByLink(reminder.linkType, reminder.linkId)}
                    className="w-full text-left p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-red-500">预警</span>
                      <span className="text-[10px] text-gray-400">{reminder.date || '-'}</span>
                    </div>
                    <p className="text-sm font-bold text-gray-900 mt-1 line-clamp-1">{reminder.title}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-1">{reminder.content}</p>
                  </button>
                ))
              ) : (
                <div className="py-8 text-center text-sm text-gray-400">暂无异常提醒</div>
              )}
            </div>
            <div className="p-3 border-t border-gray-100 bg-gray-50/40">
              <button
                className="w-full py-2 text-xs font-bold text-indigo-600 bg-white border border-indigo-100 rounded-xl hover:bg-indigo-50 transition"
                onClick={() => navigate('/dashboard')}
              >
                查看全部提醒
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
