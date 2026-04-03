
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Status, Project, ProjectTask, Receivable, TaskTemplate, ServiceCatalogItem, ServiceCategory, ProjectWorkLog } from '../types';
import { SERVICE_CATALOG, SERVICE_CATEGORIES, SERVICE_CATEGORY_DELIVERY_MODE, DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY } from '../constants';
import { 
  Briefcase, Search, Plus, Clock, AlertTriangle, 
  CheckCircle, ChevronDown, ChevronRight, DollarSign, Bell, 
  X, Wallet, PlayCircle, Sparkles, ShieldCheck, ArrowRight,
  ListTodo, Trash2, LayoutGrid, Timer, CheckCircle2, MoreHorizontal,
  Brain, RefreshCw
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveProjectCapabilities } from '../src/utils/projectCapabilities';
import { readGlobalSearchQuery } from '../src/modules/global_search';
import { TASK_STATUS, WORK_LOG_SOURCE } from '../src/constants/status.ts';

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
  const { projects, customers, contracts, marketSignals, projectWorkLogs, auditIssues, toggleReceivableStatus, addProject, assignProjectManager, updateProjectTask, deleteProjectTask, addProjectTask, applyTemplateToProject, addProjectServiceItem, updateProjectServiceItem, deleteProjectServiceItem, addProjectWorkLog, deleteProjectWorkLog, completeProject, reopenProject, updateProjectCost, convertIntelProjectToLead, bindFollowUpProjectToCustomer, taskTemplates, addTaskTemplate, updateTaskTemplate, deleteTaskTemplate, archiveTaskTemplate, cloneTaskTemplate, activeRole, currentUser, userProfiles, checkActionPermission, aiDecisionLogs, runProjectDiagnosis } = useApp();
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
  const isMineProject = (project: Project) => project.manager === currentUser.name || (project.tasks || []).some(task => String(task.owner || '') === currentUser.name);
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
    if (dashboardFocus.type === 'progress_lt_50') return project.status === Status.Active && Number(project.progress || 0) < 50;
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
  
  const filteredProjects = useMemo(() => projects
    .filter(p => {
      if (filterStatus === 'Active' && p.status === Status.Completed) return false;
      if (filterStatus === 'Completed' && p.status !== Status.Completed) return false;

      const capability = activeRole === 'CONSULTANT' ? { dataScope: 'OWN' } : { dataScope: 'ALL' };
      if (capability.dataScope === 'OWN' && !isMineProject(p)) return false;
      if (viewScope === 'related' && !isMineProject(p)) return false;
      if (!matchesProjectFocus(p)) return false;

      const q = searchTerm.trim();
      if (!q) return true;
      return p.name.includes(q) || p.manager.includes(q);
    }), [projects, filterStatus, activeRole, viewScope, searchTerm, dashboardFocus, currentUser.name, projectWorkLogs]);

  const getStatusBadge = (status: Status) => {
    switch(status) {
      case Status.Active: return <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">执行中</span>;
      case Status.Completed: return <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">已结项</span>;
      default: return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">{status}</span>;
    }
  };

  const getCategoryBadge = (category: any) => {
    if (category === 'FollowUp') return <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">跟进项目</span>;
    return <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded text-xs font-bold uppercase tracking-tight">交付项目</span>;
  };

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
    addProject({ ...formData, manager });
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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-8 animate-in slide-in-from-top duration-300">
        {canAssign && (
          <div className="flex justify-end pb-4 border-b border-gray-50">
            <button
              onClick={() => {
                setAssignProjectId(project.id);
                setAssignManager(assignableManagers.includes(project.manager) ? project.manager : (assignableManagers[0] || ''));
                setIsAssignModalOpen(true);
              }}
              className="px-3 py-2 text-xs font-black bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50"
            >
              指派负责人
            </button>
          </div>
        )}

        {/* AI 深度诊断面板 */}
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl border border-indigo-100 p-5 mb-8 relative overflow-hidden">
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
                    <div className="text-center py-6">
                        <p className="text-sm text-indigo-400 font-medium">暂无诊断记录，请点击上方按钮开始分析</p>
                    </div>
                )}
            </div>
        </div>

        {isIntelFollowUpProject && (
          <div className="bg-amber-50/70 rounded-2xl border border-amber-100 p-5 space-y-4">
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
                    onClick={() => {
                      const res = completeProject(project.id, { source: 'manual' });
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
        {projectCaps.showFinancePanel && (
        <div className="bg-gray-50/50 rounded-2xl border border-gray-100 p-4 md:p-6 space-y-6">
          
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
            <h3 className="font-black text-gray-900 flex items-center"> <Briefcase className="w-5 h-5 mr-2" /> 项目结算中心 </h3>
            <div className="flex gap-2 w-full md:w-auto">
              {project.status !== Status.Completed && (
                <button onClick={() => {
                  if (confirm('确定要完成该项目吗？系统将自动生成结果记录、更新客户状态并生成未来提醒。')) {
                    const res = completeProject(project.id, { source: 'manual' });
                    if (!res.ok) {
                      alert(res.reason || '操作失败');
                      return;
                    }
                    if (res.eventId) {
                      setUndoComplete({ projectId: project.id, eventId: res.eventId, expiresAt: Date.now() + 30_000 });
                    }
                  }
                }} className="w-full md:w-auto bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center hover:bg-blue-700 transition-all active:scale-95 shadow-md shadow-blue-200">
                  <CheckCircle className="w-4 h-4 mr-1.5" /> 标记完成
                </button>
              )}
              <button className="w-full md:w-auto bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center hover:bg-green-700 transition-all active:scale-95 shadow-md shadow-green-200">
                <PlayCircle className="w-4 h-4 mr-1.5" /> 发起结算
              </button>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex justify-between text-sm"> <span className="text-gray-400 font-bold">结算对象:</span> <span className="font-bold text-gray-900">{project.manager}</span> </div>
                <div className="flex justify-between text-sm"> <span className="text-gray-400 font-bold">规则类型:</span> <span className="font-bold text-gray-900">按回款比例提成</span> </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-50"> <span className="text-sm text-gray-400 font-bold">预估金额:</span> <span className="text-lg font-black text-indigo-600 font-mono">10%</span> </div>
                <p className="text-[10px] text-gray-300 italic">* 提示：点击发起结算即可生成应付单。</p>
             </div>
             <div className="space-y-3">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">回款明细（从）</p>

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
                        {r.status === 'paid' ? (
                          <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-full uppercase">已到账</span>
                        ) : (
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
                        )}
                      </div>
                    </div>
                  ))}
                  {receivables.length === 0 && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
                      <p className="text-xs font-bold text-gray-400">暂无回款节点</p>
                    </div>
                  )}
                </div>
             </div>
          </div>
        </div>
        )}

        {projectCaps.showServicePanel && (
        <div className="bg-gray-50/50 rounded-2xl border border-gray-100 p-4 md:p-6">
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

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
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
            {projectAuditIssues.length === 0 && (
              <div className="py-8 text-center text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">
                <p className="text-sm font-bold">当前项目暂无关联不符合项，后续登记后会自动挂整改任务。</p>
              </div>
            )}
          </div>
        </div>

        {/* 核心新增：交付任务看板 */}
        <div className="space-y-6">
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
                           <div key={task.id} className={`p-4 rounded-2xl border transition-all hover:shadow-md group ${task.status === 'Completed' ? 'bg-gray-50/50 border-gray-100' : isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                             <div className="flex justify-between items-start mb-3">
                               <button onClick={() => updateProjectTask(project.id, task.id, { status: task.status === 'Completed' ? 'Pending' : 'Completed' })}>
                                 {task.status === 'Completed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <div className={`w-5 h-5 rounded-full border-2 ${isOverdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
                               </button>
                               <button onClick={() => deleteProjectTask(project.id, task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
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
                           <div key={task.id} className={`p-4 rounded-2xl border transition-all hover:shadow-md group ${task.status === 'Completed' ? 'bg-gray-50/50 border-gray-100' : isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                             <div className="flex justify-between items-start mb-3">
                               <button onClick={() => updateProjectTask(project.id, task.id, { status: task.status === 'Completed' ? 'Pending' : 'Completed' })}>
                                 {task.status === 'Completed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <div className={`w-5 h-5 rounded-full border-2 ${isOverdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
                               </button>
                               <button onClick={() => deleteProjectTask(project.id, task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
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
                     <div key={task.id} className={`p-4 rounded-2xl border transition-all hover:shadow-md group ${task.status === 'Completed' ? 'bg-gray-50/50 border-gray-100' : isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                       <div className="flex justify-between items-start mb-3">
                         <button onClick={() => updateProjectTask(project.id, task.id, { status: task.status === 'Completed' ? 'Pending' : 'Completed' })}>
                           {task.status === 'Completed' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <div className={`w-5 h-5 rounded-full border-2 ${isOverdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
                         </button>
                         <button onClick={() => deleteProjectTask(project.id, task.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
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

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
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
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs font-bold text-amber-800">
              当前项目还没有服务项/任务。请先在上方创建服务项或任务后再录入日志，避免“纯文字日报”。
            </div>
          )}

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
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <input
                className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 outline-none"
                value={draft.nextPlan}
                onChange={e => patchWorkLogDraft(project.id, { nextPlan: e.target.value })}
                placeholder="明日计划（可选）"
              />
              <button
                onClick={submitWorkLog}
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:bg-gray-300"
                disabled={!canWriteStructuredLog}
              >
                提交日志
              </button>
            </div>
          </div>

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
              const canDelete = log.operatorUserId === currentUser.id || activeRole === 'ADMIN' || activeRole === 'MANAGER';
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
           <p className="text-sm text-gray-500 mt-1">项目立项中心：不强制关联合同，任务自动驱动进度</p>
        </div>
        <button onClick={openCreateModal} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all active:scale-95 font-bold text-sm"><Plus className="w-4 h-4 mr-2" /> 新建项目</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-2 w-full md:w-auto overflow-x-auto">
             <button onClick={() => setFilterStatus('Active')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterStatus === 'Active' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>进行中</button>
             <button onClick={() => setFilterStatus('Completed')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterStatus === 'Completed' ? 'bg-green-600 text-white shadow-md shadow-green-200' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>已完成</button>
             <button onClick={() => setFilterStatus('All')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${filterStatus === 'All' ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>全部项目</button>
          </div>
          
          <div className="flex items-center space-x-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input type="text" placeholder="搜索项目..." className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 bg-white outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              <div className="flex w-full md:w-auto justify-center md:justify-start items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              <button
                onClick={() => setViewScope('related')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewScope === 'related' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                与我相关
              </button>
              <button
                onClick={() => setViewScope('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewScope === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                全部项目
              </button>
            </div>
          </div>
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
                 <div className="flex items-center space-x-2">
                    <div className="w-16 bg-gray-100 rounded-full h-1 overflow-hidden">
                        <div className="bg-indigo-600 h-full transition-all" style={{width: `${project.progress}%`}}></div>
                    </div>
                    <span className="text-[10px] font-black font-mono text-gray-400">{project.progress}%</span>
                 </div>
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
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50/50 text-gray-600 font-bold text-sm uppercase tracking-wider border-b border-gray-100">
              <tr>
                <th className="w-10"></th>
                <th className="px-6 py-4">项目名称</th>
                <th className="px-6 py-4">负责人</th>
                <th className="px-6 py-4">任务进度</th>
                <th className="px-6 py-4">截止日期</th>
                <th className="px-6 py-4">类别</th>
                <th className="px-6 py-4">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {filteredProjects.map(project => (
                    <React.Fragment key={project.id}>
                        <tr className={`hover:bg-gray-50/80 cursor-pointer transition-colors ${expandedProject === project.id ? 'bg-indigo-50/30' : ''}`} onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}>
                            <td className="pl-4 text-gray-300"> {expandedProject === project.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} </td>
                            <td className="px-6 py-5 font-black text-gray-900 text-base">{project.name}</td>
                            <td className="px-6 py-5 font-bold text-gray-700">{project.manager}</td>
                            <td className="px-6 py-5">
                                <div className="flex items-center space-x-2">
                                    <div className="w-24 bg-gray-100 rounded-full h-1 overflow-hidden">
                                        <div className="bg-indigo-600 h-full transition-all" style={{width: `${project.progress}%`}}></div>
                                    </div>
                                    <span className="text-[10px] font-black font-mono">{project.progress}%</span>
                                </div>
                            </td>
                            <td className="px-6 py-5 text-gray-500 font-mono text-xs">{project.deadline}</td>
                            <td className="px-6 py-5">{getCategoryBadge((project as any).projectCategory)}</td>
                            <td className="px-6 py-5">{getStatusBadge(project.status)}</td>
                        </tr>
                        {expandedProject === project.id && (
                            <tr> <td colSpan={7} className="bg-gray-50/50 p-6"> {renderProjectDetail(project)} </td> </tr>
                        )}
                    </React.Fragment>
                ))}
            </tbody>
        </table>
      </div>
      </div>

      {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
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
                  value={assignManager}
                  onChange={e => setAssignManager(e.target.value)}
                >
                  {userProfiles
                    .filter(u => u.id !== 'AI-WORKER')
                    .map(u => (
                      <option key={u.id} value={u.name}>{u.name}</option>
                    ))}
                </select>
              </div>
              <div className="flex justify-end pt-2 space-x-3">
                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="px-6 py-3 font-bold text-gray-400">取消</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!assignProjectId) return;
                    const res = assignProjectManager(assignProjectId, assignManager);
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
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
    </div>
  );
};

export default Projects;
