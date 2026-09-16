import { SampleList } from '../components/SampleRow';
import { SAMPLE_PROJECT } from '../src/modules/onboarding/sampleRecords';

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { TaskSkipButton } from '../components/TaskSkipButton';
import { TaskStatusControl } from '../components/TaskStatusControl';
import { canBePrerequisite, knockOnDelays, isOverdue } from '../src/modules/taskFlow';
import { isMyProject, isUnownedProject } from '../src/modules/ownership';
import { ProjectCompleteChecklist } from '../components/ProjectCompleteChecklist';
import { Status, Project, ProjectTask, Receivable, TaskTemplate, ServiceCatalogItem, ServiceCategory, ProjectWorkLog, TaskSkipReason, TASK_SKIP_REASON_LABEL, ServiceItem} from '../types';
import { SERVICE_CATALOG, SERVICE_CATEGORIES, SERVICE_CATEGORY_DELIVERY_MODE, DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY } from '../constants';
import { 
  Briefcase, Search, Plus, Clock, AlertTriangle, 
  CheckCircle, ChevronDown, ChevronRight, DollarSign, Bell, 
  X, Wallet, PlayCircle, Sparkles, ShieldCheck, ArrowRight,
  ListTodo, Trash2, LayoutGrid, Timer, CheckCircle2, MoreHorizontal,
  Brain, RefreshCw, Zap, HelpCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveProjectCapabilities } from '../src/utils/projectCapabilities';
import { readGlobalSearchQuery } from '../src/modules/global_search';
import { TASK_STATUS, WORK_LOG_SOURCE } from '../src/constants/status.ts';
import { StatusBadge } from '../src/ui/statusBadge';
import { Badge, SearchInput, EmptyState, FilterSelect, StatCard, StatGrid, tableHeadClass, thClass, tdClass, trClass } from '../src/ui';
import { SampleTr } from '../components/SampleRow';
import {
  PROJECT_CATEGORY_META, deriveCategory, isBillable, hasContract,
  buildCategoryFilters, STATUS_FILTERS, SCOPE_FILTERS, ProjectModeFilter
} from '../src/modules/projectCategory';
import { buildSuggestion, buildSuggestionRecord } from '../src/modules/ownerSuggestion';
import { PROJECT_TYPE_META } from '../types';
// 术语只有一份定义，见 src/modules/glossary.ts
import { TERM_PROJECT, TERM_TASK } from '../src/modules/glossary';
import { SERVICE_GROUPS, GROUP_TO_CATALOG_CATEGORY, type ServiceGroup } from '../src/modules/serviceLine';

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
  const { projects, customers, contracts, addCustomer, marketSignals, projectWorkLogs, auditIssues, toggleReceivableStatus, claimReceivablePaid, addProject, assignProjectManager, updateProjectTask, deleteProjectTask, addProjectTask, applyTemplateToProject, addProjectServiceItem, updateProjectServiceItem, deleteProjectServiceItem, addProjectWorkLog, deleteProjectWorkLog, completeProject, reopenProject, updateProjectCost, convertIntelProjectToLead, bindFollowUpProjectToCustomer, taskTemplates, addTaskTemplate, updateTaskTemplate, deleteTaskTemplate, archiveTaskTemplate, cloneTaskTemplate, activeRole, currentUser, userProfiles, checkActionPermission, aiDecisionLogs, runProjectDiagnosis } = useApp();
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
  /*
    ── 三个筛选的默认值：都开到最大（2026-09-07 改）────────────

    金恩来：「默认应该都是全部状态，然后若是要筛选内容，
    再由登录同事自己根据条件筛选，一切设计不要画蛇添足。」

    这不只是偏好问题。默认值每收紧一档，就多一条
    「东西明明在库里，人却看不见」的路径 —— 而人看不见的第一反应
    不是「我筛错了」，是「系统坏了」。这个月已经踩了三次：
    默认只看交付 → 建的跟进项目不见；默认只看进行中 → 已完项目不见；
    默认「与我相关」→ 别人负责的项目不见。

    所以默认全开，收窄由使用的人自己来 —— 他收窄了就知道自己收窄了。

    唯一保留的默认是「与我相关」：这是金恩来点名要的，
    而且人打开项目页多半先找自己的活。为防它变成第四次「看不见」，
    下面有一条：与我相关是 0、全公司却有，就直接把话说出来并给个按钮。
  */
  const [viewScope, setViewScope] = useState<'all' | 'related'>('related');
  const [modeScope, setModeScope] = useState<ProjectModeFilter>('all');
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
    /** 校验没过时的提示 —— 不能只是不动 */
    error?: string;
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
    name: '', manager: '', deadline: '', duration: 30, projectType: 'Self-Operated',
    projectCategory: 'Delivery', billable: true
  });
  /** 「找不到？直接新建客户」展开没有 */
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  /** 当场建客户之后说一句结果 —— 静默复用会被当成功能坏了 */
  const [customerNotice, setCustomerNotice] = useState('');
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
  /*
    ── 自己排最前面并标出来（2026-09-07）──────────────────────

    立项时没选自己当负责人，项目建完就落在「与我相关」之外，
    人在列表里找不到，以为没建成 —— 2026-09-07 实际发生过。

    默认值本来就是当前登录人，但一长串名字排在一起时，
    人根本注意不到默认选中的是谁，随手就往下拉了。
    所以把自己拎到第一个、写上「（我自己）」——
    **改成别人是一个需要动手的动作，而不是随手滑过去的结果。**
  */
  const myName = String(currentUser?.name || '').trim();
  const managerOptions = Array.from(new Set([
    ...(myName && assignableManagers.includes(myName) ? [myName] : []),
    '待指派',
    ...assignableManagers,
  ]));
  const isValidManager = (value: string) => value === '待指派' || assignableManagers.includes(value);

  /*
    建议负责人。

    ── 金恩来 2026-09-11 问的就是这个 ──────────────────────────
    「你这个建议要怎么实现呢？在输入项目名称和项目的服务内容时
      根据少量信息判断推荐吗？」

    答案：**不只靠刚敲进去的那行字**。项目名只是四个信号里最弱的一个，
    真正起作用的是「这家客户的这类服务以前是谁做的」——
    而那条同时也是他另一个担心的解药：

    「全员上的话，难免会遇到同样的客户做同样咨询的抢客户的情况。」

    所以这里把**项目名 + 已选客户**一起喂进去，客户一选上，
    建议就会从「按方向」变成「按这家客户的历史」。

    ── 为什么只是显示，不自动填 ────────────────────────────────
    金恩来确认「以建议的形式派活挺好的」。系统不知道谁在休假、
    谁这周出差、客户点名要谁 —— 自动填会让人觉得系统替他做主，
    然后他就绕过系统。所以这里只显示，采不采纳是一次明确的点击。
  */
  const ownerSuggestion = useMemo(() => buildSuggestion({
    // 选了服务类型就用选的，没选才退回猜项目名 —— 猜是兜底，不是主路
    serviceText: String((formData as any).serviceGroup || formData.name || ''),
    // 选了「外包」就不该再推荐内部人 —— 这一条必须跟着表单变
    projectType: (formData.projectType || 'Self-Operated') as any,
    customerId: String(formData.customerId || '').trim() || undefined,
    customers,
    projects,
    activeConsultants: assignableManagers,
  }), [formData.name, (formData as any).serviceGroup, formData.projectType, formData.customerId, customers, projects, assignableManagers]);

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
  /*
    归属判定在 src/modules/ownership.ts，项目页、合同页、工作台共用一份。
    2026-09-15 之前这三处各写各的：合同页和工作台都漏了 ownerUserId
    和服务项负责人，工作台还漏了无主兜底 —— 于是同一个项目在
    项目管理里是「我的」，在工作台里就不是，而且不报错。
  */
  const isMineProject = (project: Project) => isMyProject(project as any, currentUser);
  /**
   * 还没了结的任务。
   *
   * ── 已跳过的不算（2026-09-08 修）─────────────────────────────
   * 原来只排除 Completed，于是**已跳过的任务照样被算成「逾期」** ——
   * 而跳过是人主动交代过原因的决定，不是没做完。
   * 生产上「逾期未完成任务 22」里就掺着这些，
   * 一个掺了水的数字，看的人很快就不再信它。
   */
  const isOpenTask = (task: ProjectTask) => task.status !== 'Completed' && task.status !== 'Skipped';
  /*
    ── 判「逾期」只能有一份实现（2026-09-14）──────────────────────

    这里原来自己写了一份：`new Date(deadline).getTime() < Date.now()`。
    而 src/modules/taskFlow.ts 里也有一份 isOverdue，
    services/dashboardMetrics.ts 里还有第三份（diffDays(...) < 0）。

    三份在「今天到期算不算逾期」上**结论不同** ——
    taskFlow 说不算（截止日当天结束才算），另外两份说算。
    金恩来 2026-09-14 看到的就是这个：
    工作台写「逾期任务 5」，点进项目管理却一条都看不到，
    而同一页的「逾期未完成任务」显示 0。

    更要命的是**这个不一致是我当天造成的**：上午修了 taskFlow.isOverdue
    （「今天到期不算逾期」），却没去查「同样的东西还有几处」——
    而 CLAUDE.md 第六章第 2 条写的第一个问题就是这个。

    收口到 taskFlow.isOverdue 一份。
  */
  const isOverdueTask = (task: ProjectTask) => isOverdue(task);
  const isDueSoonTask = (task: ProjectTask) => {
    const diff = Math.ceil((new Date(String(task.deadline || '')).getTime() - Date.now()) / (24 * 3600 * 1000));
    return isOpenTask(task) && diff >= 0 && diff <= 7;
  };
  /*
    ── 这一页的四张卡全部数「项目」（2026-09-15 重做）──────────────

    金恩来：「项目管理的卡片，目的是提高咨询师的生产效率……
              不要为了好看而显示，要为了好用提效而设计。」

    定一条能一次消掉整类混乱的规矩：**这一页列的是项目，所以每张卡都数项目。**
    任务粒度的数字归「我的任务」和工作台 —— 在这之前，
    第四张卡数任务却叫「…的项目」，和第三张挨在一起，谁也说不清差在哪。

    四张卡对应咨询师心里的四个问题，顺序就是他早上问自己的顺序：
      1. 我手上几个在跑？        进行中项目
      2. 这周必须动哪几个？      7 天内要交        ← 还来得及的那一档
      3. 哪几个已经出事了？      有逾期任务的项目
      4. 哪几个会悄悄烂掉？      待补信息          ← 不逾期、不报错、没人想起

    换掉的是「已结项」和「逾期任务条数」：
    前者是回头看的数字，今天不驱动任何动作（它还在「状态」下拉里）；
    后者和第三张是同一个筛选，只是换了个粒度。
  */

  /** 未来 7 天内（含今天）要交的项目：项目交期临近，或名下有任务临近 */
  const isDueSoonProject = (p: Project) => {
    if (p.status !== Status.Active) return false;
    const days = (d?: string) => {
      const raw = String(d || '').trim();
      if (!raw) return Number.NaN;              // 没填日期不算临近（没约定就没有迟到）
      const ms = new Date(raw).getTime();
      if (!Number.isFinite(ms)) return Number.NaN;
      return Math.ceil((ms - Date.now()) / (24 * 3600 * 1000));
    };
    const soon = (n: number) => Number.isFinite(n) && n >= 0 && n <= 7;
    if (soon(days(p.deadline))) return true;
    return (p.tasks || []).some(t => isOpenTask(t) && soon(days(t.deadline)));
  };

  /*
    还缺关键信息、推不动也结不了账的项目。三种都会安安静静地烂掉：
    没负责人（谁都看不到它）、一条任务都没排（永远不会逾期）、
    交付类却没金额（收不到钱，也算不进营收）。
    口径写在 src/modules/glossary.ts 的 TERM_PROJECT.needsSetup。
  */
  const setupGaps = (p: Project): string[] => {
    if (p.status !== Status.Active) return [];
    const gaps: string[] = [];
    if (isUnownedProject(p as any)) gaps.push('缺负责人');
    if (!(p.tasks || []).length) gaps.push('还没排任务');
    if (resolveProjectCapabilities(p).projectMode === 'delivery' && Number(p.projectAmount || 0) <= 0) {
      gaps.push('缺金额');
    }
    return gaps;
  };
  const needsSetup = (p: Project) => setupGaps(p).length > 0;

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
      // 走 openProject 写进地址 —— 直接 setExpandedProject 会被 URL 同步的 effect 清掉
      openProject(String(state.openDetailId));
    }

    if (focus?.type) {
      setDashboardFocus(focus);
      setSearchTerm('');
      setTaskViewMode(['overdue_tasks', 'due_7d', 'customer_confirm', 'busiest_owner'].includes(focus.type) ? 'flat' : 'grouped');
      setViewScope(focus.owner === 'me' || activeRole === 'CONSULTANT' ? 'related' : 'all');
      setFilterStatus(['revenue_completed', 'completed_7d'].includes(focus.type) ? 'Completed' : focus.type === 'team_overview' ? 'All' : 'Active');
      /*
        从工作台点进来时，类别筛选要放开到「全部类别」。

        本页曾经默认只看合同项目，而工作台的指标（在制项目数、日志覆盖率、延误率…）
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
      else if (focus.type === 'active_projects') setDashboardFocusLabel(focus.owner === 'me' ? `我负责的${TERM_PROJECT.active}` : TERM_PROJECT.active);
    }

    if (state.dashboardFocus || state.openDetailId) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state, activeRole]);

  useEffect(() => {
    const q = readGlobalSearchQuery(location.search);
    setSearchTerm(q);
  }, [location.search]);

  /*
    ── 项目详情要有自己的地址（2026-09-15 加）──────────────────────

    展开哪个项目原来只存在 `expandedProject` 这个本地状态里，
    地址栏从头到尾是 `#/projects`。后果有三个，都很日常：

      · 总助想跟顾问说「你看下嘉力那个项目」——**发不出链接**
      · 刷新一下就退回列表，刚看到哪儿全没了
      · 按浏览器后退，详情不会关，直接跳出这一页

    第三个还有个连带：详情页上的任何东西都没法「刷新再看一眼」，
    而这正是我们查「点了到底存没存住」的标准手法。

    所以把它同步到 `?p=<项目id>`：地址能发、刷新还在、后退能关。
    用 push 不用 replace —— 打开详情在人心里就是「进去了一层」，
    后退应该回到列表，而不是直接离开项目管理。
  */
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('p');
    setExpandedProject(id || null);
  }, [location.search]);

  /*
    ── 带地址进来时，要保证这个项目**看得见**（2026-09-15）──────────

    加完 `?p=<id>` 之后第一次实测就踩了坑：总助打开
    `#/projects?p=P-1789440937759`，页面显示「共 0 个项目」——
    因为「范围」默认是「与我相关」，而那个项目是别人的，直接被筛掉了，
    连行都没渲染，自然也无处展开。

    **链接发过去对方打开是空的，等于这个功能没有。**
    这和 2026-09-15 上午「合同说已立项、项目管理里找不到」是同一个形状：
    东西在，但默认筛选把它藏了。

    所以带 id 进来时，如果这个项目确实存在却不在当前筛选结果里，
    就把挡住它的那几个筛选放开，并说明一句为什么 ——
    数字突然变了而没有解释，比看不见更让人糊涂。
  */
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('p');
    if (!id) return;
    const target = projects.find(p => p.id === id);
    if (!target) return;
    const blocked: string[] = [];
    if (viewScope === 'related' && !isMineProject(target)) { setViewScope('all'); blocked.push('范围→全公司'); }
    if (!matchesModeScope(target)) { setModeScope('all'); blocked.push('类别→全部'); }
    if (!matchesOverviewStatus(target)) { setFilterStatus('All'); blocked.push('状态→全部'); }
    if (blocked.length) {
      setCreatedNotice(`为了让你看到「${target.name}」，已放开筛选（${blocked.join('、')}）。`);
    }
  }, [location.search, projects]);

  /**
   * 打开某个项目的详情（只开不关）。
   *
   * 从工作台跳过来、从逾期任务清单点过来都走这个 ——
   * 必须写进地址，不能直接 setExpandedProject：
   * 上面那个跟着 location.search 跑的 effect 会在同一轮把它清掉，
   * 于是「从工作台点某条逾期任务进来」会变成停在列表页什么都没展开。
   * （加 URL 同步时差点就这么漏了一处。）
   */
  const openProject = (id: string) => {
    const params = new URLSearchParams(location.search);
    params.set('p', id);
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true });
  };

  /** 展开/收起同时改地址。列表里所有展开入口都走这个，别再直接 setExpandedProject */
  const toggleProject = (id: string) => {
    const params = new URLSearchParams(location.search);
    if (params.get('p') === id) params.delete('p');
    else params.set('p', id);
    const qs = params.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' });
  };

  /*
    换角色（含右上角切视角）时把范围恢复成默认。

    ── 这里原来是「除了顾问，一律看全公司」（2026-09-07 改）──

    那条规则藏在一个 useEffect 里，**会覆盖掉状态声明的默认值** ——
    我把默认改成「与我相关」之后，界面上依然显示「全公司」，
    因为这个 effect 在挂载时又把它推回去了。
    同一条规则在这个文件里有四处副本，这是最难发现的一处：
    它不在筛选条附近，改筛选时根本不会看到它。

    现在统一成「与我相关」——金恩来点名要的默认值，
    而「与我相关是 0、全公司却有」的情况由筛选条下面那行提示兜住。
  */
  useEffect(() => {
    setViewScope('related');
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

  const [filterStatus, setFilterStatus] = useState<'Active' | 'Completed' | 'All' | 'DueSoon' | 'Overdue' | 'NeedsSetup'>('All');
  /** 刚建完的一句说明 —— 告诉人东西在哪，而不是让他自己找 */
  const [createdNotice, setCreatedNotice] = useState('');
  const [creating, setCreating] = useState(false);
  /*
    ── 名字要和它数的东西对上（2026-09-14 金恩来指出）──────────────

    这一项原来叫「逾期未完成任务」，但它的筛选条件是
        p.status !== Completed && p.tasks.some(isOverdueTask)
    —— **数的是项目，不是任务**。

    于是页面上会同时出现：
      工作台「逾期任务数 5」（数任务）
      项目管理「逾期未完成任务 0」（其实是"有逾期任务的项目数"）
    两个都叫"任务"，数字却对不上，人只会觉得这系统不靠谱。

    改名叫「有逾期任务的项目」—— 和旁边的「有任务卡住的项目」同一个句式，
    一眼看出这一列数的是项目。
  */
  /*
    下拉里不再有 Stuck —— 它的条件（Active && 有逾期任务）和 Overdue
    （!Completed && 有逾期任务）在项目只有两种状态时完全等价，
    留着就是两个选项选出同一份清单。见下方两张统计卡处的说明。
  */
  const projectStatusFilters = [
    ...STATUS_FILTERS,                                                   // 全部 / 进行中 / 已结项
    { value: 'DueSoon' as const, label: TERM_PROJECT.dueSoon },
    { value: 'Overdue' as const, label: TERM_PROJECT.withOverdueTask },
    { value: 'NeedsSetup' as const, label: TERM_PROJECT.needsSetup },
  ];
  const selectOverview = (status: typeof filterStatus) => { setFilterStatus(status); setSearchTerm(''); setDashboardFocus(null); setDashboardFocusLabel(''); };
  const matchesOverviewStatus = (p: Project) => {
    if (filterStatus === 'Active') return p.status === Status.Active;
    if (filterStatus === 'Completed') return p.status === Status.Completed;
    if (filterStatus === 'DueSoon') return isDueSoonProject(p);
    // 只看进行中的：已结项项目里的残留任务是结项收尾没做干净，不是今天的活
    if (filterStatus === 'Overdue') return p.status === Status.Active && (p.tasks || []).some(isOverdueTask);
    if (filterStatus === 'NeedsSetup') return needsSetup(p);
    return true;
  };

  /**
   * 类别筛选。
   *
   * ── 这里原来藏得住东西（2026-09-07 修）──────────────────────
   *
   * 原来只有两档 delivery / followup，判断写成
   * 「delivery 档排掉 isFollowUp、followup 档排掉非 isFollowUp」。
   * 加了第三类「其他事务」之后，它的 projectMode 是 'public'，
   * isFollowUp 为 false —— 于是：
   *   选「交付项目」：不排它 → 混进来了
   *   选「跟进项目」：排掉它 → 找不到了
   * 而立项后代码又特地把筛选切到 followup 档，
   * 意思是**建完一个其他事务，界面会跳到唯一看不见它的那一档**。
   *
   * 现在直接比对 projectMode，三类各归各档，加第四类也不会再漏。
   */
  const matchesModeScope = React.useCallback(
    (p: Project) => modeScope === 'all' || resolveProjectCapabilities(p).projectMode === modeScope,
    [modeScope]
  );

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
        ② 四张都不跟随眼前的类别筛选（useMemo 依赖里连 modeScope 都没有）；
        ③ 结果是咨询顾问视角下出现「0 个进行中项目、共 0 个项目」却「3 个逾期未完成任务」，
           那 3 个任务在跟进项目里，而列表正筛着交付项目 —— 点卡片也找不到对应项目。
      现在四张卡片同源：先按「与我相关 / 全公司」，再按「交付 / 跟进」，
      只有状态和搜索不跟（那两个跟了卡片就没意义了，筛"进行中"时"已完成"会变 0）。
    */
    const base = projects
      .filter(p => viewScope === 'all' || isMineProject(p))
      .filter(p => matchesModeScope(p));
    const active = base.filter(p => p.status === Status.Active);
    /*
      四个数字全部是**项目个数**，而且每个都能在下面的列表里被同名筛选选出来 ——
      卡片说 3，点进去就必须是 3 行。这一页之前正是在这里出的问题：
      标签写「…的项目」而数字数的是任务。
    */
    return {
      active: active.length,
      dueSoon: active.filter(isDueSoonProject).length,
      withOverdue: active.filter(p => (p.tasks || []).some(t => isOverdueTask(t))).length,
      needsSetup: active.filter(needsSetup).length
    };
  }, [projects, viewScope, modeScope, currentUser.id, currentUser.name]);

  const filteredProjects = useMemo(() => projects
    .filter(p => {
      if (!matchesOverviewStatus(p)) return false;


      if (!matchesModeScope(p)) return false;

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

  /**
   * 同样的条件下，全公司有多少个 —— 用来判断「是真没有，还是我在看自己那一档」。
   *
   * 只有在「与我相关」筛出 0 条时才用得上，所以不必在意它多算一遍。
   */
  const companyWideCount = useMemo(() => projects.filter(p => {
    if (!matchesOverviewStatus(p)) return false;

    if (!matchesModeScope(p)) return false;
    if (!matchesProjectFocus(p)) return false;
    const q = searchTerm.trim();
    if (!q) return true;
    return p.name.includes(q) || p.manager.includes(q);
  }).length, [projects, filterStatus, modeScope, searchTerm, dashboardFocus, projectWorkLogs]);

  /** 金额与结算只给有 CONTRACT_VIEW_AMOUNT 的角色。咨询师刻意看不到，避免与客户议价、同事比价。 */
  // 新建类动作不传归属 context —— 还没建出来的东西谈不上是谁的
  const canCreateProject = checkActionPermission('PROJECT_CREATE').allowed;
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
    const open = (project.tasks || []).filter(isOpenTask);
    if (open.length === 0) return null;
    return open.slice().sort((a, b) => {
      const at = new Date(String(a.deadline || '2099-12-31')).getTime();
      const bt = new Date(String(b.deadline || '2099-12-31')).getTime();
      return (Number.isFinite(at) ? at : 4102416000000) - (Number.isFinite(bt) ? bt : 4102416000000);
    })[0];
  };

  const getStatusBadge = (status: Status) => <StatusBadge status={status} domain="project" />;

  /**
   * 行上的类别徽章。
   *
   * 类别只回答「给谁做」，**钱的事另挂一个标签** ——
   * 因为「客户项目」里既有收钱的也有不收钱的（免费维护、售后支持），
   * 把它们显示成同一个东西，看列表的人就分不出哪些进营收。
   */
  const getCategoryBadge = (project: Pick<Project, 'projectCategory' | 'billable'>) => {
    const category = project.projectCategory;
    const meta = PROJECT_CATEGORY_META[category as keyof typeof PROJECT_CATEGORY_META] || PROJECT_CATEGORY_META.Delivery;
    const tone = category === 'FollowUp' ? 'amber' : category === 'Public' ? 'gray' : 'indigo';
    const earns = isBillable(project);
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Badge tone={tone} className="cursor-help" title={`${meta.when}・${meta.money}`}>{meta.label}</Badge>
        {category === 'Delivery' && (
          <Badge tone={earns ? 'emerald' : 'gray'} title={earns ? '做完计入营收' : '这一单不收钱，不计营收，但工时照常记'}>
            {earns ? '收费' : '不收费'}
          </Badge>
        )}
      </span>
    );
  };

  /* ── 建项目表单：两个问题推出来的东西 ────────────────────────── */

  /** 「给谁做」的答案。Public 就是「不涉及客户」 */
  const hasCustomer = formData.projectCategory !== 'Public';
  /** 「收不收钱」的答案。不涉及客户时恒为否 */
  const billable = hasCustomer && formData.billable !== false;
  const derivedCategory = deriveCategory({
    customerId: hasCustomer ? (formData.customerId || 'pending') : '',
    billable
  });

  /**
   * 当场新建客户。
   *
   * 只要一个名字。详细资料（联系人、行业、证书）以后在客户管理里补 ——
   * 建项目的那一刻他手上多半也只有一个公司名，
   * 逼他把客户档案填完整，结果是他干脆不建项目。
   */
  const handleQuickCreateCustomer = () => {
    const name = newCustomerName.trim();
    if (!name) return;
    /*
      查重规则不写在这里了 —— addCustomer 里那一份是唯一的一份。
      这里原来自己写了 `c.name === name`，而客户管理页一份都没有，
      于是同一个动作走两个门结果不一样（2026-09-12 金恩来撞到）。

      这里只负责**把结果说出来**。原来重名时静默选中已有客户，
      什么都不提示 —— 他因此以为「直接建新客户」这个按钮坏了。
    */
    const created = addCustomer({
      name,
      contactPerson: '',
      totalValue: 0,
      riskStatus: 'low',
      activeContracts: 0,
      status: Status.Active,
      followUpRecords: [],
    } as any);
    setFormData(prev => ({ ...prev, customerId: created.id }));
    setShowNewCustomer(false);
    setNewCustomerName('');
    setCustomerNotice(created.duplicated
      ? `客户档案里已经有「${created.name}」了，已经帮你选中它 —— 没有重复建一家。`
      : `已新建客户「${created.name}」并选中。其他资料以后在客户管理里补。`);
  };

  /**
   * 类别筛选档位。
   *
   * 「售前跟进（旧）」只在库里真的还有这类项目时才出现 ——
   * 等最后一个收尾完，这一档自己消失，不用谁去清理，
   * 也不会让新同事看到一个建不出来的选项而困惑。
   */
  const categoryFilters = useMemo(
    () => buildCategoryFilters(projects.some(p => p.projectCategory === 'FollowUp')),
    [projects]
  );

  /**
   * 改任务截止日期。
   *
   * ── 改期要说出连带影响（2026-09-08）───────────────────────────
   *
   * 前置任务这个字段的价值不在于画甘特图，在这里：
   * 一个任务往后挪，**它后面等着的那几件跟着挪** ——
   * 而这件事原来只有排流程的那个人知道，改期的人根本看不见。
   *
   * 客户问「还要多久」时答不上来，多半就是因为这层连带
   * 从来没在系统里显式存在过。
   *
   * 只提醒直接下游一层：一层说得清，两层就没人看了。
   */
  const changeTaskDeadline = (project: Project, task: ProjectTask, nextDeadline: string) => {
    const affected = knockOnDelays(task, project.tasks || [], nextDeadline);
    if (affected.length > 0) {
      const lines = affected.map(a => `· ${a.task.title}（现定 ${a.task.deadline}，会晚 ${a.daysLate} 天）`).join('\n');
      const ok = window.confirm(
        `这条改到 ${nextDeadline} 之后，下面这些等着它的任务也来不及了：\n\n${lines}\n\n`
        + `确定改吗？改完记得把它们的日期也往后调 —— 系统不会替你改，那是你和客户要重新谈的事。`
      );
      if (!ok) return;
    }
    updateProjectTask(project.id, task.id, { deadline: nextDeadline });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const manager = String(formData.manager || '').trim();
    if (!manager) {
        alert("必须指定执行负责人！");
        return;
    }
    /*
      外包的单子必须写清合作方 —— 否则「这活谁做的」这条链就断在这里。

      这条和「必须指定负责人」是同一个道理：自己做的活断在负责人，
      外包的活断在合作方。两边都不能留空。
    */
    if (formData.projectType === 'Outsourced' && !String((formData as any).vendorName || '').trim()) {
      alert('整单外包给第三方，必须写清合作方是哪一家。\n\n否则将来查「这活谁做的」会断在这里 —— 而那是这个系统最不能断的一条链。');
      return;
    }
    if (!isValidManager(manager)) {
      alert('执行负责人请从列表选择（或选择“待指派”）。');
      return;
    }
    /*
      ── 客户必填与否，由「给谁做」决定（2026-09-08 重做）────────

      原来一律必填，逻辑是倒的：变成「必须先建客户，才能建项目」，
      而现实里往往先有事、后有客户。

      更要紧的是有一类活根本没有客户 ——
      「政府要我们配合通知 2000 家企业营业执照要年检」，
      按原规则**根本进不了系统**。进不了系统不是少一条记录，
      是这件事的工时、进度、谁在做全部回到微信群和个人脑子里。

      现在只看第一个问题的答案：
        选了「某个客户」 → 必须真的选一个（钱和合作记录要落到某一家头上）
        选了「不涉及客户」 → 这一栏根本不显示

      **不再要求有合同**：台账指导这类小活没有合同、先干后签的活
      当下也没有合同 —— 拿合同当前提，这些活就都进不来。
    */
    const customerId = String(formData.customerId || '').trim();
    if (hasCustomer && !customerId) {
      alert('请选择归属客户 —— 钱和合作记录都要落到某一家头上。\n\n如果客户档案里还没有，用下拉框底下的「找不到？直接新建客户」，输个公司名就行，其他资料以后再补。\n\n如果这件事不属于任何客户（比如政府交办的），上面选「不涉及客户」。');
      return;
    }

    // 负责人同时写入用户 ID，保证「我的项目」和数据权限按身份而不是姓名判断
    const ownerUserId = userProfiles.find(u => u.name === manager)?.id;
    /*
      类别不是人选的，是这两个答案推出来的 —— 存的时候算一次。
      存下来（而不是每次读时再算）是因为下游的统计、筛选、面板显隐
      全都在读 projectCategory，改成处处现算等于把这一处的复杂度
      摊到十几个地方。
    */
    if (creating) return;
    setCreating(true);
    setCreatedNotice('');
    /*
      ── 选了服务类型，就把它落成服务项（2026-09-12）──────────────

      金恩来：「我创建的『测试2』只写了个名字，但任务列表里
      直接就生成了 5 张类似体系相关的任务卡片」。

      那 5 张来自通用交付模板，是照体系认证写的，却套在每个客户项目上。
      而我上一轮加的「服务类型」下拉**存的时候被丢掉了** ——
      它只喂了派活建议，没进项目。（这个项目里第三次栽在
      「白名单漏字段」上：accountExpiresAt、vendorName，现在是 serviceGroup。）

      接回去之后：选了服务类型 → 落成一条服务项 → 走那个大类自己的
      流程模板；没选 → 什么都不生成（见 disableDefaultTemplateTasks），
      因为**猜错的五张任务比零张更费事**：还得一张张删。
    */
    const chosenGroup = String((formData as any).serviceGroup || '').trim();
    const seedService = chosenGroup && chosenGroup !== '未分类'
      ? [{
          name: chosenGroup,
          category: (GROUP_TO_CATALOG_CATEGORY[chosenGroup as ServiceGroup] || '其他') as ServiceItem['category'],
          owner: manager,
          status: 'Pending' as ServiceItem['status'],
          autoGenerateTasks: true,
        }]
      : [];

    const saved = await addProject({
      ...formData,
      manager,
      customerId,
      ...(seedService.length
        ? { initialServiceItems: seedService }
        // 不知道是什么服务就别瞎生成 —— 空列表里有「模板管理」可以一键套
        : { disableDefaultTemplateTasks: true }),
      projectCategory: deriveCategory({ customerId: hasCustomer ? (customerId || 'pending') : '', billable }),
      billable,
      // 不涉及客户的活没有合同这一说
      ...(hasCustomer ? {} : { contractRef: '' }),
      ...(ownerUserId ? { ownerUserId } : {})
    });
    setCreating(false);
    if (!saved) return;

    /*
      ── 把「系统推了谁 / 人最终选了谁」记下来（2026-09-11）──────────

      金恩来：「随 AI 对系统越来越了解，后面推荐肯定也会更有依据和准确」。
      **那是有前提的**：得先有数据。没有这一笔，推荐规则永远停在
      我照着花名册写死的那一版，「越用越准」就是一句空话。

      要记的重点不是「推了谁」，是**推的和选的差在哪**：
      差异里装着规则没编码进去的全部现实（休假、出差、客户点名、处不来）。
      攒一段时间能直接回答两个问题：
        · 哪一类服务的推荐最不准 → 那类规则要改
        · 谁总被推荐却总不被选   → 花名册上的方向是不是过时了

      写进已有的 business_events（detail 是 json 列），不新建表 ——
      上线前动库结构的风险，换来的只是查询时少一次 json 取值，不划算。
      和 task.skipped 一样：打点失败绝不能影响建项目，所以 catch 掉。
    */
    if (!ownerSuggestion.outsourced && ownerSuggestion.candidates.length > 0) {
      const rec = buildSuggestionRecord(saved.id, ownerSuggestion, manager);
      void fetch('/api/business-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventType: rec.overridden ? 'project.owner.suggestion.overridden' : 'project.owner.suggestion.followed',
          subjectType: 'project',
          subjectId: rec.projectId,
          summary: rec.overridden
            ? `派活建议未被采纳：推荐 ${rec.suggested || '-'}，实际指派 ${rec.chosen}`
            : `派活建议被采纳：${rec.chosen}`,
          detail: { ...rec, previousOwner: ownerSuggestion.previousOwner },
        }),
      }).catch(() => { /* 打点失败不该打断建项目 */ });
    }

    setIsModalOpen(false);
    setShowNewCustomer(false);
    setNewCustomerName('');

    /*
      ── 建完必须看得见它（2026-09-07，第二次修）──────────────

      第一次修只调了「范围」和「状态」两个筛选，**漏了「类别」**。
      结果金恩来建了三个跟进项目，而列表默认只看交付项目 ——
      三条全都好好地存在库里，他一条也没看见，
      得出的结论是「点了没反应」，然后又建了两个。

      **这类 bug 会重复发生**，因为筛选是一个个加上去的，
      而每加一个就多一条「新建的东西可能被它藏起来」的路径。

      所以这次不再一个个补：**把每一个筛选都调到能看见它的那一档**，
      而且下面那条测试会在新增筛选却忘了处理时失败。
    */
    const mine = manager === currentUser.name || (ownerUserId && ownerUserId === currentUser.id);
    const category = deriveCategory({ customerId: hasCustomer ? (customerId || 'pending') : '', billable });

    // ① 范围：不是自己负责就切到全公司
    setViewScope(mine ? 'related' : 'all');
    /*
      ②③ 状态和类别一律开到「全部」，不再「切到它所属的那一档」。

      切到那一档看着更贴心，实际上是把「看得见」压在**我算得对**上：
      第一次算错了类别（其他事务被切到跟进档，而那一档恰恰不显示它），
      于是又是一次「点了没反应」。开到全部则不依赖任何判断 ——
      只要它进了库就一定在列表里。
    */
    setFilterStatus('All');
    setModeScope('all');
    // ④ 搜索框里的关键词也会把它挡掉
    setSearchTerm('');
    /*
      ⑤ 从工作台点进来时带的「聚焦」也是一层筛选（比如「只看逾期未完成任务的项目」）。
      带着它建项目，新项目一样会被挡在外面 —— 这一条是测试替我找出来的，
      我自己数筛选时漏了。
    */
    setDashboardFocus(null);
    setDashboardFocusLabel('');

    const where = [
      mine ? null : `负责人是「${manager}」，已切到「全公司」`,
      '筛选已放开到全部状态、全部类别',
    ].filter(Boolean).join('；');
    setCreatedNotice(`已立项「${PROJECT_CATEGORY_META[category].label}」—— ${where}，这样你才看得到它。`);
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
    /*
      「转为线索」只看**来源是不是情报**，不看类别（2026-09-08 改）。

      原来是 isIntelOrigin && isFollowUpProject。情报研判任务的类别
      从 FollowUp 改成 Public 之后，这个条件会变成 false，
      **「转为线索」按钮就此消失** —— 情报→线索这条链路会被悄悄弄断，
      而且不报错，只是按钮不见了。改类别时最容易漏掉的正是这种连带。
    */
    const isIntelFollowUpProject = projectCaps.isIntelOrigin;
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
              <div className="mt-1">{getCategoryBadge(project)}</div>
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
                  {isOverdueTask(next) && <Badge tone="red">已逾期</Badge>}
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
                  这类项目不进入财务结算与回款。签约后在合同管理录入合同并勾选「同时创建项目」即可。
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
                      alert('已绑定客户。签约后请在合同管理录入合同并自动立项合同项目。');
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
                  // 未完成 = 没做 + 在做（跳过的已经交代过原因，不用再问一遍）
                  const pending = (project.tasks || []).filter(t => t.status === 'Pending' || t.status === 'InProgress');
                  if (pending.length > 0) { setCompleting({ project, pending }); return; }
                  await doCompleteProject(project);
                }} className="w-full md:w-auto bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center hover:bg-blue-700 transition-all active:scale-95 shadow-md shadow-blue-200">
                  <CheckCircle className="w-4 h-4 mr-1.5" /> 标记完成
                </button>
              )}
              {/*
                ── 「发起结算」暂时没有可接的动作（2026-09-16）──────────────

                这个按钮原来是个壳：没有 onClick、不在表单里，点了什么都不发生，
                而它是绿色主按钮、带播放图标、有 hover ——
                看起来比页面上任何一个按钮都像"能用"。

                查过了：这个系统里结算只能从 Excel 导入（AppContext 的
                importSettlements），**没有"在应用内新建一笔结算"这个动作**。
                所以不能硬接一个，硬接出来的是假功能。

                改成两件事：
                  · 文案说实话（「结算从 Excel 导入」），不再冒充可执行动作
                  · 给出口 —— 点它跳到结算页，那里才是真正能做事的地方
                规矩是：不许留「看起来能用、点了没反应」这第三种状态。
              */}
              {canSeeSettlement && (
                <button
                  type="button"
                  onClick={() => navigate('/finance/settlements')}
                  title="本系统的结算通过 Excel 批量导入，点此前往结算页"
                  className="w-full md:w-auto border border-green-600 text-green-700 bg-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center hover:bg-green-50 transition-all active:scale-95"
                >
                  <PlayCircle className="w-4 h-4 mr-1.5" /> 结算从 Excel 导入
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

        {/*
          ── 服务项排在任务前面（2026-09-07 改）────────────────

          原来任务在上、服务项在下。人打开项目第一眼看到的是空的任务区，
          自然就去点「+」一条条手加 —— 加完才发现下面有服务项可选，
          而选一个服务项系统会自动把任务全带出来。
          白干一遍，还得把手加的删掉。

          先选服务项、任务自动生成，这才是设计好的那条路。
          界面顺序就该等于做事顺序：先确定卖了什么，再谈怎么做。
        */}
        {projectCaps.showServicePanel && (
        <div className="order-2 bg-gray-50/50 rounded-2xl border border-gray-100 p-4 md:p-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
            {/*
              ── 三块的名字要一眼分得开（2026-09-07 改）──────────

              原来叫「服务清单」和「任务清单」—— 只差一个字，
              而它们恰恰是最该分清的两个东西：一个是**卖了什么**，
              一个是**要做哪些事**。名字最像的两样，含义差最远。

              现在每一块都带一句「它回答什么问题」，
              人不用去猜三者谁生谁。
            */}
            <div>
              <h3 className="font-black text-gray-900 flex items-center"> <LayoutGrid className="w-5 h-5 mr-2 text-indigo-600" /> 服务项 · 客户买了什么 </h3>
              <p className="mt-1 text-xs font-bold text-gray-400">来自合同。一个项目可以有多项服务，各有各的负责人；加进来时可以让系统按模板自动生成任务。</p>
            </div>
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
                    onChange={e => setServiceDraft(prev => prev ? { ...prev, rawName: e.target.value, error: '' } : prev)}
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
                  {activeServiceDraft.error && (
                    <span className="text-xs font-bold text-red-600">{activeServiceDraft.error}</span>
                  )}
                  <button
                    onClick={() => {
                      const rawName = activeServiceDraft.rawName.trim();
                      /*
                        名称是空的时候原来直接 return —— **一声不吭**。
                        2026-09-07 反馈「点击确认添加没有反应」就是这个：
                        人以为按钮坏了，其实是系统在无声地拒绝他。

                        点了没反应是最难查的一类问题：没有报错、没有日志、
                        连「哪里不对」都不知道，只能反复点。
                      */
                      if (!rawName) {
                        setServiceDraft(prev => prev ? { ...prev, error: '先填服务名称，比如「ISO9001 认证咨询」' } : prev);
                        return;
                      }
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

        {/* 交付任务：排在服务项后面 —— 任务多数是服务项自动带出来的 */}
        <div className="order-3 space-y-6">
           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="font-black text-gray-900 flex items-center"> <ListTodo className="w-5 h-5 mr-2 text-blue-600" /> {isFollowUpProject ? '任务 · 这个客户要跟哪些事' : '任务 · 要做哪些事'} </h3>
                <p className="mt-1 text-xs font-bold text-gray-400">每项服务拆成的具体动作：谁做、什么时候之前做完。延误率算的就是这里。</p>
              </div>
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
                               <TaskStatusControl
                                 task={task}
                                 allTasks={project.tasks || []}
                                 disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                                 onChange={(u) => updateProjectTask(project.id, task.id, u)}
                               />
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
                             {/*
                               2026-09-12 金恩来：「全屏显示下有BUG，排版和显示都有问题」

                               实测 1400/1500/1600 三个常见笔记本宽度下，
                               「核心」这个徽标被压成 21×44 —— 一个字一行，竖着叠，
                               和旁边的下拉框糊在一起。2000 宽反而正常，
                               所以我第一次按 2000 验，没验出来。

                               原因是这一行里三样东西抢宽度：日期 + 两个 140px 的下拉框
                               + 徽标，加起来超过卡片内宽，而徽标是唯一没设 shrink-0 的，
                               于是全由它让位。现在：徽标不许缩、下拉框可以缩、
                               真放不下就换行 —— 三条缺一不可。
                             */}
                             <div className="flex flex-wrap justify-between items-center gap-y-2">
                                <div className="flex items-center text-[10px] font-mono text-gray-400">
                                   <Timer className={`w-3 h-3 mr-1 ${isOverdue ? 'text-red-500' : ''}`} />
                                   <input type="date" className="bg-transparent focus:outline-none" value={task.deadline} onChange={e => changeTaskDeadline(project, task, e.target.value)} />
                                </div>
                                <div className="flex items-center gap-2">
                                  {serviceItems.length > 0 && (
                                    <select
                                      className="min-w-0 flex-shrink bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                      value={task.serviceItemId || ''}
                                      onChange={e => updateProjectTask(project.id, task.id, { serviceItemId: e.target.value || undefined })}
                                    >
                                      <option value="">未归属</option>
                                      {serviceItems.map(si => (
                                        <option key={si.id} value={si.id}>{si.name}</option>
                                      ))}
                                    </select>
                                  )}
                                  {/*
                                    前置任务。
                                    ISO 交付有硬顺序：体系文件没定稿 → 内审做不了 →
                                    管理评审开不了 → 不能报认证。这个顺序原来只在顾问脑子里，
                                    新人接手就断了。

                                    只给单选：真实的交付流程基本是一条线，
                                    多选的界面代价换不来对应的信息量。模型本身支持多个。
                                  */}
                                  {(project.tasks || []).length > 1 && (
                                    <select
                                      title="选一个必须先做完的任务。前置没做完时会提醒，但不拦你"
                                      className="min-w-0 flex-shrink bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                      value={(task.dependsOn || [])[0] || ''}
                                      onChange={e => updateProjectTask(project.id, task.id, { dependsOn: e.target.value ? [e.target.value] : [] })}
                                    >
                                      <option value="">无前置</option>
                                      {(project.tasks || [])
                                        .filter(t => canBePrerequisite(t, task, project.tasks || []))
                                        .map(t => (
                                          <option key={t.id} value={t.id}>先做：{t.title.slice(0, 12)}</option>
                                        ))}
                                    </select>
                                  )}
                                  <span
                                    className={`shrink-0 whitespace-nowrap text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
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
                               <TaskStatusControl
                                 task={task}
                                 allTasks={project.tasks || []}
                                 disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                                 onChange={(u) => updateProjectTask(project.id, task.id, u)}
                               />
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
                             {/*
                               2026-09-12 金恩来：「全屏显示下有BUG，排版和显示都有问题」

                               实测 1400/1500/1600 三个常见笔记本宽度下，
                               「核心」这个徽标被压成 21×44 —— 一个字一行，竖着叠，
                               和旁边的下拉框糊在一起。2000 宽反而正常，
                               所以我第一次按 2000 验，没验出来。

                               原因是这一行里三样东西抢宽度：日期 + 两个 140px 的下拉框
                               + 徽标，加起来超过卡片内宽，而徽标是唯一没设 shrink-0 的，
                               于是全由它让位。现在：徽标不许缩、下拉框可以缩、
                               真放不下就换行 —— 三条缺一不可。
                             */}
                             <div className="flex flex-wrap justify-between items-center gap-y-2">
                                <div className="flex items-center text-[10px] font-mono text-gray-400">
                                   <Timer className={`w-3 h-3 mr-1 ${isOverdue ? 'text-red-500' : ''}`} />
                                   <input type="date" className="bg-transparent focus:outline-none" value={task.deadline} onChange={e => changeTaskDeadline(project, task, e.target.value)} />
                                </div>
                                <div className="flex items-center gap-2">
                                  {serviceItems.length > 0 && (
                                    <select
                                      className="min-w-0 flex-shrink bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                      value={task.serviceItemId || ''}
                                      onChange={e => updateProjectTask(project.id, task.id, { serviceItemId: e.target.value || undefined })}
                                    >
                                      <option value="">未归属</option>
                                      {serviceItems.map(si => (
                                        <option key={si.id} value={si.id}>{si.name}</option>
                                      ))}
                                    </select>
                                  )}
                                  {/*
                                    前置任务。
                                    ISO 交付有硬顺序：体系文件没定稿 → 内审做不了 →
                                    管理评审开不了 → 不能报认证。这个顺序原来只在顾问脑子里，
                                    新人接手就断了。

                                    只给单选：真实的交付流程基本是一条线，
                                    多选的界面代价换不来对应的信息量。模型本身支持多个。
                                  */}
                                  {(project.tasks || []).length > 1 && (
                                    <select
                                      title="选一个必须先做完的任务。前置没做完时会提醒，但不拦你"
                                      className="min-w-0 flex-shrink bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
                                      value={(task.dependsOn || [])[0] || ''}
                                      onChange={e => updateProjectTask(project.id, task.id, { dependsOn: e.target.value ? [e.target.value] : [] })}
                                    >
                                      <option value="">无前置</option>
                                      {(project.tasks || [])
                                        .filter(t => canBePrerequisite(t, task, project.tasks || []))
                                        .map(t => (
                                          <option key={t.id} value={t.id}>先做：{t.title.slice(0, 12)}</option>
                                        ))}
                                    </select>
                                  )}
                                  <span
                                    className={`shrink-0 whitespace-nowrap text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
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
                         <TaskStatusControl
                           task={task}
                           allTasks={project.tasks || []}
                           disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                           onChange={(u) => updateProjectTask(project.id, task.id, u)}
                         />
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
                             <input type="date" className="bg-transparent focus:outline-none" value={task.deadline} onChange={e => changeTaskDeadline(project, task, e.target.value)} />
                          </div>
                          <div className="flex items-center gap-2">
                            {serviceItems.length > 0 && (
                              <select
                                className="min-w-0 flex-shrink bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-black text-gray-600 outline-none max-w-[140px]"
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
                              className={`shrink-0 whitespace-nowrap text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
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
                  <p className="text-sm font-bold">还没有任务</p>
                  <p className="mt-1.5 text-xs font-bold leading-relaxed text-gray-400">
                    多数情况不用手加 —— 到上面「服务项」里选一项客户买的服务，
                    任务会按标准流程自动带出来。真的没有对应服务项，再点「+」手加。
                  </p>
               </div>
             )}
           </div>
        </div>

        <div data-onboard="work-log" className="order-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="font-black text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-600" />
                工作日志 · 今天实际做了什么
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
           {/*
             标题必须和左边导航一模一样（2026-09-08 改）。

             原来导航写「项目管理」、页面标题写「交付工作台」，
             而首页又叫「工作台」—— 三个名字打架。
             标题和导航对不上时，人的第一反应是「我是不是点错了」。
           */}
           <h1 className="text-2xl font-bold text-gray-900">项目管理</h1>
           <p className="text-sm text-gray-500 mt-1">
             <span className="font-bold text-gray-700">按「事」看：</span>
             一个项目的全貌 —— 要做哪几样、做到哪了、谁负责、钱收没收。
             想知道自己今天先干哪件，去
             <button
               type="button"
               onClick={() => navigate('/my-tasks')}
               className="mx-1 font-bold text-indigo-600 hover:underline"
             >
               我的任务
             </button>
             。
           </p>
        </div>
        {/*
          按权限显示（2026-09-07）。

          顾问没有 PROJECT_CREATE —— 项目由总助或总经理立项，顾问执行，
          这个分工本身是对的。错的是原来照样把按钮摆在那里：
          他填完整张表、点了「确认立项」、列表里也出现了，
          服务端却返回 403，前端只在控制台打了一行 warn。
          刷新之后项目消失 —— 他会以为系统把数据弄丢了。

          **点不动的按钮不该出现。**
        */}
        {canCreateProject && (
          <button onClick={openCreateModal} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95 font-bold text-sm"><Plus className="w-4 h-4 mr-2" /> 新建项目</button>
        )}
      </div>

      {createdNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-sm font-bold text-emerald-800">{createdNotice}</p>
          <button onClick={() => setCreatedNotice('')} className="ml-auto shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/*
        概览卡片：数字随「与我相关 / 全公司」变，点击直接切到对应筛选。
        四张全部数「项目」—— 理由见上面 isDueSoonProject 附近的说明。
      */}
      <StatGrid className="mb-6">
        <StatCard
          icon={<Briefcase className="w-6 h-6" />}
          value={overviewStats.active}
          label={TERM_PROJECT.active}
          tone="blue"
          selected={filterStatus === 'Active'}
          onClick={() => selectOverview('Active')}
          title="我手上还在跑的项目。点击只看进行中的"
        />
        <StatCard
          icon={<Clock className="w-6 h-6" />}
          value={overviewStats.dueSoon}
          label={TERM_PROJECT.dueSoon}
          tone="amber"
          selected={filterStatus === 'DueSoon'}
          onClick={() => selectOverview('DueSoon')}
          title="七天内交期到、或名下有任务七天内到期的项目 —— 这一档还来得及"
        />
        <StatCard
          icon={<AlertTriangle className="w-6 h-6" />}
          value={overviewStats.withOverdue}
          label={TERM_PROJECT.withOverdueTask}
          emphasis="danger"
          selected={filterStatus === 'Overdue'}
          onClick={() => selectOverview('Overdue')}
          title="进行中、且名下有任务过了截止日的项目。点开看具体卡在哪一条"
        />
        <StatCard
          icon={<HelpCircle className="w-6 h-6" />}
          value={overviewStats.needsSetup}
          label={TERM_PROJECT.needsSetup}
          tone="indigo"
          selected={filterStatus === 'NeedsSetup'}
          onClick={() => selectOverview('NeedsSetup')}
          title="缺负责人／还没排任务／交付类缺金额 —— 这些项目不会逾期也不会报错，会安静地烂掉"
        />
      </StatGrid>

      {/*
        ── 筛选条：三组下拉放一起（2026-09-07 重做）────────────────

        原来是 9 个同样大小、同样加粗的按钮横铺一排，
        金恩来：「弄一堆按钮在上面也挺抢重点的……是不是把这三组内容
        放一起会好一些。」

        改动有三处：
        ① 三组收成三个下拉，收起来只显示当前选中的那一档，
           「范围：与我相关」自己就是一句话，不用去按钮堆里找哪个亮着；
        ② 三组挨在一起、共用一个「筛选」标签，看得出它们是一类东西
           （原来状态和类别在左、范围被挤到搜索框右边，像两个功能）；
        ③ 默认全开，见上面 modeScope 处的说明。
      */}
      <div data-guide-id="project-filters" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="状态" value={filterStatus} onChange={v => setFilterStatus(v)} options={projectStatusFilters} />
            <FilterSelect label="类别" value={modeScope} onChange={v => setModeScope(v)} options={categoryFilters} />
            <FilterSelect label="范围" value={viewScope} onChange={v => setViewScope(v)} options={SCOPE_FILTERS} />
            {(filterStatus !== 'All' || modeScope !== 'all' || viewScope !== 'related' || searchTerm.trim()) && (
              <button
                type="button"
                onClick={() => { setFilterStatus('All'); setModeScope('all'); setViewScope('related'); setSearchTerm(''); setDashboardFocus(null); setDashboardFocusLabel(''); }}
                className="px-2.5 py-2 rounded-lg text-xs font-bold text-gray-400 hover:text-gray-700 hover:bg-gray-50"
              >
                重置筛选
              </button>
            )}
          </div>
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="搜索项目…" className="w-full md:w-64" />
        </div>
        {/* 条数随筛选实时算，和列表永远一致——避免"徽标说 13、列表只给 1 条" */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-50 text-[11px] text-gray-500">
          <span>
            {SCOPE_FILTERS.find(o => o.value === viewScope)?.label}
            ・{categoryFilters.find(o => o.value === modeScope)?.label}
            ・{projectStatusFilters.find(o => o.value === filterStatus)?.label}
          </span>
          <span className="font-bold text-gray-700">{filterStatus === 'Overdue' ? `共 ${filteredProjects.reduce((n, p) => n + (p.tasks || []).filter(isOverdueTask).length, 0)} 项逾期任务 · 涉及 ${filteredProjects.length} 个项目` : `共 ${filteredProjects.length} 个项目`}</span>
        </div>

        {/*
          「与我相关」是默认值，而默认值最容易把人骗了：
          总经理、总助多半不亲自当项目负责人，一进来就是空的 ——
          空白页不会告诉他「不是没有项目，是你在看自己的那一档」。
          所以这一行只在「我的是 0、公司的不是 0」时出现，并直接给按钮。
        */}
        {viewScope === 'related' && filteredProjects.length === 0 && companyWideCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>你名下没有符合条件的项目，全公司还有 {companyWideCount} 个。</span>
            <button
              type="button"
              onClick={() => setViewScope('all')}
              className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-amber-700"
            >
              看全公司
            </button>
          </div>
        )}

        {dashboardFocusLabel && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
              工作台焦点：{dashboardFocusLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                // 清焦点 = 回到默认那一套，和「重置筛选」保持一致
                setDashboardFocus(null);
                setDashboardFocusLabel('');
                setSearchTerm('');
                setFilterStatus('All');
                setModeScope('all');
                setTaskViewMode('grouped');
                setViewScope('related');
              }}
              className="text-xs font-bold text-gray-500 hover:text-gray-700"
            >
              清除焦点
            </button>
          </div>
        )}
      </div>

      {filterStatus === 'Overdue' ? <div data-testid="overdue-task-results" className="rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-100">
        <h2 className="px-4 py-3 font-bold text-gray-900">有逾期任务的项目</h2>
        {filteredProjects.flatMap(project => (project.tasks || []).filter(isOverdueTask).map(task => <button key={project.id + ':' + task.id} type="button" onClick={() => { selectOverview('All'); openProject(project.id); }} className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between gap-4">
          <div><p className="font-bold text-gray-900">{task.title}</p><p className="mt-1 text-xs text-gray-500">{project.name} · 负责人：{task.owner || project.manager}</p></div>
          <div className="shrink-0 text-xs text-red-600">截止 {task.deadline}<span className="block mt-1 text-blue-600">查看所属项目 →</span></div>
        </button>))}
        {filteredProjects.length === 0 && <p className="p-6 text-sm text-gray-500">当前范围没有有逾期任务的项目。</p>}
      </div> : (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Mobile Card View */}
        <div className="block md:hidden">
          <SampleList items={filteredProjects} sample={SAMPLE_PROJECT} render={project => (
            /*
              ── 只有摘要那一块负责展开/折叠（2026-09-12）──────────────

              金恩来：「在中等屏幕尺寸下……点击添加服务项目或者服务流水，
              都会自动弹出到上一级界面」。

              原因是**展开的详情原来就长在这个 onClick 容器里面**：
              点详情里的任何东西，事件都冒泡到外层，把它自己折叠掉。
              于是这一档宽度下，项目详情里**什么都点不了** ——
              加服务项、记日志、改任务，点一下就退回列表。

              桌面表格版没这个毛病，因为那边详情是独立的一行（兄弟节点）。
              **同一个功能两套结构，只有一套是对的** —— 这个项目的老毛病。
              现在手机版也改成兄弟节点，和桌面对齐。

              没有用 stopPropagation 收场：那只是把冒泡按住，
              详情里以后每加一个控件都得记得别漏。结构摆对，这类问题不会再有。
            */
            <div key={project.id} className="border-b border-gray-100">
             <div
               role="button"
               tabIndex={0}
               aria-expanded={expandedProject === project.id}
               className="p-4 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors"
               onClick={() => toggleProject(project.id)}
               onKeyDown={e => {
                 if (e.key === 'Enter' || e.key === ' ') {
                   e.preventDefault();
                   toggleProject(project.id);
                 }
               }}
             >
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
             </div>
              {/* 详情是兄弟节点，不在上面那个可点击块里面 —— 点它不会折叠 */}
              {expandedProject === project.id && (
                <div className="px-4 pb-4 pt-4 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200">
                  {renderProjectDetail(project)}
                </div>
              )}
            </div>
          )} />
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
                {/*
                  样例行：新人第一次进来这张表是空的，
                  引导说「点开一个项目，里面是任务清单」而他根本没有项目可点。
                  对着一条具体的行讲才记得住 —— 哪一列是客户、
                  哪一列是下一步、红色表示什么。
                */}


                <SampleList items={filteredProjects} sample={SAMPLE_PROJECT} render={project => (
                    <React.Fragment key={project.id}>
                        <tr className={`hover:bg-gray-50/80 cursor-pointer transition-colors ${expandedProject === project.id ? 'bg-indigo-50/30' : ''}`} onClick={() => toggleProject(project.id)}>
                            <td className="pl-4 text-gray-300">
                              {expandedProject === project.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                            <td className={tdClass}>
                              <div className="font-bold text-gray-900 line-clamp-1">{project.name}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-gray-500 line-clamp-1">
                                  {resolveProjectCustomerName(project)}
                                </span>
                                {/*
                                  类别徽章接到这里（2026-09-08）。
                                  在这之前 getCategoryBadge 是**定义了从来没调用**的死代码 ——
                                  也就是说列表上一直看不出一个项目是哪一类。
                                  分类讲不清，有一半原因是它压根没显示出来过。
                                */}
                                {getCategoryBadge(project)}
                              </div>
                            </td>
                            <td className={tdClass}>
                              {(() => {
                                /*
                                  缺信息的先说缺什么（2026-09-15 加）。

                                  「待补信息」那张卡点进来，人得知道每一行到底缺哪一样 ——
                                  否则卡片说有 3 个，列表给 3 行，他还得一个个点开找。
                                  缺负责人／没排任务／缺金额，直接写在这一列上。
                                */
                                const gaps = setupGaps(project);
                                if (gaps.length) return (
                                  <div className="flex flex-wrap gap-1">
                                    {gaps.map(g => <Badge key={g} tone="amber">{g}</Badge>)}
                                  </div>
                                );
                                const next = getNextTask(project);
                                if (!next) return <span className="text-xs text-gray-400">{
                                  !(project.tasks || []).length ? '尚未安排任务' :
                                  project.tasks.some(t => t.status === 'Skipped') ? '无待办任务（含已跳过）' : '所有任务已完成'
                                }</span>;
                                const overdue = isOverdueTask(next);
                                return (
                                  <div className="min-w-0">
                                    <div className="text-sm font-bold text-gray-800 line-clamp-1">{next.title}</div>
                                    <div className="mt-1 flex items-center gap-2">
                                      {overdue
                                        ? <Badge tone="red">已逾期</Badge>
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
                )} />
            </tbody>
        </table>
      </div>
      </div>

      )}

      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
              {/*
                ── 弹窗必须能滚，按钮必须永远够得到（2026-09-08）────────

                加了「收不收钱」和「系统归为…」两段之后，弹窗在
                1280x720 的笔记本上超出了屏幕，**「确认立项」被挤到看不见**，
                实测点不到 —— 表单填完了提交不了，比表单难用严重得多。

                和新手引导那次是同一个教训：**内容会长，屏幕不会**。
                所以不再赌高度：整体限高到视口的 90%，正文自己滚，
                标题和底部按钮各自 shrink-0 固定住。
              */}
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-300 border border-gray-100">
                  <div className="flex justify-between items-center shrink-0 px-8 pt-8 pb-4">
                      <h2 className="text-2xl font-black text-gray-900">极速立项</h2>
                      <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-6 h-6 text-gray-400"/></button>
                  </div>
                  <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-8">
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">项目名称</label>
                          <input required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="例如：某某工厂ISO认证咨询" />
                      </div>

                      <div>
                          {/*
                            服务类型：**选，不是猜**。

                            ── 为什么加这个（2026-09-11）────────────────────────────
                            金恩来：「这个名称没有固定规范大家怎么写的可能都有，这也是问题」

                            他说中了。原来是从项目名里猜服务类型，而生产上
                            10 份合同有 10 种写法（`SC食品生产许可证` / `SC 食品生产许可`…），
                            靠猜必然不准 —— 而猜错的代价是把活推荐给不对的人。

                            让人选一下，两件事同时解决：
                              · 推荐有了可靠依据，项目名怎么写都行
                              · 服务类型这个字段终于有了规范值，
                                「同服务做过就能复用」的检索才查得出来
                          */}
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                            服务类型 <span className="ml-1 font-bold normal-case tracking-normal text-gray-400">（决定建议谁来做）</span>
                          </label>
                          <select
                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            value={String((formData as any).serviceGroup || '')}
                            onChange={e => setFormData({ ...formData, serviceGroup: e.target.value } as any)}
                          >
                            <option value="">— 选一个（不选就按项目名猜，可能不准）—</option>
                            {SERVICE_GROUPS.filter(g => g !== '未分类').map(g => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                      </div>
                      {/*
                        ══════════════════════════════════════════════════
                        不让人选类别，只问两句话（2026-09-08 重做）
                        ══════════════════════════════════════════════════

                        前两版都是「三选一挑类别」，而分类轴选错了：
                        我把「有没有客户 / 收不收钱 / 有没有合同」压进一个字段，
                        于是「台账指导：有客户、收钱、没合同」三类都装不下。

                        金恩来 2026-09-08：「有些项目小比如台账指导可能就没有
                        签合同，或者有些项目是先执行，后补合同。」

                        现在只问两个他脑子里本来就有答案的问题，
                        类别由系统推 —— 他不用学我的分类法。
                      */}

                      {/* 问题一：这活给谁做？ */}
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">这活给谁做？</label>
                          <div className="space-y-2">
                            <label className={`flex items-start gap-3 rounded-2xl border-2 p-3 cursor-pointer transition-colors ${hasCustomer ? 'border-indigo-500 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                              <input
                                type="radio" name="who" className="mt-1 accent-indigo-600"
                                checked={hasCustomer}
                                onChange={() => setFormData({ ...formData, projectCategory: 'Delivery' as any })}
                              />
                              <span className="flex-1 min-w-0">
                                <span className="block text-sm font-black text-gray-900">某个客户</span>
                                {hasCustomer && (
                                  <span className="mt-2 block">
                                    <select
                                      required
                                      className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                      value={String(formData.customerId || '')}
                                      onChange={e => setFormData({ ...formData, customerId: e.target.value })}
                                    >
                                      <option value="">请选择客户</option>
                                      {customers.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                    </select>

                                    {/*
                                      ── 搜不到就当场建，不用先跑去客户管理 ──────────

                                      金恩来 2026-09-08：「那是不是意味着要建立项目先要
                                      创建客户，然后再去录入合同，最后再来创建项目？
                                      要建立一个项目准备工作有点多。」

                                      CRM 里这个问题的标准答案不是调整流程顺序，
                                      是**在原地建**（Dynamics 叫 Quick Create）：
                                      输个名字就够，详细资料以后在客户管理里补。
                                      为了建 A 必须先离开去建 B —— 那一步才是真正劝退人的地方。
                                    */}
                                    {!showNewCustomer ? (
                                      <button
                                        type="button"
                                        onClick={() => setShowNewCustomer(true)}
                                        className="mt-2 text-[11px] font-bold text-indigo-600 hover:underline"
                                      >
                                        + 找不到？直接新建客户
                                      </button>
                                    ) : (
                                      <span className="mt-2 flex gap-2">
                                        <input
                                          autoFocus
                                          value={newCustomerName}
                                          onChange={e => setNewCustomerName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateCustomer(); } }}
                                          placeholder="公司全称，例如：温州XX包装有限公司"
                                          className="flex-1 min-w-0 bg-white border border-indigo-300 rounded-xl p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                        />
                                        <button
                                          type="button"
                                          onClick={handleQuickCreateCustomer}
                                          className="shrink-0 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white hover:bg-indigo-700"
                                        >
                                          创建并选中
                                        </button>
                                      </span>
                                    )}
                                    {customerNotice && (
                                      <span className="mt-2 block rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold leading-relaxed text-indigo-800">
                                        {customerNotice}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </span>
                            </label>

                            <label className={`flex items-start gap-3 rounded-2xl border-2 p-3 cursor-pointer transition-colors ${!hasCustomer ? 'border-slate-500 bg-slate-50' : 'border-gray-200 hover:border-gray-300'}`}>
                              <input
                                type="radio" name="who" className="mt-1 accent-slate-600"
                                checked={!hasCustomer}
                                onChange={() => setFormData({ ...formData, projectCategory: 'Public' as any, customerId: '', contractRef: '', billable: false })}
                              />
                              <span>
                                <span className="block text-sm font-black text-gray-900">不涉及客户</span>
                                <span className="mt-0.5 block text-[11px] font-bold text-gray-500">政府交办、行业活动、内部建设、员工培训</span>
                              </span>
                            </label>
                          </div>
                      </div>

                      {/* 问题二：收不收钱。不涉及客户时这一问没有意义，整个不显示 */}
                      {hasCustomer && (
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">这活收不收钱？</label>
                          <div className="grid grid-cols-2 gap-2">
                            <label className={`rounded-2xl border-2 p-3 cursor-pointer transition-colors ${billable ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}>
                              <span className="flex items-center gap-2">
                                <input type="radio" name="billable" className="accent-emerald-600" checked={billable}
                                  onChange={() => setFormData({ ...formData, billable: true })} />
                                <span className="text-sm font-black text-gray-900">收</span>
                              </span>
                              <span className="mt-1 block text-[11px] font-bold text-gray-500">做完算营收</span>
                            </label>
                            <label className={`rounded-2xl border-2 p-3 cursor-pointer transition-colors ${!billable ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'}`}>
                              <span className="flex items-center gap-2">
                                <input type="radio" name="billable" className="accent-amber-600" checked={!billable}
                                  onChange={() => setFormData({ ...formData, billable: false, projectAmount: undefined })} />
                                <span className="text-sm font-black text-gray-900">不收</span>
                              </span>
                              <span className="mt-1 block text-[11px] font-bold text-gray-500">免费维护、售后支持</span>
                            </label>
                          </div>
                          {billable && (
                            <div className="mt-2">
                              <input
                                type="number" min={0}
                                value={formData.projectAmount ?? ''}
                                onChange={e => setFormData({ ...formData, projectAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
                                placeholder="金额（元）—— 现在不知道可以先空着，结项前补上"
                                className="w-full bg-gray-50 border-none rounded-2xl p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                            </div>
                          )}
                      </div>
                      )}

                      {/* 合同永远可选。它是挂件，不是前提 */}
                      {hasCustomer && (
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                            关联合同 <span className="text-gray-400 normal-case tracking-normal">（可以先空着，签了再来补）</span>
                          </label>
                          <select
                            className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            value={String(formData.contractRef || '')}
                            onChange={e => setFormData({ ...formData, contractRef: e.target.value })}
                          >
                            <option value="">暂无合同</option>
                            {contracts
                              .filter(c => !formData.customerId || c.customerId === formData.customerId)
                              .map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.contractNo ? `${c.contractNo} · ` : ''}{c.title}（¥{Number(c.amount || 0).toLocaleString()}）
                                </option>
                              ))}
                          </select>
                          <p className="text-[11px] text-gray-400 mt-2">
                            没签、口头约定、先干后补都选「暂无合同」—— 系统不会因此拦你。
                            收钱的项目缺合同会进财务的「缺合同」提醒，是提醒，不是关卡。
                          </p>
                      </div>
                      )}

                      {/* 系统把这活归成什么，当场告诉他，别等建完了才发现分错 */}
                      <div className="flex items-start gap-2 rounded-2xl bg-gray-50 px-4 py-3">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                        <p className="text-[12px] font-bold leading-relaxed text-gray-600">
                          系统归为「<span className="text-gray-900">{PROJECT_CATEGORY_META[derivedCategory].label}</span>」
                          {hasCustomer
                            ? (billable ? '，做完算营收。' : '，不计营收，但工时照常记。')
                            : '，不涉及钱，但有人、有进度、有工时。'}
                          {hasCustomer && billable && !hasContract(formData as any) && (
                            <span className="text-amber-700">　暂无合同，会出现在财务的「缺合同」提醒里。</span>
                          )}
                        </p>
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
                                  <option key={name} value={name}>
                                    {name === myName ? `${name}（我自己）` : name}
                                  </option>
                                ))}
                              </select>

                              {/*
                                ── 建议怎么出现（2026-09-11 重做）──────────────────────

                                金恩来：「我用梁杰的号登录准备建总经理已经分配给我的项目，
                                建的时候看见下面提醒我说我的同事还没有项目，要不要分配给他，
                                会不会有些奇怪」

                                他是对的，我原来把对象搞错了：**建议是给派活的人看的，
                                不是给干活的人看的**。活已经是他的了，还提示"要不要给别人"，
                                既莫名其妙，又可能让已经认领的同事看了不舒服。

                                查了同类工具，做法一致：Jira 的负责人建议**藏在下拉框里**
                                （点开才看到）；PSA 类工具是「系统提候选 → 交付负责人确认」，
                                推荐对象都是派活的那个人。

                                所以改成两档：

                                ① 日常建议 —— **默认收起，点一下才展开**（拉取式）
                                   干活的人不会被打扰；派活的人想看随时点开。

                                ② 抢客户提醒 —— **主动弹，而且措辞不同**
                                   「这家客户的 XX 以前是 XX 做的，确认要换人吗？」
                                   这是**提醒**不是建议：它只在真的可能抢客户时出现，
                                   所以不会变成日常噪音，而该拦的那一次一定拦得住。
                              */}
                              {ownerSuggestion.outsourced ? (
                                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-amber-800">
                                  {ownerSuggestion.note}
                                </p>
                              ) : (
                                <>
                                  {/* ② 抢客户：主动弹，且只在"以前是别人做的"时出现 */}
                                  {ownerSuggestion.previousOwner
                                    && ownerSuggestion.previousOwner !== String(formData.manager || '').trim() && (
                                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                                      <p className="text-[11px] font-black leading-relaxed text-amber-900">
                                        这家客户的「{ownerSuggestion.serviceGroup}」以前是
                                        <span className="mx-1 underline">{ownerSuggestion.previousOwner}</span>
                                        做的 —— 确认要换人吗？
                                      </p>
                                      <p className="mt-1 text-[11px] font-bold text-amber-700">
                                        {/* 不写「他/她」—— 这里会填进真人姓名，猜错性别是实打实的冒犯 */}
                                        续期、复审、加体系一般回原来那个人手上，对这家厂的情况熟。
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, manager: ownerSuggestion.previousOwner as string })}
                                        className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-amber-700"
                                      >
                                        还是给 {ownerSuggestion.previousOwner}
                                      </button>
                                    </div>
                                  )}

                                  {/* ① 日常建议：收起，点了才展开 */}
                                  {ownerSuggestion.candidates.length > 0 && (
                                    <details className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60">
                                      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-bold text-gray-500">
                                        拿不准派给谁？看看建议（{ownerSuggestion.candidates.length} 个人选）
                                      </summary>
                                      <div className="space-y-2 px-3 pb-2.5">
                                        {ownerSuggestion.candidates.map((c, i) => (
                                          <div key={c.name} className={i === 0 ? '' : 'border-t border-gray-200 pt-2'}>
                                            <div className="flex items-center justify-between gap-2">
                                              <p className="text-[11px] font-black text-gray-800">
                                                {c.name}
                                                <span className="ml-1.5 font-bold text-gray-400">手上 {c.activeProjects} 个在制</span>
                                              </p>
                                              <button
                                                type="button"
                                                onClick={() => setFormData({ ...formData, manager: c.name })}
                                                className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-indigo-700"
                                              >
                                                选他
                                              </button>
                                            </div>
                                            {/* 理由必须写出来 —— 没有理由的建议不叫建议，叫猜 */}
                                            <ul className="mt-1 space-y-0.5">
                                              {c.reasons.map(r => (
                                                <li key={r} className="text-[11px] font-bold leading-relaxed text-gray-500">· {r}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        ))}
                                      </div>
                                    </details>
                                  )}

                                  {ownerSuggestion.candidates.length === 0 && ownerSuggestion.note && (
                                    <p className="mt-2 text-[11px] font-bold leading-relaxed text-gray-400">
                                      {ownerSuggestion.note}
                                    </p>
                                  )}
                                </>
                              )}
                          </div>
                          <div>
                              {/*
                                谁来做：自己做 / 外包 / 合作。

                                金恩来 2026-09-11：「第三方服务各类服务都有。」
                                所以这**不是服务类型的属性**，是每一单自己的属性 ——
                                体系认证也可能外包，同一类里这单外包下单自己做。

                                用的是系统里早就有的 ProjectType（配套还有 vendorName、
                                purchasingCost），不另造一套布尔值 ——
                                同一件事两套模型是这个项目栽过最多次的地方。
                                它此前一直硬编码成 Self-Operated，没有任何界面能选，
                                所以形同虚设，我差点因此又造一套。
                              */}
                              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">谁来做</label>
                              <select
                                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                value={formData.projectType || 'Self-Operated'}
                                onChange={e => setFormData({ ...formData, projectType: e.target.value as any })}
                              >
                                {(Object.keys(PROJECT_TYPE_META) as (keyof typeof PROJECT_TYPE_META)[]).map(k => (
                                  <option key={k} value={k}>{PROJECT_TYPE_META[k].label}</option>
                                ))}
                              </select>
                              <p className="mt-1 text-[11px] font-bold text-gray-400">
                                {PROJECT_TYPE_META[(formData.projectType || 'Self-Operated') as keyof typeof PROJECT_TYPE_META].hint}
                              </p>
                          </div>
                      </div>

                      {/*
                        合作方只在外包/合作时才出现 —— 自己做的活问「合作方是谁」是噪音。
                        但一旦选了外包，它就是**必填**：
                        没有合作方，「这活谁做的」这条链就断在这里，
                        而那正是这个系统最不能断的一条链。
                      */}
                      {formData.projectType !== 'Self-Operated' && (
                        <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                            合作方{formData.projectType === 'Outsourced' && <span className="ml-1 text-red-500">必填</span>}
                          </label>
                          <input
                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            placeholder="哪家单位做的 —— 将来查「这活谁做的」全靠它"
                            value={String((formData as any).vendorName || '')}
                            onChange={e => setFormData({ ...formData, vendorName: e.target.value } as any)}
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">交付周期(天)</label>
                              <input type="number" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none" value={formData.duration} onChange={e => setFormData({...formData, duration: Number(e.target.value)})} />
                          </div>
                      </div>
                    </div>
                    {/* 按钮那一条不参与滚动 —— 内容再长也永远在屏幕上 */}
                    <div className="flex shrink-0 justify-end space-x-3 border-t border-gray-100 px-8 py-5">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-gray-400">取消</button>
                        <button disabled={creating} type="submit" className="px-10 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all active:scale-95">确认立项</button>
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
