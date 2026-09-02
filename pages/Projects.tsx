
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { TaskSkipButton } from '../components/TaskSkipButton';
import { ProjectCompleteChecklist } from '../components/ProjectCompleteChecklist';
import { Status, Project, ProjectTask, Receivable, TaskTemplate, ServiceCatalogItem, ServiceCategory, ProjectWorkLog, TaskSkipReason, TASK_SKIP_REASON_LABEL } from '../types';
import { SERVICE_CATALOG, SERVICE_CATEGORIES, SERVICE_CATEGORY_DELIVERY_MODE, DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY } from '../constants';
import { 
  Briefcase, Search, Plus, Clock, AlertTriangle, 
  CheckCircle, ChevronDown, ChevronRight, DollarSign, Bell, 
  X, Wallet, PlayCircle, Sparkles, ShieldCheck, ArrowRight,
  ListTodo, Trash2, LayoutGrid, Timer, CheckCircle2, MoreHorizontal,
  Brain, RefreshCw, Zap
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveProjectCapabilities } from '../src/utils/projectCapabilities';
import { readGlobalSearchQuery } from '../src/modules/global_search';
import { TASK_STATUS, WORK_LOG_SOURCE } from '../src/constants/status.ts';
import { StatusBadge } from '../src/ui/statusBadge';
import { Badge, SearchInput, EmptyState, StatCard, StatGrid, tableHeadClass, thClass, tdClass, trClass } from '../src/ui';

const normalizeServiceToken = (value: string) => (value || '')
  .toUpperCase()
  .replace(/[\s/\\\-_.()（）]+/g, '')
  .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, '');

const getCatalogTokens = (item: ServiceCatalogItem) => {
  const tokens = [item.code, item.name, ...(item.aliases || [])]
    .filter(Boolean)
    .map(val => normalizeServiceToken(String(val)));
  return Array.from(new Set(tokens.filter(Boolean)));
};

const matchServiceCatalog = (input: string, category?: ServiceCategory | ''): ServiceCatalogItem | null => {
  const raw = (input || '').trim();
  if (!raw) return null;
  const candidates = SERVICE_CATALOG.filter(item => !category || item.category === category);
  const exact = candidates.find(item => item.name === raw);
  if (exact) return exact;
  const normalized = normalizeServiceToken(raw);
  if (!normalized) return null;

  for (const item of candidates) {
    const tokens = getCatalogTokens(item);
    if (tokens.some(token => normalized.includes(token))) {
      return item;
    }
  }

  return null;
};

const Projects = () => {
  const { projects, customers, contracts, marketSignals, projectWorkLogs, auditIssues, toggleReceivableStatus, claimReceivablePaid, addProject, assignProjectManager, updateProjectTask, deleteProjectTask, addProjectTask, applyTemplateToProject, addProjectServiceItem, updateProjectServiceItem, deleteProjectServiceItem, addProjectWorkLog, deleteProjectWorkLog, completeProject, reopenProject, updateProjectCost, convertIntelProjectToLead, bindFollowUpProjectToCustomer, taskTemplates, addTaskTemplate, updateTaskTemplate, deleteTaskTemplate, archiveTaskTemplate, cloneTaskTemplate, activeRole, currentUser, userProfiles, checkActionPermission, aiDecisionLogs, runProjectDiagnosis } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);
  const [costEditingId, setCostEditingId] = useState<string | null>(null);
  const [costEditingAmount, setCostEditingAmount] = useState<number>(0);
  const [assignProjectId, setAssignProjectId] = useState<string | null>(null);
  const [assignManager, setAssignManager] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewScope, setViewScope] = useState<'all' | 'related'>(() => activeRole === 'CONSULTANT' ? 'related' : 'all');
  // 交付项目与跟进项目分开看：跟进项目还没签约，混在一起会让交付数据失真
  const [modeScope, setModeScope] = useState<'delivery' | 'followup' | 'all'>('delivery');
  const [assignOwnerUserId, setAssignOwnerUserId] = useState('');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateModalProjectId, setTemplateModalProjectId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showArchivedTemplates, setShowArchivedTemplates] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateTasks, setEditingTemplateTasks] = useState<TaskTemplate['tasks']>([]);
  const [undoComplete, setUndoComplete] = useState<{ projectId: string; eventId: string; expiresAt: number } | null>(null);
  const [seenAutoCompleteEvents, setSeenAutoCompleteEvents] = useState<string[]>([]);
  const [taskViewMode, setTaskViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [dashboardFocus, setDashboardFocus] = useState<any>(null);
  const [dashboardFocusLabel, setDashboardFocusLabel] = useState('');
  const [followUpCustomerBinding, setFollowUpCustomerBinding] = useState<Record<string, string>>({});
  const [workLogDrafts, setWorkLogDrafts] = useState<Record<string, {
    logDate: string;
    serviceItemId: string;
    taskId: string;
    actualHours: string;
    workContent: string;
    issueNote: string;
    nextPlan: string;
  }>>({});
  const [serviceDraft, setServiceDraft] = useState<{
    projectId: string;
    rawName: string;
    category: ServiceCategory | '';
    owner: string;
    autoTasks: boolean;
  } | null>(null);

  const canManageTemplate = (tpl: TaskTemplate) => {
    if (tpl.isBuiltIn) return false;
    if (activeRole === 'ADMIN') return true;
    if (tpl.createdByUserId && tpl.createdByUserId === currentUser.id) return true;
    return false;
  };

  const dateKey = (d?: string) => {
    const t = d ? new Date(d).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  };

  const filteredTemplatesForModal = taskTemplates
    .filter(t => showArchivedTemplates ? true : !t.archived)
    .filter(t => {
      const q = templateSearch.trim().toLowerCase();
      if (!q) return true;
      return `${t.name || ''}`.toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => {
      const au = dateKey(a.lastUsedAt);
      const bu = dateKey(b.lastUsedAt);
      if (au !== bu) return bu - au;
      const ac = dateKey(a.createdAt);
      const bc = dateKey(b.createdAt);
      return bc - ac;
    });

  const beginEditTemplate = (tpl: TaskTemplate) => {
    setEditingTemplateId(tpl.id);
    setEditingTemplateName(tpl.name || '');
    setEditingTemplateTasks((tpl.tasks || []).map(t => ({ ...t })));
  };

  const resetTemplateEditor = () => {
    setEditingTemplateId(null);
    setEditingTemplateName('');
    setEditingTemplateTasks([]);
  };

  const handleSaveAsTemplate = (project: Project) => {
    const name = prompt("请输入新模版名称", `${project.name} 模版`);
    if (name) {
        addTaskTemplate({
            id: `TPL-${Date.now()}`,
            name,
            tasks: project.tasks.map(t => ({ title: t.title, priority: t.priority, category: t.category }))
        });
        alert("模版保存成功！");
    }
  };

  const templateModalProject = templateModalProjectId
    ? projects.find(p => p.id === templateModalProjectId) || null
    : null;

  const [formData, setFormData] = useState<Partial<Project>>({
    name: '', manager: '', deadline: '', duration: 30, projectType: 'Self-Operated', projectCategory: 'Delivery'
  });
  const defaultWorkLogDraft = () => ({
    logDate: new Date().toISOString().split('T')[0],
    serviceItemId: '',
    taskId: '',
    actualHours: '1',
    workContent: '',
    issueNote: '',
    nextPlan: ''
  });

  const assignableManagers = Array.from(new Set(
    userProfiles
      .filter(u => u.id !== 'AI-WORKER')
      .map(u => String(u.name || '').trim())
      .filter(Boolean)
  ));
  const managerOptions = ['待指派', ...assignableManagers];
  const isValidManager = (value: string) => value === '待指派' || assignableManagers.includes(value);

  const openCreateModal = () => {
    const defaultManager = String(currentUser?.name || '').trim() || '待指派';
    setFormData({
      name: '',
      manager: defaultManager,
      deadline: '',
      duration: 30,
      projectType: 'Self-Operated',
      projectCategory: 'Delivery'
    });
    setIsModalOpen(true);
  };

  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const weekStartMs = (() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  })();
  /**
   * 「与我相关」的判定。
   * 一份合同常有多个服务项由不同咨询师负责，所以不能只认项目负责人——
   * 只要我是负责人、负责其中任一服务项、或有任务在我名下，这个项目就与我相关。
   */
  const isMineProject = (project: Project) => {
    const ownerId = String((project as any).ownerUserId || '').trim();
    if (ownerId && ownerId === currentUser.id) return true;
    if (project.manager === currentUser.name) return true;
    if ((project.serviceItems || []).some(si => String((si as any).ownerUserId || '') === currentUser.id || String(si.owner || '') === currentUser.name)) return true;
    return (project.tasks || []).some(task => String(task.owner || '') === currentUser.name);
  };
  const isOpenTask = (task: ProjectTask) => task.status !== 'Completed';
  const isOverdueTask = (task: ProjectTask) => isOpenTask(task) && new Date(String(task.deadline || '')).getTime() < Date.now();
  const isDueSoonTask = (task: ProjectTask) => {
    const diff = Math.ceil((new Date(String(task.deadline || '')).getTime() - Date.now()) / (24 * 3600 * 1000));
    return isOpenTask(task) && diff >= 0 && diff <= 7;
  };
  const isRevenueProject = (project: Project) => {
    const capability = resolveProjectCapabilities(project);
    if (capability.projectMode !== 'delivery') return false;
    if (project.status !== Status.Completed) return false;
    if ((project as any).isRevenueProject === false) return false;
    return true;
  };
  const projectCompletedMonth = (project: Project) => {
    const actualEndDate = String(project.completionRecord?.actualEndDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(actualEndDate)) return actualEndDate.slice(0, 7);
    const completedAt = String(project.completionRecord?.completedAt || '').trim();
    const completedTs = Date.parse(completedAt);
    return Number.isFinite(completedTs) ? new Date(completedTs).toISOString().slice(0, 7) : '';
  };
  const hasHighRisk = (project: Project) => project.status === Status.Risk || project.aiInsight?.riskLevel === 'High';
  const matchesProjectFocus = (project: Project) => {
    if (!dashboardFocus?.type) return true;
    if (dashboardFocus.owner === 'me' && !isMineProject(project)) return false;

    if (dashboardFocus.type === 'revenue_completed') return isRevenueProject(project) && (!dashboardFocus.month || projectCompletedMonth(project) === dashboardFocus.month);
    if (dashboardFocus.type === 'high_risk') return hasHighRisk(project);
    if (dashboardFocus.type === 'overdue_tasks') return (project.tasks || []).some(task => dashboardFocus.owner === 'me' ? String(task.owner || '') === currentUser.name && isOverdueTask(task) : isOverdueTask(task));
    if (dashboardFocus.type === 'due_7d') return (project.tasks || []).some(task => dashboardFocus.owner === 'me' ? String(task.owner || '') === currentUser.name && isDueSoonTask(task) : isDueSoonTask(task));
    if (dashboardFocus.type === 'completed_7d') return projectWorkLogs.some(log => log.projectId === project.id && log.source === WORK_LOG_SOURCE.TASK_TRANSITION && String(log.operatorName || '') === currentUser.name && new Date(String(log.logDate || '')).getTime() >= weekStartMs);
    if (dashboardFocus.type === 'customer_confirm') return (project.tasks || []).some(task => String(task.owner || '') === currentUser.name && isOpenTask(task) && /确认|回传|审核|签字|盖章/.test(String(task.title || '')));
    // 同样按任务算，不用 project.progress（它和任务状态不同步）
    if (dashboardFocus.type === 'progress_lt_50') return project.status === Status.Active && taskProgress(project).pct < 50;
    if (dashboardFocus.type === 'missing_contract_amount') return project.projectCategory === 'Delivery' && Number(project.projectAmount || 0) <= 0;
    if (dashboardFocus.type === 'delay') return (project.tasks || []).some(task => isOverdueTask(task));
    if (dashboardFocus.type === 'logs') return projectWorkLogs.some(log => log.projectId === project.id && (!dashboardFocus.owner || String(log.operatorName || '') === currentUser.name) && (!dashboardFocus.range || new Date(String(log.logDate || '')).getTime() >= weekStartMs));
    if (dashboardFocus.type === 'busiest_owner') return (project.tasks || []).some(task => String(task.owner || '') === currentUser.name && isOpenTask(task));
    if (dashboardFocus.type === 'team_overview') return project.status === Status.Active;
    if (dashboardFocus.type === 'active_projects') return project.status === Status.Active;
    return true;
  };

  useEffect(() => {
    const state: any = location.state || {};
    const focus = state.dashboardFocus;

    if (state.openDetailId) {
      setExpandedProject(state.openDetailId);
    }

    if (focus?.type) {
      setDashboardFocus(focus);
      setSearchTerm('');
      setTaskViewMode(['overdue_tasks', 'due_7d', 'customer_confirm', 'busiest_owner'].includes(focus.type) ? 'flat' : 'grouped');
      setViewScope(focus.owner === 'me' || activeRole === 'CONSULTANT' ? 'related' : 'all');
      setFilterStatus(['revenue_completed', 'completed_7d'].includes(focus.type) ? 'Completed' : focus.type === 'team_overview' ? 'All' : 'Active');
      /*
        从工作台点进来时，「交付 / 跟进」开关要放开到两者都看。

        本页默认只看交付项目，而工作台的指标（在制项目数、日志覆盖率、延误率…）
        统计的是**所有**在制项目，跟进类项目也算在分母里。不放开的话，
        卡片和列表算的根本不是同一批项目。

        2026-08-24 实测：卡片「本周日志覆盖率 6.3%」，点进去却是「共 0 个项目」——
        因为那唯一一个近 7 天有日志的在制项目是【情报跟进】类，被默认的交付筛选挡掉了。
        用户看到的是「有个数字，点进去什么都没有」，只会认为系统在乱报。
      */
      setModeScope('all');

      if (focus.type === 'revenue_completed') setDashboardFocusLabel(focus.owner === 'me' ? '我的本月营收项目' : '本月营收项目');
      else if (focus.type === 'high_risk') setDashboardFocusLabel(focus.owner === 'me' ? '我的高风险项目' : '高风险项目');
      else if (focus.type === 'overdue_tasks') setDashboardFocusLabel(focus.owner === 'me' ? '我的逾期任务项目' : '逾期任务项目');
      else if (focus.type === 'due_7d') setDashboardFocusLabel(focus.owner === 'me' ? '我 7 天内到期任务' : '7 天内到期任务');
      else if (focus.type === 'completed_7d') setDashboardFocusLabel('我本周完成任务涉及项目');
      else if (focus.type === 'customer_confirm') setDashboardFocusLabel('客户待确认事项');
      else if (focus.type === 'progress_lt_50') setDashboardFocusLabel('服务进度低于 50% 项目');
      else if (focus.type === 'missing_contract_amount') setDashboardFocusLabel('合同金额缺失项目');
      else if (focus.type === 'delay') setDashboardFocusLabel('项目延误清单');
      else if (focus.type === 'logs') setDashboardFocusLabel(focus.metric === 'hours' ? '本周工时日志项目' : '本周日志覆盖项目');
      else if (focus.type === 'busiest_owner') setDashboardFocusLabel('任务堆积最多项目');
      else if (focus.type === 'team_overview') setDashboardFocusLabel('团队项目总览');
      else if (focus.type === 'active_projects') setDashboardFocusLabel(focus.owner === 'me' ? '我负责的进行中项目' : '进行中项目');
    }

    if (state.dashboardFocus || state.openDetailId) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state, activeRole]);

  useEffect(() => {
    const q = readGlobalSearchQuery(location.search);
    setSearchTerm(q);
  }, [location.search]);

  useEffect(() => {
    setViewScope(activeRole === 'CONSULTANT' ? 'related' : 'all');
  }, [activeRole]);

  useEffect(() => {
    if (undoComplete) return;
    const nowMs = Date.now();
    const nextAuto = projects.find(p => {
      const record: any = (p as any).completionRecord;
      const eventId = record?.eventId;
      const autoCompleted = Boolean(record?.autoCompleted);
      if (p.status !== Status.Completed || !autoCompleted || typeof eventId !== 'string') return false;
      if (seenAutoCompleteEvents.includes(eventId)) return false;
      const completedAt = record?.completedAt;
      const completedMs = typeof completedAt === 'string' ? new Date(completedAt).getTime() : NaN;
      if (!Number.isFinite(completedMs)) return false;
      return nowMs < (completedMs + 30_000);
    });
    if (!nextAuto) return;
    const record: any = (nextAuto as any).completionRecord;
    const eventId = record.eventId as string;
    const expiresAt = new Date(record.completedAt).getTime() + 30_000;
    setSeenAutoCompleteEvents(prev => prev.includes(eventId) ? prev : [...prev, eventId]);
    setUndoComplete({ projectId: nextAuto.id, eventId, expiresAt });
  }, [projects, seenAutoCompleteEvents, undoComplete]);

  useEffect(() => {
    if (!undoComplete) return;
    const ms = undoComplete.expiresAt - Date.now();
    if (ms <= 0) { setUndoComplete(null); return; }
    const t = window.setTimeout(() => setUndoComplete(null), ms);
    return () => window.clearTimeout(t);
  }, [undoComplete]);

  const [filterStatus, setFilterStatus] = useState<'Active' | 'Completed' | 'All'>('Active');
  
  /**
   * 概览卡片的统计口径。
   *
   * 关键：只跟随「与我相关 / 全公司」这一个范围开关，不跟状态和类别筛选——
   * 否则筛"进行中"时"已完成项目"会变成 0，卡片就没意义了。
   *
   * 之所以要跟随范围，是因为之前卡片按全量算、列表按角色范围算，
   * 出现过"卡片说 13、列表只给 1 条"。现在两者同源，永远对得上。
   */
  const overviewStats = useMemo(() => {
    /*
      口径必须和列表完全一致，副标题就是这么承诺的。修之前有三处不一致：
        ① 四张卡片内部就不统一 —— 前三张按「交付项目」算，红色那张按「交付+跟进」算；
        ② 四张都不跟随眼前的「交付 / 跟进 / 两者都看」开关（useMemo 依赖里连 modeScope 都没有）；
        ③ 结果是咨询顾问视角下出现「0 个进行中项目、共 0 个项目」却「3 个超期未完成任务」，
           那 3 个任务在跟进项目里，而列表正筛着交付项目 —— 点卡片也找不到对应项目。
      现在四张卡片同源：先按「与我相关 / 全公司」，再按「交付 / 跟进」，
      只有状态和搜索不跟（那两个跟了卡片就没意义了，筛"进行中"时"已完成"会变 0）。
    */
    const base = projects
      .filter(p => viewScope === 'all' || isMineProject(p))
      .filter(p => {
        if (modeScope === 'all') return true;
        const isFollowUp = resolveProjectCapabilities(p).isFollowUpProject;
        return modeScope === 'delivery' ? !isFollowUp : isFollowUp;
      });
    const active = base.filter(p => p.status === Status.Active);
    return {
      active: active.length,
      completed: base.filter(p => p.status === Status.Completed).length,
      stuck: active.filter(p => (p.tasks || []).some(t => isOverdueTask(t))).length,
      overdueTasks: base
        .filter(p => p.status !== Status.Completed)
        .reduce((sum, p) => sum + (p.tasks || []).filter(t => isOverdueTask(t)).length, 0)
    };
  }, [projects, viewScope, modeScope, currentUser.id, currentUser.name]);

  const filteredProjects = useMemo(() => projects
    .filter(p => {
      if (filterStatus === 'Active' && p.status === Status.Completed) return false;
      if (filterStatus === 'Completed' && p.status !== Status.Completed) return false;

      if (modeScope !== 'all') {
        const isFollowUp = resolveProjectCapabilities(p).isFollowUpProject;
        if (modeScope === 'delivery' && isFollowUp) return false;
        if (modeScope === 'followup' && !isFollowUp) return false;
      }

      /*
        项目列表对所有角色可见（只读），由「与我相关 / 全部项目」开关控制范围。
        原来对咨询师硬过滤成 OWN，把这个开关架空了——选「全部项目」也只显示自己的，
        而旁边的徽标却按全量算，同一屏两个口径。
        交付有依赖关系（体系认证做完才能开始申报），咨询师需要看得到别人的进度；
        真正的保护在动作权限（改任务/看金额），不在"看不见"。
      */
      if (viewScope === 'related' && !isMineProject(p)) return false;
      if (!matchesProjectFocus(p)) return false;

      const q = searchTerm.trim();
      if (!q) return true;
      return p.name.includes(q) || p.manager.includes(q);
    }), [projects, filterStatus, activeRole, viewScope, modeScope, searchTerm, dashboardFocus, currentUser.name, projectWorkLogs]);

  /** 金额与结算只给有 CONTRACT_VIEW_AMOUNT 的角色。咨询师刻意看不到，避免与客户议价、同事比价。 */
  const canSeeMoney = checkActionPermission('CONTRACT_VIEW_AMOUNT', {}).allowed;
  /**
   * 结算/提成可见性，与「能看合同金额」刻意分开：
   * 销售必须看得到自己谈的合同金额，但不该看到提成规则和结算对象——那是别人的收入。
   * 只给老板、系统管理员、财务。长期看结算应完全移到「顾问结算」页面。
   */
  const canSeeSettlement = checkActionPermission('SETTLEMENT_VIEW', {}).allowed;
  /** 确认到账是财务动作，项目详情里也必须按权限控制 */
  const canConfirmPayment = checkActionPermission('PAYMENT_CONFIRM', {}).allowed;

  /** AI 诊断只给管理角色：老板、系统管理员、交付负责人。咨询师是执行者，不需要。
   *  原来写死成角色数组，绕过了权限矩阵；改走权限码后体检脚本才管得到。 */
  const canSeeAiDiagnosis = checkActionPermission('PROJECT_AI_DIAGNOSE', {}).allowed;
  const canDeleteOthersLog = checkActionPermission('WORKLOG_DELETE_ANY', {}).allowed;

  /**
   * 项目该显示哪个客户。
   *
   * 原来列表行只看 project.customerId，详情顶部却会回退到合同上的客户——
   * 同一个项目，列表说「未关联客户」，展开后却显示客户名，自己跟自己矛盾。
   * 24 个项目里 16 个 customerId 为空，所以列表上几乎全是「未关联客户」。
   *
   * 三级回退：项目自己的客户 → 合同关联的客户 → 合同上的客户名（还没建客户档案时）。
   */
  const resolveProjectCustomerName = (project: Project): string => {
    const direct = project.customerId
      ? customers.find(c => c.id === project.customerId)
      : undefined;
    if (direct) return direct.name;

    const contract = contracts.find(c => c.id === project.contractRef || c.contractNo === project.contractRef);
    if (contract?.customerId) {
      const viaContract = customers.find(c => c.id === contract.customerId);
      if (viaContract) return viaContract.name;
    }
    // 合同上有客户名但还没建客户档案：显示名字比显示「未关联客户」有用得多
    if (contract?.customerName) return contract.customerName;
    return '未关联客户';
  };

  /**
   * 项目进度一律按任务算出来，不读 project.progress 字段。
   *
   * 那个字段和任务状态各写各的，库里 6 个项目是 progress=100% 但任务 0/5——
   * 手机端卡片直接画它，于是显示满格进度条、实际一个任务没做。
   * 表格列用的是「已完成/总数」，两套渲染口径不一致。
   * 结论：以任务为唯一事实来源，progress 字段不再参与展示。
   */
  /**
   * 跳过一条任务：改状态 + 记原因 + 写业务事件流。
   *
   * 事件流那一步是关键——「哪个任务在多少比例的项目里被跳过」
   * 只能从事件里统计出来，任务本身被改状态后就查不到历史了。
   * 事件写失败不影响跳过本身（后端 record 内部吞异常）。
   */
  /** 正在走完结清单的项目（有未完成任务时才弹） */
  const [completing, setCompleting] = useState<{ project: Project; pending: ProjectTask[] } | null>(null);

  /** 真正执行完结。清单里的决定先落地，再完结项目 */
  const doCompleteProject = async (
    project: Project,
    decisions: Array<{ task: ProjectTask; action: 'complete' | 'skip'; reason?: TaskSkipReason }> = []
  ) => {
    for (const d of decisions) {
      if (d.action === 'complete') {
        updateProjectTask(project.id, d.task.id, { status: 'Completed' });
      } else if (d.reason) {
        skipProjectTask(project, d.task, d.reason);
      }
    }
    const res = await completeProject(project.id, { source: 'manual' });
    if (!res.ok) { alert(res.reason || '操作失败'); return; }
    if (res.eventId) {
      setUndoComplete({ projectId: project.id, eventId: res.eventId, expiresAt: Date.now() + 30_000 });
    }
  };

  const skipProjectTask = (project: Project, task: ProjectTask, reason: TaskSkipReason, note?: string) => {
    updateProjectTask(project.id, task.id, { status: 'Skipped', skipReason: reason, skipNote: note });
    void fetch('/api/business-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        eventType: 'task.skipped',
        subjectType: 'project',
        subjectId: project.id,
        summary: `跳过任务「${task.title}」`,
        reason: note ? `${TASK_SKIP_REASON_LABEL[reason]}：${note}` : TASK_SKIP_REASON_LABEL[reason],
        detail: { taskId: task.id, taskTitle: task.title, skipReason: reason, skipNote: note, serviceItemId: task.serviceItemId },
      }),
    }).catch(() => { /* 打点失败不该打断用户操作 */ });
  };

  const taskProgress = (project: Project) => {
    const all = project.tasks || [];
    // 已跳过的不进分母，否则跳过一个任务后进度永远到不了 100%
    const counted = all.filter(t => t.status !== 'Skipped');
    const done = counted.filter(t => t.status === 'Completed').length;
    const skipped = all.length - counted.length;
    return {
      done,
      total: counted.length,
      skipped,
      pct: counted.length ? Math.round((done / counted.length) * 100) : 0,
    };
  };

  /** 项目的下一步：最近截止的未完成任务。列表里给"该做什么"，比给进度百分比有用。 */
  const getNextTask = (project: Project): ProjectTask | null => {
    const open = (project.tasks || []).filter(t => t.status !== 'Completed');
    if (open.length === 0) return null;
    return open.slice().sort((a, b) => {
      const at = new Date(String(a.deadline || '2099-12-31')).getTime();
      const bt = new Date(String(b.deadline || '2099-12-31')).getTime();
      return (Number.isFinite(at) ? at : 4102416000000) - (Number.isFinite(bt) ? bt : 4102416000000);
    })[0];
  };

  const getStatusBadge = (status: Status) => <StatusBadge status={status} domain="project" />;

  const getCategoryBadge = (category: any) => (
    <Badge tone={category === 'FollowUp' ? 'amber' : 'indigo'}>{category === 'FollowUp' ? '跟进项目' : '交付项目'}</Badge>
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const manager = String(formData.manager || '').trim();
    if (!manager) {
        alert("必须指定执行负责人！");
        return;
    }
    if (!isValidManager(manager)) {
      alert('执行负责人请从列表选择（或选择“待指派”）。');
      return;
    }
    const customerId = String(formData.customerId || '').trim();
    if (!customerId) {
      alert('请选择归属客户。不关联客户的项目在客户档案里看不到，也无法统计合作次数与金额。');
      return;
    }
    // 负责人同时写入用户 ID，保证「我的项目」和数据权限按身份而不是姓名判断
    const ownerUserId = userProfiles.find(u => u.name === manager)?.id;
    addProject({ ...formData, manager, customerId, ...(ownerUserId ? { ownerUserId } : {}) });
    setIsModalOpen(false);
  };

  const getWorkLogDraft = (projectId: string) => workLogDrafts[projectId] || defaultWorkLogDraft();
  const patchWorkLogDraft = (projectId: string, patch: Partial<ReturnType<typeof defaultWorkLogDraft>>) => {
    setWorkLogDrafts(prev => ({ ...prev, [projectId]: { ...getWorkLogDraft(projectId), ...patch } }));
  };
  const resetWorkLogDraft = (projectId: string) => {
    setWorkLogDrafts(prev => ({ ...prev, [projectId]: defaultWorkLogDraft() }));
  };
  const getTaskName = (tasks: ProjectTask[], taskId?: string) => {
    if (!taskId) return '';
    return tasks.find(t => t.id === taskId)?.title || '';
  };
  const getServiceName = (project: Project, serviceItemId?: string) => {
    const serviceItems = Array.isArray(project.serviceItems) ? project.serviceItems : [];
    if (!serviceItemId) return '';
    return serviceItems.find(s => s.id === serviceItemId)?.name || '';
  };

  const renderProjectDetail = (project: Project) => {
    const projectCaps = resolveProjectCapabilities(project);
    const isFollowUpProject = projectCaps.isFollowUpProject;
    const isIntelFollowUpProject = projectCaps.isIntelOrigin && projectCaps.isFollowUpProject;
    const sourceSignalId = isIntelFollowUpProject ? projectCaps.sourceRef : '';
    const sourceSignal = sourceSignalId ? marketSignals.find(s => s.id === sourceSignalId) : undefined;
    const selectedCustomerId = followUpCustomerBinding[project.id] || project.customerId || '';
    const linkedContract = contracts.find(c => c.id === project.contractRef || c.contractNo === project.contractRef);
    const linkedCustomer = selectedCustomerId
      ? customers.find(customer => customer.id === selectedCustomerId)
      : linkedContract?.customerId
        ? customers.find(customer => customer.id === linkedContract.customerId)
        : undefined;
    const projectAuditIssues = auditIssues
      .filter(issue => {
        if (issue.projectId) return issue.projectId === project.id;
        if (issue.contractId && linkedContract?.id) return issue.contractId === linkedContract.id;
        if (issue.contractRef) return issue.contractRef === linkedContract?.id || issue.contractRef === linkedContract?.contractNo;
        return false;
      })
      .sort((a, b) => {
        const statusRank = (issue: typeof a) => issue.status === 'Closed' ? 1 : 0;
        const statusDiff = statusRank(a) - statusRank(b);
        if (statusDiff !== 0) return statusDiff;
        return String(b.deadline || b.createDate || '').localeCompare(String(a.deadline || a.createDate || ''));
      });
    const receivables = linkedContract?.receivables || [];
    const contractIdForReceivables = linkedContract?.id;
    const projectAmount = Number.isFinite(Number(project.projectAmount)) ? Number(project.projectAmount) : 0;
    const paidAmount = receivables
      .filter(r => r.status === 'paid')
      .reduce((sum, r) => sum + (Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0), 0);
    const paymentProgress = projectAmount > 0 ? Math.min(100, Math.round((paidAmount / projectAmount) * 100)) : 0;
    const remainingAmount = projectAmount > 0 ? Math.max(0, projectAmount - paidAmount) : 0;
    const isOverPaid = projectAmount > 0 && paidAmount > projectAmount;
    const serviceItems = Array.isArray(project.serviceItems) ? project.serviceItems : [];
    const today = new Date();
    const canAssign = checkActionPermission('PROJECT_ASSIGN_MANAGER', project).allowed;
    const activeServiceDraft = serviceDraft?.projectId === project.id ? serviceDraft : null;
    const matchedService = activeServiceDraft ? matchServiceCatalog(activeServiceDraft.rawName, activeServiceDraft.category) : null;
    const resolvedCategory = matchedService?.category || (activeServiceDraft?.category || undefined);
    const resolvedDelivery = matchedService?.deliveryMode || (resolvedCategory ? SERVICE_CATEGORY_DELIVERY_MODE[resolvedCategory] : undefined);
    const serviceDatalistId = `service-catalog-${project.id}`;
    const catalogOptions = SERVICE_CATALOG.filter(item => !activeServiceDraft?.category || item.category === activeServiceDraft.category);
    const allTasks = project.tasks || [];
    const unassignedTasks = allTasks.filter(t => !t.serviceItemId);
    const groupedTasks = serviceItems.map(si => ({
      service: si,
      tasks: allTasks.filter(t => t.serviceItemId === si.id)
    })).filter(group => group.tasks.length > 0);
    const draft = getWorkLogDraft(project.id);
    const canWriteStructuredLog = serviceItems.length > 0 || allTasks.length > 0;
    const projectLogs = projectWorkLogs
      .filter(log => log.projectId === project.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const weekStart = (() => {
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diff);
      monday.setHours(0, 0, 0, 0);
      return monday.getTime();
    })();
    const weekLogs = projectLogs.filter(log => new Date(log.logDate).getTime() >= weekStart);
    const weekTotalHours = weekLogs.reduce((sum, log) => sum + Number(log.actualHours || 0), 0);
    const weekContributors = Array.from(new Set(weekLogs.map(log => log.operatorName).filter(Boolean)));
    const weekByUser = weekLogs.reduce<Record<string, { hours: number; count: number }>>((acc, log) => {
      const key = log.operatorName || '未知';
      if (!acc[key]) acc[key] = { hours: 0, count: 0 };
      acc[key].hours += Number(log.actualHours || 0);
      acc[key].count += 1;
      return acc;
    }, {});

    const submitWorkLog = () => {
      if (!canWriteStructuredLog) {
        alert('请先建立服务项或任务，再录入日志。');
        return;
      }
      const task = draft.taskId ? allTasks.find(t => t.id === draft.taskId) : undefined;
      const serviceItemId = draft.serviceItemId || task?.serviceItemId || '';
      const res = addProjectWorkLog({
        projectId: project.id,
        serviceItemId: serviceItemId || undefined,
        taskId: draft.taskId || undefined,
        logDate: draft.logDate,
        workContent: draft.workContent,
        actualHours: Number(draft.actualHours || 0),
        issueNote: draft.issueNote,
        nextPlan: draft.nextPlan
      });
      if (!res.ok) {
        alert(res.reason || '日志保存失败');
        return;
      }
      resetWorkLogDraft(project.id);
    };

    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-6 animate-in slide-in-from-top duration-300">
        {/*
          顶部信息条：详情展开后内容很长，滚到下面容易忘了在看哪个项目。
          这一条钉住关键身份信息（项目 / 客户 / 负责人 / 下一步 / 截止），滚动时始终可见。
        */}
        <div className="order-first sticky top-0 z-10 -mx-6 -mt-6 mb-0 px-6 py-3 bg-white/95 backdrop-blur border-b border-gray-100 rounded-t-2xl">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-gray-900 truncate">{project.name}</div>
              <div className="text-[11px] text-gray-500 truncate">
                {linkedCustomer?.name || resolveProjectCustomerName(project)}　·　负责人 {project.manager || '待指派'}
              </div>
            </div>
            {(() => {
              const next = getNextTask(project);
              if (!next) return <Badge tone="emerald">任务已全部完成</Badge>;
              const canComplete = checkActionPermission('TASK_COMPLETE', project).allowed;
              return (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-gray-400">下一步</span>
                  {/* 就地完成：看到下一步就能勾掉，不用滚到下面的任务看板 */}
                  {canComplete && (
                    <button
                      type="button"
                      title={`标记完成：${next.title}`}
                      onClick={() => updateProjectTask(project.id, next.id, { status: 'Completed' })}
                      className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all hover:scale-110 ${
                        isOverdueTask(next) ? 'border-red-300 hover:border-red-500 hover:bg-red-50' : 'border-gray-300 hover:border-emerald-500 hover:bg-emerald-50'
                      }`}
                    />
                  )}
                  <span className="text-xs font-bold text-gray-800 max-w-[220px] truncate">{next.title}</span>
                  {isOverdueTask(next) && <Badge tone="red">已超期</Badge>}
                </div>
              );
            })()}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono text-gray-400">{project.deadline}</span>
              {getStatusBadge(project.status)}
            </div>
          </div>
        </div>

        {canAssign && (
          <div className="order-last flex justify-end pt-2 border-t border-gray-50">
            <button
              onClick={() => {
                setAssignProjectId(project.id);
                // 优先用已存的 ownerUserId 回填，其次按姓名匹配（兼容旧数据）
                const current = userProfiles.find(u => u.id === String((project as any).ownerUserId || ''))
                  || userProfiles.find(u => u.name === project.manager);
                setAssignOwnerUserId(current?.id || '');
                setAssignManager(current?.name || '');
                setIsAssignModalOpen(true);
              }}
              className="px-3 py-2 text-xs font-black bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50"
            >
              指派负责人
            </button>
          </div>
        )}

        {/*
          AI 深度诊断：管理动作，不是执行动作。
          咨询师在一线，项目什么情况他自己清楚，不需要 AI 告诉他；老板和交付负责人
          不在一线才需要 AI 扫一遍。所以只对管理角色显示，顺带省 token。
          没有诊断结果时收成一行按钮，不常驻占一屏。
        */}
        {!isIntelFollowUpProject && canSeeAiDiagnosis && !project.aiInsight && (
          <div className="order-7 flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/40 px-5 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="text-sm font-bold text-indigo-900">AI 项目诊断</span>
              <span className="text-xs text-indigo-500/80 truncate">按需运行，分析进度风险与卡点</span>
            </div>
            <button
              onClick={() => runProjectDiagnosis(project.id)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 text-xs font-black hover:bg-indigo-50 transition-colors"
            >
              开始诊断
            </button>
          </div>
        )}

        {!isIntelFollowUpProject && canSeeAiDiagnosis && project.aiInsight && (
        <div className="order-7 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl border border-indigo-100 p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10"><Brain className="w-24 h-24 text-indigo-600" /></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="text-lg font-black text-indigo-900 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600" />
                            AI 项目大脑
                        </h3>
                        <p className="text-xs text-indigo-600/70 font-bold mt-1">基于实时数据的智能诊断与决策中枢</p>
                    </div>
                    <button 
                        onClick={() => runProjectDiagnosis(project.id)}
                        className="bg-white/80 hover:bg-white text-indigo-700 px-4 py-2 rounded-xl text-xs font-black shadow-sm border border-indigo-100 transition-all flex items-center gap-2"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        立即深度诊断
                    </button>
                </div>

                {project.aiInsight ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase ${
                                project.aiInsight.riskLevel === 'High' ? 'bg-red-100 text-red-700' :
                                project.aiInsight.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                'bg-green-100 text-green-700'
                            }`}>
                                风险等级: {project.aiInsight.riskLevel}
                            </span>
                            <span className="text-xs text-gray-400 font-mono">
                                上次分析: {new Date(project.aiInsight.lastAnalysisTime).toLocaleString()}
                            </span>
                        </div>
                        <div className="bg-white/60 rounded-xl p-4 border border-indigo-50/50">
                            <p className="text-sm text-gray-700 leading-relaxed font-medium">
                                {project.aiInsight.summary}
                            </p>
                        </div>
                        
                        {(() => {
                            const lastLog = aiDecisionLogs.find(l => l.projectId === project.id && l.timestamp === project.aiInsight?.lastAnalysisTime);
                            if (lastLog?.suggestedActions?.length) {
                                return (
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">AI 建议执行</p>
                                        <div className="grid gap-2">
                                            {lastLog.suggestedActions.map((action, idx) => (
                                                <div key={idx} className="flex items-center justify-between bg-white p-3 rounded-lg border border-indigo-50 shadow-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${
                                                            action.type === 'ADD_REMINDER' ? 'bg-amber-500' : 'bg-blue-500'
                                                        }`} />
                                                        <span className="text-xs font-bold text-gray-700">
                                                            {action.type === 'ADD_REMINDER' ? '添加风险预警' : 
                                                             action.type === 'SUGGEST_TASK' ? '补充任务' : action.type}
                                                        </span>
                                                        <span className="text-xs text-gray-500 border-l pl-2 ml-2">
                                                            {action.reason}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            }
                            return null;
                        })()}
                    </div>
                ) : (
                    <p className="text-xs text-indigo-400 font-medium">还没有诊断记录，点右上角「立即深度诊断」开始分析。</p>
                )}
            </div>
        </div>
        )}

        {isIntelFollowUpProject && (
          <div className="order-1 bg-amber-50/70 rounded-2xl border border-amber-100 p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-amber-900">情报/跟进闭环面板</h3>
                <p className="text-xs text-amber-700 font-bold mt-1">
                  跟进项目默认不进入财务结算与回款，签约后请在合同管理录入合同并自动立项为交付项目。
                </p>
              </div>
              <div className="flex items-center gap-2">
                {project.status !== Status.Completed && (
                  <button
                    onClick={async () => {
                      const res = await completeProject(project.id, { source: 'manual' });
                      if (!res.ok) {
                        alert(res.reason || '操作失败');
                        return;
                      }
                    }}
                    className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-black hover:bg-amber-700"
                  >
                    标记跟进完成
                  </button>
                )}
                {project.status === Status.Completed && (
                  <button
                    onClick={() => {
                      const res = reopenProject(project.id);
                      if (!res.ok) {
                        alert(res.reason || '操作失败');
                      }
                    }}
                    className="px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-xl text-xs font-black hover:bg-amber-50"
                  >
                    重新打开
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-amber-100 p-4 space-y-3">
              <p className="text-xs font-bold text-gray-600">
                来源情报：{sourceSignal?.title || '未找到来源信号'} {sourceSignal?.publishedAt ? `（${sourceSignal.publishedAt}）` : ''}
              </p>
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <button
                  onClick={() => {
                    const res = convertIntelProjectToLead(project.id);
                    if (!res.ok) {
                      alert(res.reason || '转线索失败');
                      return;
                    }
                    alert('已转为线索跟进，可在客户经营 > 线索管理继续完善。');
                    navigate('/leads');
                  }}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
                >
                  转为线索
                </button>
                <div className="flex items-center gap-2 flex-1">
                  <select
                    value={selectedCustomerId}
                    onChange={e => setFollowUpCustomerBinding(prev => ({ ...prev, [project.id]: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  >
                    <option value="">选择要绑定的客户</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (!selectedCustomerId) {
                        alert('请先选择客户');
                        return;
                      }
                      const res = bindFollowUpProjectToCustomer(project.id, selectedCustomerId);
                      if (!res.ok) {
                        alert(res.reason || '绑定失败');
                        return;
                      }
                      alert('已绑定客户。签约后请在合同管理录入合同并自动立项交付项目。');
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 whitespace-nowrap"
                  >
                    绑定客户
                  </button>
                </div>
                <button
                  onClick={() => navigate('/contracts')}
                  className="px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-xl text-xs font-black hover:bg-indigo-50"
                >
                  去合同管理立项
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 核心保全：项目结算中心 & 费用信息区块 (T-002) */}
        {projectCaps.showFinancePanel && canSeeMoney && (
        <div className="order-6 bg-gray-50/50 rounded-2xl border border-gray-100 p-4 md:p-6 space-y-6">
          
          {/* T-002: 费用信息区块 (Hard Patch) */}
          {project.status === Status.Active && (
             <div className="bg-white p-5 rounded-xl border border-amber-100 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                    <DollarSign className="w-24 h-24 text-amber-500" />
                </div>
                <div className="relative z-10 flex justify-between items-center">
                    <div>
                        <h4 className="font-black text-gray-900 flex items-center gap-2">
                            <Wallet className="w-5 h-5 text-amber-600" />
                            项目合同金额
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                                project.costStatus === '已确认' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                                {project.costStatus || '待补全'}
                            </span>
                        </h4>
                        <p className="text-xs text-gray-400 mt-1 font-bold">
                            {project.costStatus === '已确认' 
                                ? '金额已锁定，可进行项目结算与完结。' 
                                : '⚠️ 必须补录金额并确认后，才允许项目完结。'}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-black font-mono text-gray-900">
                            ¥{(project.projectAmount || 0).toLocaleString()}
                        </div>
                        <button 
                            onClick={() => {
                                setCostEditingId(project.id);
                                setCostEditingAmount(project.projectAmount || 0);
                                setIsCostModalOpen(true);
                            }}
                            className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 underline decoration-indigo-200 underline-offset-4"
                        >
                            {project.projectAmount ? '修改金额' : '补录金额'}
                        </button>
                        {project.status === Status.Active && projectAmount <= 0 && (linkedContract?.amount || 0) > 0 && (
                          <button
                            onClick={() => {
                              if (!confirm(`将合同金额 ¥${linkedContract!.amount.toLocaleString()} 带入为项目合同金额，并锁定为“已确认”？`)) return;
                              const res = updateProjectCost(project.id, linkedContract!.amount);
                              if (!res.ok) alert(res.reason || '操作失败');
                            }}
                            className="block mt-1 text-[11px] font-bold text-gray-500 hover:text-gray-700 underline decoration-gray-200 underline-offset-4"
                          >
                            一键带入合同金额 ¥{linkedContract!.amount.toLocaleString()}
                          </button>
                        )}
                    </div>
                </div>
             </div>
          )}

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-t border-gray-100 pt-6">
            {/* 标题跟着实际内容走：看不到结算的人，这块其实是「回款 + 完结」，叫结算中心名不副实 */}
            <h3 className="font-black text-gray-900 flex items-center">
              <Briefcase className="w-5 h-5 mr-2" /> {canSeeSettlement ? '项目结算中心' : '回款与完结'}
            </h3>
            <div className="flex gap-2 w-full md:w-auto">
              {project.status !== Status.Completed && (
                <button onClick={async () => {
                  /*
                    有未完成任务时先弹清单逐条交代，没有就直接完结。
                    原来是一个 confirm() 什么都不问——项目关了，未完成任务永远挂着，
                    也没人知道为什么没做。
                  */
                  const pending = (project.tasks || []).filter(t => t.status === 'Pending');
                  if (pending.length > 0) { setCompleting({ project, pending }); return; }
                  await doCompleteProject(project);
                }} className="w-full md:w-auto bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center hover:bg-blue-700 transition-all active:scale-95 shadow-md shadow-blue-200">
                  <CheckCircle className="w-4 h-4 mr-1.5" /> 标记完成
                </button>
              )}
              {canSeeSettlement && (
                <button className="w-full md:w-auto bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center hover:bg-green-700 transition-all active:scale-95 shadow-md shadow-green-200">
                  <PlayCircle className="w-4 h-4 mr-1.5" /> 发起结算
                </button>
              )}
            </div>
          </div>
          
          {project.completionRecord && (
            <div className="bg-white p-5 rounded-xl border border-blue-100 shadow-sm mb-6 relative overflow-hidden">
               <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                 <ShieldCheck className="w-32 h-32 text-blue-600" />
               </div>
               <div className="flex items-center justify-between mb-4 relative z-10">
                 <h4 className="font-black text-gray-900 flex items-center">
                   <ShieldCheck className="w-5 h-5 mr-2 text-blue-600" /> 项目完成记录
                   <span className={`ml-3 px-2 py-0.5 rounded text-xs font-bold ${project.completionRecord.rating === 'S' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>评级: {project.completionRecord.rating}</span>
                 </h4>
                 <button
                   onClick={() => {
                     if (!confirm('确定要重新打开该项目吗？系统将回滚本次完成事件产生的提醒与客户状态更新。')) return;
                     const res = reopenProject(project.id);
                     if (!res.ok) { alert(res.reason || '操作失败'); return; }
                     setUndoComplete(null);
                   }}
                   className="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
                 >
                   重新打开项目
                 </button>
               </div>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm relative z-10">
                 <div>
                   <p className="text-gray-400 text-xs font-bold mb-1">实际完成日</p>
                   <p className="font-mono font-bold text-gray-900">{project.completionRecord.actualEndDate}</p>
                 </div>
                 <div>
                   <p className="text-gray-400 text-xs font-bold mb-1">实际周期</p>
                   <p className="font-mono font-bold text-gray-900">{project.completionRecord.duration} 天</p>
                 </div>
                 <div>
                   <p className="text-gray-400 text-xs font-bold mb-1">一次通过</p>
                   <p className={`font-bold ${project.completionRecord.passRate ? 'text-green-600' : 'text-amber-600'}`}>{project.completionRecord.passRate ? '是' : '否'}</p>
                 </div>
                 <div>
                   <p className="text-gray-400 text-xs font-bold mb-1">延期任务</p>
                   <p className={`font-mono font-bold ${project.completionRecord.delayedTasksCount === 0 ? 'text-green-600' : 'text-red-600'}`}>{project.completionRecord.delayedTasksCount}</p>
                 </div>
               </div>
            </div>
          )}
          {/*
            没有结算权限时不渲染结算栏，回款明细直接占满整行。
            原来是留一个虚线空框写「结算信息仅财务和管理员可见」——
            用半个版面说一句读者做不了任何事的话，纯属浪费；看不到的东西不该占位。
          */}
          <div className={`grid grid-cols-1 gap-8 ${canSeeSettlement ? 'lg:grid-cols-2' : ''}`}>
             {canSeeSettlement && (
             <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex justify-between text-sm"> <span className="text-gray-400 font-bold">结算对象:</span> <span className="font-bold text-gray-900">{project.manager}</span> </div>
                <div className="flex justify-between text-sm"> <span className="text-gray-400 font-bold">规则类型:</span> <span className="font-bold text-gray-900">按回款比例提成</span> </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-50"> <span className="text-sm text-gray-400 font-bold">预估金额:</span> <span className="text-lg font-black text-indigo-600 font-mono">10%</span> </div>
                <p className="text-[10px] text-gray-300 italic">* 提示：点击发起结算即可生成应付单。</p>
             </div>
             )}
             <div className="space-y-3">
                {/* 原文是「回款明细（从）」，「（从）」是历史提交遗留的残字，无实义 */}
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">回款明细</p>

                {receivables.length > 0 && projectAmount <= 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                    <p className="text-xs font-bold text-amber-800 leading-relaxed">
                      已存在回款记录，请先补录项目合同金额（总账），再进行项目完结与结算。
                    </p>
                  </div>
                )}

                {projectAmount > 0 ? (
                  <div className={`bg-white rounded-xl border shadow-sm p-4 ${isOverPaid ? 'border-red-200' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-gray-600">回款进度</span>
                      <span className={`text-xs font-black font-mono ${isOverPaid ? 'text-red-600' : 'text-indigo-600'}`}>
                        {paymentProgress}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all ${isOverPaid ? 'bg-red-500' : 'bg-indigo-600'}`}
                        style={{ width: `${paymentProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center mt-2 text-[11px]">
                      <span className="text-gray-500 font-bold">已回款</span>
                      <span className="font-mono font-black text-gray-900">¥{paidAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1 text-[11px]">
                      <span className="text-gray-500 font-bold">剩余</span>
                      <span className="font-mono font-black text-gray-900">¥{remainingAmount.toLocaleString()}</span>
                    </div>
                    {isOverPaid && (
                      <div className="mt-2 bg-red-50 border border-red-100 rounded-lg p-2">
                        <p className="text-[11px] font-bold text-red-700">
                          回款合计已超过合同金额，请核对合同金额或回款节点是否重复。
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-bold text-gray-500">
                      未补录项目合同金额，无法计算回款进度。
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  {receivables.map(r => (
                    <div key={r.id} className="flex justify-between items-center p-3 bg-white rounded-xl border border-gray-100 shadow-sm group">
                      <div>
                        <p className="text-xs font-bold text-gray-900">{r.node}</p>
                        <p className="text-[10px] text-gray-400 font-mono">{r.dueDate}</p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="font-mono font-black text-sm">¥{r.amount.toLocaleString()}</span>
                        {/*
                          确认到账是财务动作，之前这里完全没有权限门，任何进得来项目详情的人都能点。
                          现在：只有有 PAYMENT_CONFIRM 的人能确认；其他人只能「报备已收款」推给财务核对。
                        */}
                        {r.status === 'paid' ? (
                          <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-full uppercase">已到账</span>
                        ) : canConfirmPayment ? (
                          <button
                            disabled={!contractIdForReceivables}
                            onClick={() => contractIdForReceivables && toggleReceivableStatus(contractIdForReceivables, r.id)}
                            className={`text-[10px] font-black px-3 py-1 rounded-full transition-all ${
                              contractIdForReceivables
                                ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-600 hover:text-white'
                                : 'text-gray-300 bg-gray-50 cursor-not-allowed'
                            }`}
                          >
                            确认到账
                          </button>
                        ) : r.paymentClaim ? (
                          <Badge tone="amber">待财务核对</Badge>
                        ) : (
                          <button
                            disabled={!contractIdForReceivables}
                            onClick={() => {
                              if (!contractIdForReceivables) return;
                              const note = window.prompt(`报备「${r.node}」已收款，请财务核对。\n可填备注，也可留空：`, '');
                              if (note === null) return;
                              const res = claimReceivablePaid(contractIdForReceivables, r.id, note);
                              alert(res.ok ? '已通知财务核对。到账确认由财务完成。' : (res.reason || '报备失败'));
                            }}
                            /*
                              原来是 gray-100 灰底灰字，跟禁用态长得一样——
                              这是销售在这块唯一能做的动作，不能让人以为点不了。
                              用琥珀色描边区别于财务的「确认到账」（indigo 实心）：
                              颜色不同提示这不是终态确认，只是报备给财务。
                            */
                            className="text-[10px] font-black px-3 py-1 rounded-full border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-600 hover:text-white hover:border-amber-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            报备已收款
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {receivables.length === 0 && (
                    /* 回款节点来自合同，不在项目里维护。只写「暂无」等于让人干瞪眼，得指路 */
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                      <p className="text-xs font-bold text-gray-500">暂无回款节点</p>
                      <p className="text-[11px] text-gray-400 mt-1 leading-5">
                        {contractIdForReceivables
                          ? '回款节点在关联合同里维护，到「合同管理」打开该合同添加后，这里会自动同步。'
                          : '该项目还没关联合同，关联后才能同步回款节点。'}
                      </p>
                    </div>
                  )}
                </div>
             </div>
          </div>
        </div>
        )}

        {projectCaps.showServicePanel && (
        <div className="order-3 bg-gray-50/50 rounded-2xl border border-gray-100 p-4 md:p-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
            <h3 className="font-black text-gray-900 flex items-center"> <LayoutGrid className="w-5 h-5 mr-2 text-indigo-600" /> 服务清单（项目可承载多服务） </h3>
            <div className="flex items-center gap-2">
              {!activeServiceDraft && (
                <button
                  onClick={() => {
                    setServiceDraft({
                      projectId: project.id,
                      rawName: '',
                      category: '',
                      owner: project.manager,
                      autoTasks: true
                    });
                  }}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
                >
                  <Plus className="w-4 h-4 inline mr-1.5" />
                  添加服务项
                </button>
              )}
              {activeServiceDraft && (
                <button
                  onClick={() => setServiceDraft(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-black hover:bg-gray-200"
                >
                  取消
                </button>
              )}
            </div>
          </div>

          {activeServiceDraft && (
            <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6 shadow-sm space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">服务类目</label>
                  <select
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                    value={activeServiceDraft.category}
                    onChange={e => setServiceDraft(prev => prev ? { ...prev, category: e.target.value as ServiceCategory } : prev)}
                  >
                    <option value="">全部类目</option>
                    {SERVICE_CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">服务项目（可搜索）</label>
                  <input
                    list={serviceDatalistId}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                    value={activeServiceDraft.rawName}
                    onChange={e => setServiceDraft(prev => prev ? { ...prev, rawName: e.target.value } : prev)}
                    placeholder="如：ISO9001 / 高新技术企业 / SC 食品生产许可"
                  />
                  <datalist id={serviceDatalistId}>
                    {catalogOptions.map(item => (
                      <option key={item.id} value={item.name}>{item.category}</option>
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold">
                  {matchedService ? (
                    <span className="px-2 py-1 rounded-full bg-green-50 text-green-700">
                      已识别：{matchedService.name}（{resolvedDelivery === 'Self' ? '自营' : '合作'}）
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded-full bg-yellow-50 text-yellow-700">
                      未命中标准项，将按输入创建
                    </span>
                  )}
                  {resolvedCategory && (
                    <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">{resolvedCategory}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center text-xs font-bold text-gray-600 gap-2">
                    <input
                      type="checkbox"
                      checked={activeServiceDraft.autoTasks}
                      onChange={e => setServiceDraft(prev => prev ? { ...prev, autoTasks: e.target.checked } : prev)}
                    />
                    自动生成交付任务
                  </label>
                  <select
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                    value={activeServiceDraft.owner}
                    onChange={e => setServiceDraft(prev => prev ? { ...prev, owner: e.target.value } : prev)}
                  >
                    {userProfiles.filter(u => u.id !== 'AI-WORKER').map(u => (
                      <option key={u.id} value={u.name}>{u.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const rawName = activeServiceDraft.rawName.trim();
                      if (!rawName) return;
                      const match = matchServiceCatalog(rawName, activeServiceDraft.category);
                      const standardName = match?.name || rawName;
                      const rawNameStored = match && match.name !== rawName ? rawName : undefined;
                      const category = match?.category || (activeServiceDraft.category || undefined);
                      const deliveryMode = match?.deliveryMode || (category ? SERVICE_CATEGORY_DELIVERY_MODE[category] : undefined);
                      const workflowTemplateId = activeServiceDraft.autoTasks ? (match?.workflowTemplateId || (category ? DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY[category] : undefined)) : undefined;
                      addProjectServiceItem(project.id, {
                        name: standardName,
                        owner: activeServiceDraft.owner || project.manager,
                        status: 'Pending' as any,
                        catalogId: match?.id,
                        standardName: match?.name,
                        rawName: rawNameStored,
                        category,
                        deliveryMode,
                        workflowTemplateId,
                        autoGenerateTasks: activeServiceDraft.autoTasks
                      });
                      setServiceDraft(null);
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700"
                  >
                    确认添加
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {serviceItems.map(si => (
              <div key={si.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      className="w-full bg-transparent font-black text-sm text-gray-900 outline-none"
                      value={si.name}
                      onChange={e => updateProjectServiceItem(project.id, si.id, { name: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                      {si.deliveryMode && (
                        <span className={`px-2 py-0.5 rounded-full ${si.deliveryMode === 'Self' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                          {si.deliveryMode === 'Self' ? '自营' : '合作'}
                        </span>
                      )}
                      {si.category && (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{si.category}</span>
                      )}
                      {si.standardName && (
                        <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-600">标准项</span>
                      )}
                    </div>
                    {si.rawName && si.rawName !== si.name && (
                      <div className="text-[10px] text-gray-400">原始输入：{si.rawName}</div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!confirm(`确认删除服务项「${si.name}」？关联任务将自动取消归属。`)) return;
                      deleteProjectServiceItem(project.id, si.id);
                    }}
                    className="text-gray-300 hover:text-red-500 transition-colors p-1"
                    title="删除服务项"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                    value={si.status}
                    onChange={e => updateProjectServiceItem(project.id, si.id, { status: e.target.value as any })}
                  >
                    <option value="Pending">未开始</option>
                    <option value="InProgress">进行中</option>
                    <option value="Completed">已完成</option>
                  </select>
                  <select
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                    value={si.owner || ''}
                    onChange={e => updateProjectServiceItem(project.id, si.id, { owner: e.target.value || undefined })}
                  >
                    <option value="">未指派</option>
                    {userProfiles.filter(u => u.id !== 'AI-WORKER').map(u => (
                      <option key={u.id} value={u.name}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <textarea
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none resize-none"
                  rows={2}
                  value={si.notes || ''}
                  onChange={e => updateProjectServiceItem(project.id, si.id, { notes: e.target.value })}
                  placeholder="备注/交付要点"
                />
              </div>
            ))}
            {serviceItems.length === 0 && (
              <div className="col-span-full py-12 text-center text-gray-300 border-2 border-dashed border-gray-200 rounded-3xl">
                <p className="text-sm font-bold">该项目暂无服务项，点击右上角“添加服务项”开始结构化管理</p>
              </div>
            )}
          </div>
        </div>
        )}

        {/* 没有不符合项时收成一行，不占版面 */}
        {projectAuditIssues.length === 0 ? (
        <div className="order-5 bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-gray-300 shrink-0" />
            <span className="text-sm font-bold text-gray-500">不符合项</span>
            <span className="text-xs text-gray-400 truncate">暂无，登记后会自动挂整改任务</span>
          </div>
          <button
            onClick={() => navigate('/audit')}
            className="text-xs font-bold text-gray-500 hover:text-gray-700 shrink-0"
          >
            进入审计中心 ›
          </button>
        </div>
        ) : (
        <div className="order-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="font-black text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                不符合项与整改任务
              </h3>
              <p className="text-xs text-gray-400 font-bold mt-1">
                {linkedCustomer?.name || '当前项目'}的质量问题会自动生成整改任务，并在这里集中回看。
              </p>
            </div>
            <button
              onClick={() => navigate('/audit')}
              className="px-3 py-1.5 bg-white text-amber-700 text-xs font-bold rounded-lg border border-amber-200 hover:bg-amber-50 transition-all shrink-0"
            >
              进入审计中心
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[10px] font-black text-gray-400 uppercase">问题总数</div>
              <div className="text-xl font-black text-gray-900">{projectAuditIssues.length}</div>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <div className="text-[10px] font-black text-red-500 uppercase">待闭环</div>
              <div className="text-xl font-black text-red-700">{projectAuditIssues.filter(issue => issue.status !== 'Closed').length}</div>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <div className="text-[10px] font-black text-amber-600 uppercase">重大问题</div>
              <div className="text-xl font-black text-amber-800">{projectAuditIssues.filter(issue => issue.severity === 'Major' && issue.status !== 'Closed').length}</div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
              <div className="text-[10px] font-black text-indigo-600 uppercase">已挂整改任务</div>
              <div className="text-xl font-black text-indigo-800">{projectAuditIssues.filter(issue => issue.rectificationTaskId).length}</div>
            </div>
          </div>

          <div className="space-y-2">
            {projectAuditIssues.slice(0, 5).map(issue => {
              const linkedTask = allTasks.find(task => task.id === issue.rectificationTaskId);
              const severityTone = issue.severity === 'Major'
                ? 'bg-red-50 text-red-700 border-red-100'
                : issue.severity === 'Minor'
                ? 'bg-amber-50 text-amber-700 border-amber-100'
                : 'bg-blue-50 text-blue-700 border-blue-100';
              const statusTone = issue.status === 'Closed'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-gray-50 text-gray-700 border-gray-200';
              return (
                <div key={issue.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-black px-2 py-1 rounded-full border ${severityTone}`}>{issue.severity}</span>
                        <span className={`text-[11px] font-black px-2 py-1 rounded-full border ${statusTone}`}>{issue.status}</span>
                        {linkedTask && <span className="text-[11px] font-black px-2 py-1 rounded-full border border-indigo-100 bg-indigo-50 text-indigo-700">任务：{linkedTask.status === 'Completed' ? '已完成' : '进行中'}</span>}
                      </div>
                      <div className="text-sm font-bold text-gray-900 mt-2 line-clamp-2">{issue.findings}</div>
                      <div className="text-[11px] text-gray-500 mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        <span>客户：{issue.customerName || linkedCustomer?.name || '-'}</span>
                        <span>整改截止：{issue.deadline || '-'}</span>
                        <span>整改任务：{linkedTask?.title || '待系统生成'}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('/audit', { state: { openDetailId: issue.id } })}
                      className="text-[11px] font-bold px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 shrink-0"
                    >
                      查看问题
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* 核心新增：交付任务看板 —— 详情里最重要的区块，排在最前 */}
        <div className="order-2 space-y-6">
           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="font-black text-gray-900 flex items-center"> <ListTodo className="w-5 h-5 mr-2 text-blue-600" /> {isFollowUpProject ? '跟进任务看板' : '交付任务流水线'} </h3>
              <div className="flex flex-wrap gap-2 w-full md:w-auto">
                 {serviceItems.length > 0 && (
                   <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                     <button
                       onClick={() => setTaskViewMode('grouped')}
                       className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${taskViewMode === 'grouped' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                     >
                       按服务分组
                     </button>
                     <button
                       onClick={() => setTaskViewMode('flat')}
                       className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${taskViewMode === 'flat' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                     >
                       平铺全部
                     </button>
                   </div>
                 )}
                 <button onClick={() => { setTemplateModalProjectId(project.id); setIsTemplateModalOpen(true); resetTemplateEditor(); }} className="px-3 py-1.5 bg-white text-gray-600 text-xs font-bold rounded-lg border border-gray-200 hover:bg-gray-50 transition-all flex items-center shrink-0">
                    <MoreHorizontal className="w-3.5 h-3.5 mr-1" /> 模板管理
                 </button>
                 <button onClick={() => addProjectTask(project.id, { title: '新任务', deadline: today.toISOString().split('T')[0], status: 'Pending', priority: 'Medium', category: 'Auxiliary', owner: project.manager })} className="p-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 shrink-0">
                    <Plus className="w-4 h-4" />
                 </button>
              </div>
           </div>

           <div className="space-y-4">
             {taskViewMode === 'grouped' && serviceItems.length > 0 && (
               <div className="space-y-4">
                 {groupedTasks.map(group => (
                   <div key={group.service.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                     <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                       <div className="flex items-center gap-2">
                         <span className="font-black text-gray-900">{group.service.name}</span>
                         {group.service.deliveryMode && (
                           <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${group.service.deliveryMode === 'Self' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                             {group.service.deliveryMode === 'Self' ? '自营' : '合作'}
                           </span>
                         )}
                         {group.service.category && (
                           <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{group.service.category}</span>
                         )}
                       </div>
                       <div className="text-xs text-gray-400 font-bold">任务 {group.tasks.length} 项</div>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {group.tasks.map(task => {
                         const isOverdue = new Date(task.deadline) < today && task.status !== 'Completed';
                         return (
                           <div key={task.id} className={`relative p-4 pb-4 rounded-2xl border transition-all hover:shadow-md group ${task.status === 'Skipped' ? 'bg-gray-50 border-gray-200 opacity-70' : task.status === 'Completed' ? 'bg-gray-50/50 border-gray-100' : isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                             <div className="flex justify-between items-start mb-3">
                               <button onClick={() => updateProjectTask(project.id, task.id, { status: task.status === 'Completed' ? 'Pending' : 'Completed' })}>
                                 {task.status === 'Completed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <div className={`w-5 h-5 rounded-full border-2 ${isOverdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
                               </button>
                               <div className="flex items-center gap-0.5">
                           <TaskSkipButton
                             task={task}
                             disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                             onSkip={(reason, note) => skipProjectTask(project, task, reason, note)}
                             onUndo={() => updateProjectTask(project.id, task.id, { status: 'Pending', skipReason: undefined, skipNote: undefined })}
                           />
                           <button onClick={() => deleteProjectTask(project.id, task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                         </div>
                             </div>
                             <input className={`w-full bg-transparent font-bold text-sm mb-2 focus:outline-none ${task.status === 'Completed' ? 'text-gray-400 line-through' : 'text-gray-900'}`} value={task.title} onChange={e => updateProjectTask(project.id, task.id, { title: e.target.value })} />
                             <div className="flex justify-between items-center">
                                <div className="flex items-center text-[10px] font-mono text-gray-400">
                                   <Timer className={`w-3 h-3 mr-1 ${isOverdue ? 'text-red-500' : ''}`} />
                                   <input type="date" className="bg-transparent focus:outline-none" value={task.deadline} onChange={e => updateProjectTask(project.id, task.id, { deadline: e.target.value })} />
                                </div>
                                <div className="flex items-center gap-2">
                                  {serviceItems.length > 0 && (
                                    <select
                                      className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                      value={task.serviceItemId || ''}
                                      onChange={e => updateProjectTask(project.id, task.id, { serviceItemId: e.target.value || undefined })}
                                    >
                                      <option value="">未归属</option>
                                      {serviceItems.map(si => (
                                        <option key={si.id} value={si.id}>{si.name}</option>
                                      ))}
                                    </select>
                                  )}
                                  <span
                                    className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                                      task.category === 'Core'
                                        ? 'bg-blue-100 text-blue-700'
                                        : task.category === 'ThirdParty'
                                        ? 'bg-amber-100 text-amber-700'
                                        : task.category === 'System'
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {task.category === 'Core'
                                      ? '核心'
                                      : task.category === 'ThirdParty'
                                      ? '合作'
                                      : task.category === 'System'
                                      ? '系统'
                                      : '辅助'}
                                  </span>
                                </div>
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   </div>
                 ))}

                 {unassignedTasks.length > 0 && (
                   <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                     <div className="flex items-center justify-between mb-3">
                       <div className="font-black text-gray-700">未归属任务</div>
                       <div className="text-xs text-gray-400 font-bold">任务 {unassignedTasks.length} 项</div>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {unassignedTasks.map(task => {
                         const isOverdue = new Date(task.deadline) < today && task.status !== 'Completed';
                         return (
                           <div key={task.id} className={`relative p-4 pb-4 rounded-2xl border transition-all hover:shadow-md group ${task.status === 'Skipped' ? 'bg-gray-50 border-gray-200 opacity-70' : task.status === 'Completed' ? 'bg-gray-50/50 border-gray-100' : isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                             <div className="flex justify-between items-start mb-3">
                               <button onClick={() => updateProjectTask(project.id, task.id, { status: task.status === 'Completed' ? 'Pending' : 'Completed' })}>
                                 {task.status === 'Completed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <div className={`w-5 h-5 rounded-full border-2 ${isOverdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
                               </button>
                               <div className="flex items-center gap-0.5">
                           <TaskSkipButton
                             task={task}
                             disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                             onSkip={(reason, note) => skipProjectTask(project, task, reason, note)}
                             onUndo={() => updateProjectTask(project.id, task.id, { status: 'Pending', skipReason: undefined, skipNote: undefined })}
                           />
                           <button onClick={() => deleteProjectTask(project.id, task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                         </div>
                             </div>
                             <input className={`w-full bg-transparent font-bold text-sm mb-2 focus:outline-none ${task.status === 'Completed' ? 'text-gray-400 line-through' : 'text-gray-900'}`} value={task.title} onChange={e => updateProjectTask(project.id, task.id, { title: e.target.value })} />
                             <div className="flex justify-between items-center">
                                <div className="flex items-center text-[10px] font-mono text-gray-400">
                                   <Timer className={`w-3 h-3 mr-1 ${isOverdue ? 'text-red-500' : ''}`} />
                                   <input type="date" className="bg-transparent focus:outline-none" value={task.deadline} onChange={e => updateProjectTask(project.id, task.id, { deadline: e.target.value })} />
                                </div>
                                <div className="flex items-center gap-2">
                                  {serviceItems.length > 0 && (
                                    <select
                                      className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                      value={task.serviceItemId || ''}
                                      onChange={e => updateProjectTask(project.id, task.id, { serviceItemId: e.target.value || undefined })}
                                    >
                                      <option value="">未归属</option>
                                      {serviceItems.map(si => (
                                        <option key={si.id} value={si.id}>{si.name}</option>
                                      ))}
                                    </select>
                                  )}
                                  <span
                                    className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                                      task.category === 'Core'
                                        ? 'bg-blue-100 text-blue-700'
                                        : task.category === 'ThirdParty'
                                        ? 'bg-amber-100 text-amber-700'
                                        : task.category === 'System'
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {task.category === 'Core'
                                      ? '核心'
                                      : task.category === 'ThirdParty'
                                      ? '合作'
                                      : task.category === 'System'
                                      ? '系统'
                                      : '辅助'}
                                  </span>
                                </div>
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   </div>
                 )}
               </div>
             )}

             {(taskViewMode === 'flat' || serviceItems.length === 0) && (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {allTasks.map(task => {
                   const isOverdue = new Date(task.deadline) < today && task.status !== 'Completed';
                   return (
                     <div key={task.id} className={`relative p-4 pb-4 rounded-2xl border transition-all hover:shadow-md group ${task.status === 'Skipped' ? 'bg-gray-50 border-gray-200 opacity-70' : task.status === 'Completed' ? 'bg-gray-50/50 border-gray-100' : isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                       <div className="flex justify-between items-start mb-3">
                         <button onClick={() => updateProjectTask(project.id, task.id, { status: task.status === 'Completed' ? 'Pending' : 'Completed' })}>
                           {task.status === 'Completed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <div className={`w-5 h-5 rounded-full border-2 ${isOverdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
                         </button>
                         <div className="flex items-center gap-0.5">
                           <TaskSkipButton
                             task={task}
                             disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                             onSkip={(reason, note) => skipProjectTask(project, task, reason, note)}
                             onUndo={() => updateProjectTask(project.id, task.id, { status: 'Pending', skipReason: undefined, skipNote: undefined })}
                           />
                           <button onClick={() => deleteProjectTask(project.id, task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                         </div>
                       </div>
                       <input className={`w-full bg-transparent font-bold text-sm mb-2 focus:outline-none ${task.status === 'Completed' ? 'text-gray-400 line-through' : 'text-gray-900'}`} value={task.title} onChange={e => updateProjectTask(project.id, task.id, { title: e.target.value })} />
                       <div className="flex justify-between items-center">
                          <div className="flex items-center text-[10px] font-mono text-gray-400">
                             <Timer className={`w-3 h-3 mr-1 ${isOverdue ? 'text-red-500' : ''}`} />
                             <input type="date" className="bg-transparent focus:outline-none" value={task.deadline} onChange={e => updateProjectTask(project.id, task.id, { deadline: e.target.value })} />
                          </div>
                          <div className="flex items-center gap-2">
                            {serviceItems.length > 0 && (
                              <select
                                className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                value={task.serviceItemId || ''}
                                onChange={e => updateProjectTask(project.id, task.id, { serviceItemId: e.target.value || undefined })}
                              >
                                <option value="">未归属</option>
                                {serviceItems.map(si => (
                                  <option key={si.id} value={si.id}>{si.name}</option>
                                ))}
                              </select>
                            )}
                            <span
                              className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                                task.category === 'Core'
                                  ? 'bg-blue-100 text-blue-700'
                                  : task.category === 'ThirdParty'
                                  ? 'bg-amber-100 text-amber-700'
                                  : task.category === 'System'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {task.category === 'Core'
                                ? '核心'
                                : task.category === 'ThirdParty'
                                ? '合作'
                                : task.category === 'System'
                                ? '系统'
                                : '辅助'}
                            </span>
                          </div>
                       </div>
                     </div>
                   );
                 })}
               </div>
             )}

             {allTasks.length === 0 && (
               <div className="col-span-full py-12 text-center text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">
                  <p className="text-sm font-bold">请点击上方“应用模版”或“+”开始建立任务流水线</p>
               </div>
             )}
           </div>
        </div>

        <div className="order-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="font-black text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-600" />
                工作日志（关联服务/任务）
              </h3>
              <p className="text-xs text-gray-400 font-bold mt-1">
                日志属于交付过程数据，不做字数考核；用于项目推进、卡点定位与复盘证据。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center min-w-[260px]">
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <div className="text-[10px] text-gray-400 font-black">本周日志</div>
                <div className="text-sm font-black text-gray-900">{weekLogs.length}</div>
              </div>
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <div className="text-[10px] text-gray-400 font-black">本周工时</div>
                <div className="text-sm font-black text-gray-900">{weekTotalHours.toFixed(1)}h</div>
              </div>
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <div className="text-[10px] text-gray-400 font-black">参与人数</div>
                <div className="text-sm font-black text-gray-900">{weekContributors.length}</div>
              </div>
            </div>
          </div>

          {!canWriteStructuredLog && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
              还没有服务项或任务，暂时不能记日志。先在上方创建任务，这里会自动打开。
            </div>
          )}

          {canWriteStructuredLog && (
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">日志日期</label>
                <input
                  type="date"
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  value={draft.logDate}
                  onChange={e => patchWorkLogDraft(project.id, { logDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">关联任务</label>
                <select
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  value={draft.taskId}
                  onChange={e => {
                    const taskId = e.target.value;
                    const selectedTask = allTasks.find(t => t.id === taskId);
                    patchWorkLogDraft(project.id, {
                      taskId,
                      serviceItemId: selectedTask?.serviceItemId || draft.serviceItemId
                    });
                  }}
                >
                  <option value="">请选择任务</option>
                  {allTasks.map(task => (
                    <option key={task.id} value={task.id}>
                      {task.title}（{task.status === TASK_STATUS.COMPLETED ? '已完成' : '进行中'}）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">关联服务</label>
                <select
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  value={draft.serviceItemId}
                  onChange={e => patchWorkLogDraft(project.id, { serviceItemId: e.target.value })}
                >
                  <option value="">请选择服务项</option>
                  {serviceItems.map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">实际耗时(h)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                  value={draft.actualHours}
                  onChange={e => patchWorkLogDraft(project.id, { actualHours: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <textarea
                className="md:col-span-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none resize-none"
                rows={3}
                value={draft.workContent}
                onChange={e => patchWorkLogDraft(project.id, { workContent: e.target.value })}
                placeholder="工作内容（必填）"
              />
              <textarea
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none resize-none"
                rows={3}
                value={draft.issueNote}
                onChange={e => patchWorkLogDraft(project.id, { issueNote: e.target.value })}
                placeholder="问题记录（可选）"
              />
            </div>
            {/* 「明日计划」是日报遗留：下一步该做什么应该体现在任务截止日期上，写在日志里没人看 */}
            <div className="flex items-center justify-end">
              <button
                onClick={submitWorkLog}
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:bg-gray-300"
                disabled={!canWriteStructuredLog}
              >
                提交日志
              </button>
            </div>
          </div>
          )}

          {Object.keys(weekByUser).length > 0 && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">本周按人汇总（弱绑定，仅作管理参考）</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {Object.entries(weekByUser).map(([name, stat]) => (
                  <div key={name} className="bg-white border border-gray-100 rounded-xl p-3">
                    <div className="text-xs font-black text-gray-900">{name}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">日志 {stat.count} 条 · 工时 {stat.hours.toFixed(1)}h</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {projectLogs.map((log: ProjectWorkLog) => {
              const taskName = getTaskName(allTasks, log.taskId);
              const serviceName = getServiceName(project, log.serviceItemId);
              // 删自己的日志一直允许；删别人的要 WORKLOG_DELETE_ANY。
              // 原来写死 ADMIN/MANAGER 数组，不在权限矩阵内。
              const canDelete = log.operatorUserId === currentUser.id || canDeleteOthersLog;
              return (
                <div key={log.id} className="bg-white border border-gray-100 rounded-2xl p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{log.logDate}</span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-600">{log.operatorName}</span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{Number(log.actualHours || 0).toFixed(1)}h</span>
                      <span className={`px-2 py-0.5 rounded-full ${log.source === WORK_LOG_SOURCE.TASK_TRANSITION ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        {log.source === WORK_LOG_SOURCE.TASK_TRANSITION ? '任务自动记录' : '手工记录'}
                      </span>
                      {taskName && <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">任务：{taskName}</span>}
                      {serviceName && <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700">服务：{serviceName}</span>}
                    </div>
                    {canDelete && (
                      <button
                        onClick={() => {
                          const res = deleteProjectWorkLog(log.id);
                          if (!res.ok) alert(res.reason || '删除失败');
                        }}
                        className="text-xs font-black text-gray-400 hover:text-red-500"
                      >
                        删除
                      </button>
                    )}
                  </div>
                  <div className="text-sm text-gray-800 font-bold mt-2 whitespace-pre-wrap">{log.workContent}</div>
                  {log.issueNote && <div className="text-xs text-amber-700 font-bold mt-2">问题：{log.issueNote}</div>}
                  {log.nextPlan && <div className="text-xs text-gray-500 font-bold mt-1">明日计划：{log.nextPlan}</div>}
                </div>
              );
            })}
            {projectLogs.length === 0 && (
              <div className="py-8 text-center text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">
                <p className="text-sm font-bold">暂无工作日志，建议从任务完成时开始沉淀执行记录</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">交付工作台</h1>
           <p className="text-sm text-gray-500 mt-1">下方数字跟随「与我相关 / 全公司」和「交付 / 跟进」，与列表口径一致（不跟状态和搜索）。点开项目勾任务推进。</p>
        </div>
        <button onClick={openCreateModal} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95 font-bold text-sm"><Plus className="w-4 h-4 mr-2" /> 新建项目</button>
      </div>

      {/* 概览卡片：数字随「与我相关 / 全公司」变，点击直接切到对应筛选 */}
      <StatGrid className="mb-6">
        <StatCard
          icon={<Briefcase className="w-6 h-6" />}
          value={overviewStats.active}
          label="进行中项目"
          tone="blue"
          onClick={() => { setModeScope('delivery'); setFilterStatus('Active'); }}
          title="点击查看进行中的交付项目"
        />
        <StatCard
          icon={<CheckCircle className="w-6 h-6" />}
          value={overviewStats.completed}
          label="已完成项目"
          tone="emerald"
          onClick={() => { setModeScope('delivery'); setFilterStatus('Completed'); }}
          title="点击查看已完成的交付项目"
        />
        <StatCard
          icon={<AlertTriangle className="w-6 h-6" />}
          value={overviewStats.stuck}
          label="有任务卡住的项目"
          tone="amber"
          onClick={() => { setModeScope('delivery'); setFilterStatus('Active'); }}
          title="进行中项目里存在超期任务的"
        />
        <StatCard
          icon={<Clock className="w-6 h-6" />}
          value={overviewStats.overdueTasks}
          label="超期未完成任务"
          emphasis="danger"
          title="所有未完结项目下已过截止日期的任务总数"
        />
      </StatGrid>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-2 w-full md:w-auto overflow-x-auto">
             <button onClick={() => setFilterStatus('Active')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterStatus === 'Active' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>进行中</button>
             <button onClick={() => setFilterStatus('Completed')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterStatus === 'Completed' ? 'bg-green-600 text-white shadow-md shadow-green-200' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>已完成</button>
             <button onClick={() => setFilterStatus('All')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterStatus === 'All' ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>全部状态</button>
             <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />
             {([
               { key: 'delivery', label: '交付项目' },
               { key: 'followup', label: '跟进项目' },
               { key: 'all', label: '两者都看' }
             ] as const).map(item => (
               <button
                 key={item.key}
                 onClick={() => setModeScope(item.key)}
                 className={`px-3 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${modeScope === item.key ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
               >
                 {item.label}
               </button>
             ))}
          </div>
          
          <div className="flex items-center space-x-3 w-full md:w-auto">
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="搜索项目…" className="flex-1 md:w-64" />
              <div className="flex w-full md:w-auto justify-center md:justify-start items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              <button
                onClick={() => setViewScope('related')}
                title="我负责、我负责其中服务项、或有任务在我名下的项目"
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewScope === 'related' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                与我相关
              </button>
              <button
                onClick={() => setViewScope('all')}
                title="公司全部项目（只读，用于了解他人交付进度）"
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewScope === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                全公司
              </button>
            </div>
          </div>
        </div>
        {/* 条数随筛选实时算，和列表永远一致——避免"徽标说 13、列表只给 1 条" */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-50 text-[11px] text-gray-500">
          <span>
            {viewScope === 'related' ? '与我相关' : '全公司'}
            ・{modeScope === 'delivery' ? '交付项目' : modeScope === 'followup' ? '跟进项目' : '交付+跟进'}
            ・{filterStatus === 'Active' ? '进行中' : filterStatus === 'Completed' ? '已完成' : '全部状态'}
          </span>
          <span className="font-bold text-gray-700">共 {filteredProjects.length} 个项目</span>
        </div>

        {dashboardFocusLabel && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
              工作台焦点：{dashboardFocusLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                setDashboardFocus(null);
                setDashboardFocusLabel('');
                setSearchTerm('');
                setFilterStatus('Active');
                setTaskViewMode('grouped');
                setViewScope(activeRole === 'CONSULTANT' ? 'related' : 'all');
              }}
              className="text-xs font-bold text-gray-500 hover:text-gray-700"
            >
              清除焦点
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Mobile Card View */}
        <div className="block md:hidden">
          {filteredProjects.map(project => (
            <div key={project.id} className="p-4 border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors" onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-black text-gray-900 text-base">{project.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">负责人: {project.manager}</p>
                </div>
                {getStatusBadge(project.status)}
              </div>
              <div className="flex justify-between items-center mt-3">
                 {(() => {
                   const pg = taskProgress(project);
                   return (
                     <div className="flex items-center space-x-2">
                        <div className="w-16 bg-gray-100 rounded-full h-1 overflow-hidden">
                            <div className="bg-indigo-600 h-full transition-all" style={{width: `${pg.pct}%`}}></div>
                        </div>
                        {/* 显示「已完成/总数」而不是百分比，和桌面表格同口径 */}
                        <span className="text-[10px] font-black font-mono text-gray-400">{pg.done}/{pg.total}</span>
                     </div>
                   );
                 })()}
                 {expandedProject === project.id ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
              {expandedProject === project.id && (
                <div className="mt-4 pt-4 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200">
                  {renderProjectDetail(project)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm text-left">
            <thead className={tableHeadClass}>
              <tr>
                <th className="w-10"></th>
                <th className={`${thClass} whitespace-nowrap`}>项目 / 客户</th>
                <th className={`${thClass} whitespace-nowrap`}>下一步要做什么</th>
                <th className={`${thClass} whitespace-nowrap`}>负责人</th>
                <th className={`${thClass} whitespace-nowrap`}>进度</th>
                <th className={`${thClass} whitespace-nowrap`}>状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {filteredProjects.map(project => (
                    <React.Fragment key={project.id}>
                        <tr className={`hover:bg-gray-50/80 cursor-pointer transition-colors ${expandedProject === project.id ? 'bg-indigo-50/30' : ''}`} onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}>
                            <td className="pl-4 text-gray-300">
                              {expandedProject === project.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                            <td className={tdClass}>
                              <div className="font-bold text-gray-900 line-clamp-1">{project.name}</div>
                              <div className="mt-1 text-[11px] text-gray-500 line-clamp-1">
                                {resolveProjectCustomerName(project)}
                              </div>
                            </td>
                            <td className={tdClass}>
                              {(() => {
                                const next = getNextTask(project);
                                if (!next) return <span className="text-xs text-gray-400">所有任务已完成</span>;
                                const overdue = isOverdueTask(next);
                                return (
                                  <div className="min-w-0">
                                    <div className="text-sm font-bold text-gray-800 line-clamp-1">{next.title}</div>
                                    <div className="mt-1 flex items-center gap-2">
                                      {overdue
                                        ? <Badge tone="red">已超期</Badge>
                                        : <span className="text-[11px] font-mono text-gray-400">{next.deadline || '无期限'}</span>}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className={`${tdClass} font-bold text-gray-700 whitespace-nowrap`}>{project.manager}</td>
                            <td className={`${tdClass} whitespace-nowrap`}>
                              <span className="text-xs font-bold text-gray-600">
                                {(() => {
                                  const pg = taskProgress(project);
                                  return <>
                                    {pg.done}/{pg.total}
                                    {pg.skipped > 0 && (
                                      <span className="ml-1 text-[10px] text-gray-400">已跳过 {pg.skipped}</span>
                                    )}
                                  </>;
                                })()}
                              </span>
                            </td>
                            <td className={`${tdClass} whitespace-nowrap`}>{getStatusBadge(project.status)}</td>
                        </tr>
                        {expandedProject === project.id && (
                            <tr>
                              <td colSpan={6} className="bg-gray-50/50 p-6">
                                {renderProjectDetail(project)}
                              </td>
                            </tr>
                        )}
                    </React.Fragment>
                ))}
            </tbody>
        </table>
      </div>
      </div>

      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 animate-in fade-in zoom-in duration-300 border border-gray-100">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-black text-gray-900">极速立项</h2>
                      <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-6 h-6 text-gray-400"/></button>
                  </div>
                  <form onSubmit={handleCreate} className="space-y-6">
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">项目名称</label>
                          <input required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="例如：某某工厂ISO认证咨询" />
                      </div>
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                            归属客户 <span className="text-red-500">*</span>
                          </label>
                          <select
                            required
                            className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            value={String(formData.customerId || '')}
                            onChange={e => setFormData({ ...formData, customerId: e.target.value })}
                          >
                            <option value="">请选择客户</option>
                            {customers.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <p className="text-[11px] text-gray-400 mt-2">
                            必选。不关联客户的话，客户档案里看不到这个项目，合作次数和累计金额也统计不到。
                          </p>
                      </div>
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">关联合同</label>
                          <select
                            className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            value={String(formData.contractRef || '')}
                            onChange={e => setFormData({ ...formData, contractRef: e.target.value })}
                          >
                            <option value="">暂无合同（后续签约再补）</option>
                            {contracts
                              .filter(c => !formData.customerId || c.customerId === formData.customerId)
                              .map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.contractNo ? `${c.contractNo} · ` : ''}{c.title}（¥{Number(c.amount || 0).toLocaleString()}）
                                </option>
                              ))}
                          </select>
                          <p className="text-[11px] text-gray-400 mt-2">
                            只能从已录入的合同里选，避免手打编号对不上。选了客户后这里只显示该客户的合同。
                          </p>
                      </div>
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">项目类别</label>
                          <div className="flex items-center bg-gray-50 border border-gray-200 rounded-2xl p-1">
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, projectCategory: 'Delivery' as any })}
                              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black transition-colors ${formData.projectCategory === 'Delivery' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white'}`}
                            >
                              交付项目
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, projectCategory: 'FollowUp' as any })}
                              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black transition-colors ${formData.projectCategory === 'FollowUp' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white'}`}
                            >
                              跟进项目
                            </button>
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">执行负责人</label>
                              <select
                                required
                                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                value={String(formData.manager || '').trim()}
                                onChange={e => setFormData({ ...formData, manager: e.target.value })}
                              >
                                {managerOptions.map(name => (
                                  <option key={name} value={name}>{name}</option>
                                ))}
                              </select>
                          </div>
                          <div>
                              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">交付周期(天)</label>
                              <input type="number" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" value={formData.duration} onChange={e => setFormData({...formData, duration: Number(e.target.value)})} />
                          </div>
                      </div>
                      <div className="flex justify-end pt-4 space-x-3">
                          <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-gray-400">取消</button>
                          <button type="submit" className="px-10 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95">确认立项</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {isAssignModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 animate-in fade-in zoom-in duration-300 border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-gray-900">指派负责人</h2>
              <button onClick={() => setIsAssignModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-6 h-6 text-gray-400"/></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">负责人</label>
                <select
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  value={assignOwnerUserId}
                  onChange={e => {
                    const picked = userProfiles.find(u => u.id === e.target.value);
                    setAssignOwnerUserId(e.target.value);
                    setAssignManager(picked?.name || '');
                  }}
                >
                  <option value="">请选择负责人</option>
                  {userProfiles
                    .filter(u => u.id !== 'AI-WORKER')
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                </select>
              </div>
              <div className="flex justify-end pt-2 space-x-3">
                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="px-6 py-3 font-bold text-gray-400">取消</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!assignProjectId) return;
                    if (!assignOwnerUserId) { alert('请选择负责人'); return; }
                    const res = assignProjectManager(assignProjectId, assignManager, assignOwnerUserId);
                    if (!res.ok) {
                      alert(res.reason || '指派失败');
                      return;
                    }
                    setIsAssignModalOpen(false);
                  }}
                  className="px-10 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95"
                >
                  确认指派
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* T-002 Cost Editing Modal */}
      {isCostModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 animate-in fade-in zoom-in duration-300 border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                 <div className="p-2 bg-amber-100 rounded-xl">
                    <DollarSign className="w-6 h-6 text-amber-600" />
                 </div>
                 <h2 className="text-xl font-black text-gray-900">项目费用补录</h2>
              </div>
              <button onClick={() => setIsCostModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5 text-gray-400"/></button>
            </div>
            
            <div className="bg-amber-50 p-4 rounded-2xl mb-6 border border-amber-100">
                <p className="text-xs text-amber-800 font-bold leading-relaxed">
                    ⚠️ 这是一个不可逆的财务操作。一旦保存：<br/>
                    1. 费用状态将锁定为“已确认”<br/>
                    2. 项目将允许被完结<br/>
                    3. 该金额将计入客户的累计产值
                </p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">项目总金额 (¥)</label>
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">¥</span>
                    <input 
                        type="number" 
                        min="0"
                        step="0.01"
                        autoFocus
                        className="w-full bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl pl-8 pr-4 py-4 text-xl font-mono font-black text-gray-900 focus:bg-white outline-none transition-all"
                        value={costEditingAmount}
                        onChange={e => setCostEditingAmount(Number(e.target.value))}
                    />
                </div>
              </div>

              <div className="flex justify-end pt-2 space-x-3">
                <button type="button" onClick={() => setIsCostModalOpen(false)} className="px-6 py-3 font-bold text-gray-400">取消</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!costEditingId) return;
                    if (costEditingAmount <= 0) {
                        alert("金额必须大于 0");
                        return;
                    }
                    const res = updateProjectCost(costEditingId, costEditingAmount);
                    if (!res.ok) {
                      alert(res.reason || '保存失败');
                      return;
                    }
                    setIsCostModalOpen(false);
                  }}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95 flex items-center"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  确认并锁定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl p-6 md:p-8 border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl md:text-2xl font-black text-gray-900">模版管理</h2>
              <button onClick={() => { setIsTemplateModalOpen(false); setTemplateModalProjectId(null); resetTemplateEditor(); }} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-6 h-6 text-gray-400"/>
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <input
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-sm outline-none"
                  placeholder="搜索模版名称..."
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs font-bold text-gray-600 select-none">
                  <input
                    type="checkbox"
                    checked={showArchivedTemplates}
                    onChange={e => setShowArchivedTemplates(e.target.checked)}
                  />
                  显示已归档
                </label>
              </div>

              {templateModalProject && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-indigo-900">当前项目：{templateModalProject.name}</p>
                    <p className="text-[11px] text-indigo-600 font-bold mt-1">
                      模板操作已统一收纳在此窗口：应用模板、另存模板都在这里完成。
                    </p>
                  </div>
                  <button
                    onClick={() => handleSaveAsTemplate(templateModalProject)}
                    className="px-3 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-xl text-xs font-black hover:bg-indigo-100 whitespace-nowrap"
                  >
                    将当前项目另存为模板
                  </button>
                </div>
              )}

              {editingTemplateId && (
                <div className="bg-gray-50/60 border border-gray-100 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <input
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none"
                      value={editingTemplateName}
                      onChange={e => setEditingTemplateName(e.target.value)}
                      placeholder="模版名称"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!editingTemplateId) return;
                          const res = updateTaskTemplate(editingTemplateId, { name: editingTemplateName, tasks: editingTemplateTasks });
                          if (!res.ok) { alert(res.reason || '保存失败'); return; }
                          alert('模版已保存');
                          resetTemplateEditor();
                        }}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => resetTemplateEditor()}
                        className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {editingTemplateTasks.map((t, idx) => (
                      <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-white border border-gray-200 rounded-xl p-3">
                        <input
                          className="md:col-span-6 bg-transparent text-sm font-bold outline-none"
                          value={t.title}
                          onChange={e => {
                            const next = [...editingTemplateTasks];
                            next[idx] = { ...next[idx], title: e.target.value };
                            setEditingTemplateTasks(next);
                          }}
                          placeholder="任务标题"
                        />
                        <select
                          className="md:col-span-2 bg-transparent text-sm outline-none"
                          value={t.priority}
                          onChange={e => {
                            const next = [...editingTemplateTasks];
                            next[idx] = { ...next[idx], priority: e.target.value as any };
                            setEditingTemplateTasks(next);
                          }}
                        >
                          <option value="High">高</option>
                          <option value="Medium">中</option>
                          <option value="Low">低</option>
                        </select>
                        <select
                          className="md:col-span-3 bg-transparent text-sm outline-none"
                          value={t.category}
                          onChange={e => {
                            const next = [...editingTemplateTasks];
                            next[idx] = { ...next[idx], category: e.target.value as any };
                            setEditingTemplateTasks(next);
                          }}
                        >
                          <option value="Core">核心</option>
                          <option value="Auxiliary">辅助</option>
                          <option value="System">系统</option>
                          <option value="ThirdParty">第三方</option>
                        </select>
                        <button
                          onClick={() => {
                            const next = editingTemplateTasks.filter((_, i) => i !== idx);
                            setEditingTemplateTasks(next);
                          }}
                          className="md:col-span-1 text-gray-400 hover:text-red-500 transition-colors p-1 justify-self-end"
                          title="删除任务"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setEditingTemplateTasks(prev => [...prev, { title: '新任务', priority: 'Medium', category: 'Core' } as any])}
                      className="w-full bg-white border border-dashed border-gray-300 rounded-xl py-2 text-xs font-black text-gray-600 hover:bg-gray-50"
                    >
                      + 添加任务
                    </button>
                  </div>
                </div>
              )}

              <div className="max-h-[55vh] overflow-y-auto space-y-2">
                {filteredTemplatesForModal.map(tpl => {
                  const isBuiltIn = Boolean(tpl.isBuiltIn);
                  const canManage = canManageTemplate(tpl);
                  const ownerLabel = tpl.createdByName ? `创建人：${tpl.createdByName}` : '';
                  const usedLabel = tpl.lastUsedAt ? `最近使用：${tpl.lastUsedAt}` : '';
                  const usageCount = Number.isFinite(Number(tpl.usageCount)) ? Number(tpl.usageCount) : 0;
                  return (
                    <div key={tpl.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-black text-gray-900 truncate">{tpl.name}</p>
                            {isBuiltIn && <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-100 text-gray-600">内置</span>}
                            {tpl.archived && <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-700">已归档</span>}
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-700">任务 {tpl.tasks?.length || 0}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-green-50 text-green-700">使用 {usageCount}</span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1">
                            {[ownerLabel, usedLabel].filter(Boolean).join(' · ')}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {templateModalProject && !tpl.archived && (
                            <button
                              onClick={() => {
                                applyTemplateToProject(templateModalProject.id, tpl.id);
                                alert(`已将模板「${tpl.name}」应用到项目「${templateModalProject.name}」`);
                              }}
                              className="px-3 py-2 bg-green-50 text-green-700 rounded-xl text-xs font-black hover:bg-green-100"
                            >
                              应用到当前项目
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const name = prompt('复制为新模版名称', `${tpl.name}（副本）`);
                              if (!name) return;
                              const res = cloneTaskTemplate(tpl.id, name);
                              if (!res.ok) { alert(res.reason || '复制失败'); return; }
                              alert('已复制为新模版');
                            }}
                            className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-black hover:bg-indigo-100"
                          >
                            复制
                          </button>

                          {canManage && (
                            <>
                              <button
                                onClick={() => beginEditTemplate(tpl)}
                                className="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => {
                                  const nextArchived = !tpl.archived;
                                  const res = archiveTaskTemplate(tpl.id, nextArchived);
                                  if (!res.ok) { alert(res.reason || '操作失败'); return; }
                                  if (editingTemplateId === tpl.id) resetTemplateEditor();
                                }}
                                className="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
                              >
                                {tpl.archived ? '恢复' : '归档'}
                              </button>
                              <button
                                onClick={() => {
                                  if (!confirm(`确认删除模版「${tpl.name}」？此操作不可恢复。`)) return;
                                  const res = deleteTaskTemplate(tpl.id);
                                  if (!res.ok) { alert(res.reason || '删除失败'); return; }
                                  if (editingTemplateId === tpl.id) resetTemplateEditor();
                                }}
                                className="px-3 py-2 bg-red-50 text-red-700 rounded-xl text-xs font-black hover:bg-red-100"
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredTemplatesForModal.length === 0 && (
                  <div className="py-12 text-center text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">
                    <p className="text-sm font-bold">暂无匹配的模版</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {undoComplete && (
        <div className="fixed bottom-24 right-6 z-50 w-[92vw] max-w-md bg-white border border-gray-100 shadow-2xl rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-gray-900 truncate">
                {(projects.find(p => p.id === undoComplete.projectId)?.name || '项目')} 已完成
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                30 秒内可撤销本次完成事件（回滚提醒与客户状态更新）
              </p>
            </div>
            <button onClick={() => setUndoComplete(null)} className="p-2 rounded-xl hover:bg-gray-50 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={() => {
                if (!undoComplete) return;
                if (Date.now() > undoComplete.expiresAt) {
                  alert('撤销窗口已过期，可在项目详情页使用“重新打开项目”。');
                  setUndoComplete(null);
                  return;
                }
                const res = reopenProject(undoComplete.projectId);
                if (!res.ok) { alert(res.reason || '撤销失败'); return; }
                setUndoComplete(null);
              }}
              className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-black hover:bg-amber-700"
            >
              撤销完成
            </button>
            <button
              onClick={() => setUndoComplete(null)}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black hover:bg-gray-50"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* 完结前的未完成任务清单：不强制做完，但每条都要交代 */}
      {completing && (
        <ProjectCompleteChecklist
          project={completing.project}
          pendingTasks={completing.pending}
          onCancel={() => setCompleting(null)}
          onConfirm={async (decisions) => {
            const target = completing.project;
            setCompleting(null);
            await doCompleteProject(target, decisions);
          }}
        />
      )}
    </div>
  );
};

export default Projects;
