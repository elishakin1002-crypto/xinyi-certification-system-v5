
import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { detectStandards, buildPdcaTitle } from '../src/modules/knowledge/standards';
import { Lead, Customer, Contract, ContractAttachment, Project, Settlement, Reminder, AuditIssue, Status, KnowledgeDoc, Vendor, ProjectTask, ServiceItem, RoleID, DashboardPersona, TaskTemplate, UserProfile, PermissionCode, FollowUpRecord, AuditNode, StrategicTask, Receivable, CertificateDetail, ProjectCategory, AIDecisionLog, AIAction, ActionCode, AIAllowedAction, AggregatedReminder, ReminderSeverity, ImportRecord, MarketSignal, ProjectWorkLog } from '../types';
import { MOCK_LEADS, MOCK_CUSTOMERS, MOCK_CONTRACTS, MOCK_PROJECTS, MOCK_SETTLEMENTS, MOCK_AUDITS, MOCK_DOCS, MOCK_VENDORS, TASK_TEMPLATES, DEFAULT_USER_PROFILE, DEFAULT_USER_PROFILES, ROLE_PERMISSIONS, SERVICE_WORKFLOW_TEMPLATES, DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY, SERVICE_CATEGORY_DELIVERY_MODE, SERVICE_CATALOG } from '../constants';
import { dataService } from '../services/dataService';
import { aiService } from '../services/aiService';
import { importService } from '../services/importService';
import { intelService } from '../services/intelService';
import { stateSyncService } from '../services/stateSyncService';
import { leadService } from '../services/leadService';
import { customerService } from '../services/customerService';
import { contractService } from '../services/contractService';
import { projectService, type ProjectTransactionDatasets } from '../services/projectService';
import { signalService } from '../services/signalService';
import { knowledgeService } from '../services/knowledgeService';
import { settlementService } from '../services/settlementService';
import { workLogService, taskTemplateService, auditIssueService } from '../services/batch5Service';
import { reminderService } from '../services/reminderService';
import { authService } from '../services/authService';
import { serializeWorldState } from '../services/dataSerializer';
import { buildDashboardMetrics, DashboardMetricsBundle } from '../services/dashboardMetrics';
import { seedDemoData } from '../services/demoDataSeeder';
import { ARCHIVE_STATUS, MARKET_SIGNAL_STATUS, TASK_STATUS, WORK_LOG_SOURCE } from '../src/constants/status.ts';
import { inferProjectMeta, resolveProjectCapabilities, buildDefaultServiceItem, attachTasksToDefaultService } from '../src/utils/projectCapabilities';
import { findDuplicateKnowledgeDoc } from '../src/utils/knowledgeDedupe';
import { checkRoleActionPermission } from '../src/utils/actionPermissions';

type CompleteProjectOptions = {
  source?: 'manual' | 'auto';
  tasksOverride?: ProjectTask[];
  projectWorkLogsOverride?: {
    next: ProjectWorkLog[];
    previous: ProjectWorkLog[];
    expectedLogId?: string;
  };
};

export interface AppContextType {
  leads: Lead[]; customers: Customer[]; contracts: Contract[]; projects: Project[];
  settlements: Settlement[]; reminders: Reminder[]; auditIssues: AuditIssue[];
  knowledgeDocs: KnowledgeDoc[]; vendors: Vendor[];
  marketSignals: MarketSignal[];
  projectWorkLogs: ProjectWorkLog[];
  importRecords: ImportRecord[]; // 新增：导入记录状态

  currentUser: UserProfile;
  userProfiles: UserProfile[];
  isAuthRequired: boolean;
  switchUser: (userId: string) => void;
  updateUserProfile: (userId: string, updates: Partial<UserProfile>) => void;
  addUserProfile: (profile: UserProfile) => void;
  deleteUserProfile: (userId: string) => void;
  activeRole: RoleID;
  setActiveRole: (role: RoleID) => void;
  activePersona: DashboardPersona;
  availablePersonas: DashboardPersona[];
  resolveDashboardPersona: (queryPersona?: string | null) => DashboardPersona;
  userPermissions: PermissionCode[];
  hasPermission: (permission: PermissionCode) => boolean;
  
  // 新增：智能助手动作权限校验
  checkActionPermission: (action: ActionCode, context?: any) => { allowed: boolean; reason?: string };

  visibleReminders: Reminder[];
  aggregatedReminders: AggregatedReminder[];
  dashboardMetrics: DashboardMetricsBundle;
  
  // 任务模版
  taskTemplates: TaskTemplate[];
  addTaskTemplate: (template: TaskTemplate) => void;
  updateTaskTemplate: (templateId: string, updates: Partial<TaskTemplate>) => { ok: boolean; reason?: string };
  deleteTaskTemplate: (templateId: string) => { ok: boolean; reason?: string };
  archiveTaskTemplate: (templateId: string, archived: boolean) => { ok: boolean; reason?: string };
  cloneTaskTemplate: (templateId: string, name?: string) => { ok: boolean; reason?: string; newTemplateId?: string };
  
  // 核心操作
  addProject: (p: AddProjectInput) => void;
  assignProjectManager: (projectId: string, manager: string, ownerUserId?: string) => { ok: boolean; reason?: string };
  createFollowUpProjectFromLead: (leadId: string, opts?: { owner?: string; expiryDate?: string }) => string | null;
  createFollowUpProjectFromCustomer: (customerId: string, opts?: { owner?: string; expiryDate?: string; certificateId?: string }) => string | null;
  updateProjectTask: (projectId: string, taskId: string, updates: Partial<ProjectTask>) => void;
  deleteProjectTask: (projectId: string, taskId: string) => void;
  addProjectTask: (projectId: string, task: Omit<ProjectTask, 'id'>) => void;
  applyTemplateToProject: (projectId: string, templateId: string) => void;
  addProjectServiceItem: (projectId: string, item: Omit<ServiceItem, 'id'>) => void;
  updateProjectServiceItem: (projectId: string, itemId: string, updates: Partial<ServiceItem>) => void;
  deleteProjectServiceItem: (projectId: string, itemId: string) => void;
  addProjectWorkLog: (payload: Omit<ProjectWorkLog, 'id' | 'source' | 'operatorUserId' | 'operatorName' | 'createdAt' | 'updatedAt'> & { source?: ProjectWorkLog['source'] }) => { ok: boolean; reason?: string };
  updateProjectWorkLog: (logId: string, updates: Partial<Pick<ProjectWorkLog, 'logDate' | 'workContent' | 'actualHours' | 'issueNote' | 'nextPlan'>>) => { ok: boolean; reason?: string };
  deleteProjectWorkLog: (logId: string) => { ok: boolean; reason?: string };

  addLead: (lead: Omit<Lead, 'id'>) => void;
  updateLead: (id: string, updates: Partial<Lead>) => void;
  importExcel: (file: File) => Promise<ImportRecord | null>; // 新增导入方法
  addLeadFollowUp: (leadId: string, record: Omit<FollowUpRecord, 'id'>) => void;

  addCustomer: (customer: Omit<Customer, 'id'>) => void;
  addCustomerFollowUp: (customerId: string, record: Omit<FollowUpRecord, 'id'>) => void;

  addContract: (
    contract: any,
    createProject?: boolean,
    fromLeadId?: string
  ) => {
    ok: boolean;
    reason?: string;
    existingContractId?: string;
    autoCreatedCustomerId?: string;
    autoCreatedCustomerName?: string;
  };
  bindContractToCustomer: (contractId: string, customerId: string) => { ok: boolean; reason?: string };
  deleteContract: (id: string) => void;
  archiveContract: (id: string) => void;
  addContractAttachment: (contractId: string, attachment: ContractAttachment) => { ok: boolean; reason?: string };
  removeContractAttachment: (contractId: string, attachmentId: string) => { ok: boolean; reason?: string };

  addAuditIssue: (issue: Omit<AuditIssue, 'id'>) => string;
  updateAuditIssue: (id: string, updates: Partial<AuditIssue>) => void;

  rejectReceivable: (contractId: string, receivableId: string, reason: string) => void;
  /** 销售报备已收款，推待办给财务核对；不改回款状态 */
  claimReceivablePaid: (contractId: string, receivableId: string, note?: string) => { ok: boolean; reason?: string };
  importSettlements: (items: Settlement[]) => void;
  updateSettlementStatus: (settlementId: string, status: Settlement['status']) => void;

  deleteKnowledgeDoc: (id: string) => void;
  updateKnowledgeDoc: (id: string, updates: Partial<KnowledgeDoc>) => void;
  backfillPdcaForPaidContracts: () => { scanned: number; created: number; updated: number; skipped: number };
  upsertMarketSignals: (signals: MarketSignal[]) => void;
  updateMarketSignal: (id: string, updates: Partial<MarketSignal>) => void;
  convertSignalToFollowUpProject: (signalId: string) => Promise<{ ok: boolean; projectId?: string; reason?: string }>;
  convertIntelProjectToLead: (projectId: string) => { ok: boolean; leadId?: string; reason?: string };
  bindFollowUpProjectToCustomer: (projectId: string, customerId: string) => { ok: boolean; reason?: string };

  strategicInsight: any;
  isAnalyzingStrategy: boolean;
  strategicTasks: StrategicTask[];
  runDeepAnalysis: () => Promise<void>;
  generateStrategicTasksFromInsight: () => Promise<void>;
  addStrategicTask: (task: StrategicTask) => void;
  updateStrategicTaskStatus: (id: string, status: string) => void;
  deleteStrategicTask: (id: string) => void;

  runSystemScans: () => void;
  generateAuditPlan: (issueDate: string, ruleId: string) => AuditNode[];
  updateCertificateAuditStatus: (customerId: string, certificateId: string, auditNodeId: string, status: AuditNode['status']) => void;
  
  // 原有业务保全
  toggleReceivableStatus: (contractId: string, receivableId: string) => void;
  addReminder: (reminder: Omit<Reminder, 'id' | 'isRead'> & { id?: string }) => void;
  dismissReminder: (id: string) => void;
  /*
    标记已读 ≠ 删除。
    原来只有 dismissReminder，它直接把提醒从列表里删掉 ——
    于是「我看过了」和「这件事没了」变成同一个动作，
    看过之后想回头确认「上周那条逾期提醒说的是哪个客户」就找不回来了。
  */
  markRemindersRead: (ids: string[]) => void;
  markAllRemindersRead: () => void;
  addKnowledgeDoc: (doc: KnowledgeDoc) => Promise<{ ok: boolean; reason?: string; duplicateId?: string }>;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  
  // AI Decision Center
  aiDecisionLogs: AIDecisionLog[];
  runProjectDiagnosis: (projectId: string) => Promise<any>;
  completeProject: (projectId: string, opts?: CompleteProjectOptions) => Promise<{ ok: boolean; eventId?: string; reason?: string }>;
  reopenProject: (projectId: string) => { ok: boolean; reason?: string };
  updateProjectCost: (projectId: string, amount: number) => { ok: boolean; reason?: string }; // T-002 Cost Update
}

type AddProjectInput = Partial<Project> & {
  initialServiceItems?: Array<Omit<ServiceItem, 'id'>>;
  disableDefaultTemplateTasks?: boolean;
};

const AppContext = createContext<AppContextType | undefined>(undefined);
const STATE_SYNC_DATASET_KEYS = [
  'leads_v8',
  'customers_v8',
  'contracts_v8',
  'projects_v8',
  'settlements_v8',
  'reminders_v8',
  'audit_issues_v1',
  'knowledge_docs_v8',
  'market_signals_v1',
  'project_work_logs_v1',
  'strategic_insight_v1',
  'strategic_tasks_v1',
  'user_profiles_v1',
  'current_user_id',
  'ai_decision_logs_v1',
  'task_templates_v1'
] as const;

const asArray = <T,>(value: unknown): T[] | null => (Array.isArray(value) ? (value as T[]) : null);
const asObjectOrNull = <T extends object>(value: unknown): T | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
);
const asStringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const ROLE_TO_PERSONA: Record<RoleID, DashboardPersona> = {
  ADMIN: 'boss',
  SYS_ADMIN: 'boss',
  MANAGER: 'sales',
  SALES: 'sales',
  CONSULTANT: 'consultant',
  FINANCE: 'finance'
};
const PERSONA_TO_ROLE: Record<DashboardPersona, RoleID> = {
  boss: 'ADMIN',
  sales: 'MANAGER',
  consultant: 'CONSULTANT',
  finance: 'FINANCE'
};
const normalizePersona = (value?: string | null): DashboardPersona | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'boss' || normalized === 'sales' || normalized === 'consultant' || normalized === 'finance') {
    return normalized;
  }
  return null;
};

const normalizeUserProfile = (user: UserProfile): UserProfile => ({
  ...user,
  roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : ['CONSULTANT'],
  activeRole: Array.isArray(user.roles) && user.roles.includes(user.activeRole)
    ? user.activeRole
    : (Array.isArray(user.roles) && user.roles[0]) || 'CONSULTANT'
});

export const AppProvider: React.FC<{ children: ReactNode; authenticatedUser?: UserProfile | null; authRequired?: boolean }> = ({ children, authenticatedUser = null, authRequired = false }) => {
  /*
    示例数据种子（P0-5）。默认关闭，靠 VITE_DEMO_SEED_ENABLED=1 显式打开。
    上线前必须是关的：真实业务数据和示例数据混在一起，测试期就没法判读
    ——同事报上来的问题分不清是系统的还是假数据造成的。
    现在 8 个模块都开了 API 读取，页面数据来自 PG，不靠这个种子。
  */
  const [demoSeedVersion] = useState(() => {
    if (String(import.meta.env?.VITE_DEMO_SEED_ENABLED || '').trim() === '1') seedDemoData();
    return 1;
  });
  const [leads, setLeads] = useState<Lead[]>(() => dataService.get('leads_v8', MOCK_LEADS));
  const [customers, setCustomers] = useState<Customer[]>(() => dataService.get('customers_v8', MOCK_CUSTOMERS));
  const [contracts, setContracts] = useState<Contract[]>(() => dataService.get('contracts_v8', MOCK_CONTRACTS));
  const [projects, setProjects] = useState<Project[]>(() => {
    const stored = dataService.get<any[]>('projects_v8', MOCK_PROJECTS as any);
    const arr = Array.isArray(stored) ? stored : [];
    return arr.map(p => {
      const projectCategory = (p as any).projectCategory || 'Delivery';
      const meta = inferProjectMeta({
        contractRef: String((p as any).contractRef || ''),
        projectCategory,
        sourceType: (p as any).sourceType,
        sourceRef: (p as any).sourceRef,
        projectMode: (p as any).projectMode
      } as Project);
      return {
      ...p,
      projectCategory,
      sourceType: (p as any).sourceType || meta.sourceType,
      sourceRef: (p as any).sourceRef || (meta.sourceRef || undefined),
      projectMode: (p as any).projectMode || meta.projectMode,
      projectAmount: (() => {
        const v = Number((p as any).projectAmount ?? 0);
        return Number.isFinite(v) ? v : 0;
      })(),
      costStatus: (() => {
        const v = Number((p as any).projectAmount ?? 0);
        return Number.isFinite(v) && v > 0 ? '已确认' : '待补全';
      })(),
      serviceItems: Array.isArray((p as any).serviceItems) ? (p as any).serviceItems : []
    };
    }) as Project[];
  });
  const [aiDecisionLogs, setAiDecisionLogs] = useState<AIDecisionLog[]>(() => dataService.get('ai_decision_logs_v1', dataService.get('aiDecisionLogs_v1', [])));
  const [settlements, setSettlements] = useState<Settlement[]>(() => dataService.get('settlements_v8', MOCK_SETTLEMENTS));
  const [reminders, setReminders] = useState<Reminder[]>(() => dataService.get('reminders_v8', []));
  const [auditIssues, setAuditIssues] = useState<AuditIssue[]>(() => dataService.get('audit_issues_v1', dataService.get('auditIssues_v1', MOCK_AUDITS)));
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>(() => dataService.get('knowledge_docs_v8', dataService.get('knowledgeDocs_v8', MOCK_DOCS)));
  const [marketSignals, setMarketSignals] = useState<MarketSignal[]>(() => dataService.get('market_signals_v1', dataService.get('marketSignals_v1', [])));
  const [projectWorkLogs, setProjectWorkLogs] = useState<ProjectWorkLog[]>(() => dataService.get('project_work_logs_v1', []));
  const [vendors] = useState<Vendor[]>(MOCK_VENDORS);
  const [importRecords, setImportRecords] = useState<ImportRecord[]>([]); // 导入记录状态
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(() => dataService.get('task_templates_v1', dataService.get('taskTemplates_v1', TASK_TEMPLATES)));
  const [templatesNormalized, setTemplatesNormalized] = useState<boolean>(false);
  const [knowledgeAccessNormalized, setKnowledgeAccessNormalized] = useState<boolean>(false);
  const [strategicInsight, setStrategicInsight] = useState<any>(() => dataService.get('strategic_insight_v1', dataService.get('strategicInsight_v1', null)));
  const [isAnalyzingStrategy, setIsAnalyzingStrategy] = useState<boolean>(false);
  const [strategicTasks, setStrategicTasks] = useState<StrategicTask[]>(() => dataService.get('strategic_tasks_v1', dataService.get('strategicTasks_v1', [])));
  const [backendReadReadyUserId, setBackendReadReadyUserId] = useState<string>('');
  const wechatPushAttemptedIdsRef = React.useRef<Set<string> | null>(null);

  /*
    ── 记下哪些数据集是**真的从服务端加载过**的 ──────────────────

    整份状态同步以前是无差别推送 18 个数据集：不管这个浏览器手里那份
    是从服务端拿的、从 localStorage 翻出来的、还是代码里的 MOCK 假数据，
    一律整份写回服务器。

    后果在 2026-09-02 的线上现场看得很清楚：
      project_work_logs_v1   推上来 0 条    而表里有 47 行
    浏览器根本没加载过工作日志（那时还没有读接口），
    却理直气壮地用一个空数组去覆盖别人的数据。
    只因为「空数组不删表」那条保护才没酿成事故。

    规则改成：**没从服务端加载过的数据集，没资格覆盖服务端。**
    这条比「加版本号」简单得多，而且堵死的是同一类问题的根 ——
    问题从来不是「两份都是真数据，该听谁的」，
    而是「一份是真的，另一份根本不知道自己在说什么」。
  */
  const hydratedDatasetsRef = React.useRef<Set<string>>(new Set());
  const markHydrated = React.useCallback((key: string) => {
    hydratedDatasetsRef.current.add(key);
  }, []);
  void demoSeedVersion;

  const [userProfiles, setUserProfiles] = useState<UserProfile[]>(() => {
    const stored = dataService.get<UserProfile[] | null>('user_profiles_v1', null);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return DEFAULT_USER_PROFILES;
  });

  const [currentUserId, setCurrentUserId] = useState<string>(() => {
    const stored = dataService.get<string | null>('current_user_id', null);
    if (stored && userProfiles.some(u => u.id === stored)) return stored;
    return userProfiles[0]?.id || DEFAULT_USER_PROFILE.id;
  });

  useEffect(() => {
    if (!authRequired || !authenticatedUser?.id) return;
    const nextUser = normalizeUserProfile(authenticatedUser);
    setUserProfiles(prev => {
      return prev.some(u => u.id === nextUser.id)
        ? prev.map(u => u.id === nextUser.id ? { ...u, ...nextUser } : u)
        : [nextUser, ...prev];
    });
    setCurrentUserId(authenticatedUser.id);
  }, [authRequired, authenticatedUser?.id]);

  const currentUser = userProfiles.find(u => u.id === currentUserId) || userProfiles[0] || DEFAULT_USER_PROFILE;
  const safeActiveRole: RoleID = currentUser.roles.includes(currentUser.activeRole) ? currentUser.activeRole : currentUser.roles[0] || 'CONSULTANT';
  const normalizedCurrentUser: UserProfile = safeActiveRole === currentUser.activeRole ? currentUser : { ...currentUser, activeRole: safeActiveRole };
  const effectiveUserId = normalizedCurrentUser.id;

  const activeRole = normalizedCurrentUser.activeRole;
  const setActiveRole = (role: RoleID) => {
    if (!normalizedCurrentUser.roles.includes(role)) return;
    setUserProfiles(prev => prev.map(u => u.id === effectiveUserId ? { ...u, activeRole: role } : u));
  };
  const activePersona: DashboardPersona = ROLE_TO_PERSONA[activeRole] || 'boss';
  const availablePersonas = Array.from(new Set(
    normalizedCurrentUser.roles
      .map(role => ROLE_TO_PERSONA[role])
      .filter(Boolean)
  )) as DashboardPersona[];
  const resolveDashboardPersona = (queryPersona?: string | null): DashboardPersona => {
    const parsed = normalizePersona(queryPersona);
    if (parsed) {
      const requiredRole = PERSONA_TO_ROLE[parsed];
      if (normalizedCurrentUser.roles.includes(requiredRole)) return parsed;
    }
    return activePersona;
  };

  useEffect(() => {
    let cancelled = false;
    const shouldUseBackendRead = stateSyncService.shouldUseBackendRead(effectiveUserId);

    if (!shouldUseBackendRead) {
      setBackendReadReadyUserId(effectiveUserId);
      return;
    }

    const hydrateFromBackend = async () => {
      try {
        const result = await stateSyncService.fetchState([...STATE_SYNC_DATASET_KEYS]);
        if (!result?.ok || !result.datasets || Object.keys(result.datasets).length === 0) return;
        if (cancelled) return;

        const datasets = result.datasets as Record<string, unknown>;
        const pickDataset = (primaryKey: string, legacyKey?: string) => (
          datasets[primaryKey] ?? (legacyKey ? datasets[legacyKey] : undefined)
        );
        const leadsData = asArray<Lead>(datasets.leads_v8);
        const customersData = asArray<Customer>(datasets.customers_v8);
        const contractsData = asArray<Contract>(datasets.contracts_v8);
        const projectsData = asArray<Project>(datasets.projects_v8);
        const settlementsData = asArray<Settlement>(datasets.settlements_v8);
        const remindersData = asArray<Reminder>(datasets.reminders_v8);
        const auditIssuesData = asArray<AuditIssue>(pickDataset('audit_issues_v1', 'auditIssues_v1'));
        const knowledgeDocsData = asArray<KnowledgeDoc>(pickDataset('knowledge_docs_v8', 'knowledgeDocs_v8'));
        const marketSignalsData = asArray<MarketSignal>(pickDataset('market_signals_v1', 'marketSignals_v1'));
        const projectWorkLogsData = asArray<ProjectWorkLog>(datasets.project_work_logs_v1);
        const strategicInsightData = asObjectOrNull<Record<string, unknown>>(pickDataset('strategic_insight_v1', 'strategicInsight_v1'));
        const strategicTasksData = asArray<StrategicTask>(pickDataset('strategic_tasks_v1', 'strategicTasks_v1'));
        const userProfilesData = asArray<UserProfile>(datasets.user_profiles_v1);
        const currentUserIdData = asStringOrNull(datasets.current_user_id);
        const aiDecisionLogsData = asArray<AIDecisionLog>(pickDataset('ai_decision_logs_v1', 'aiDecisionLogs_v1'));
        const taskTemplatesData = asArray<TaskTemplate>(pickDataset('task_templates_v1', 'taskTemplates_v1'));

        if (leadsData) setLeads(leadsData);
        if (customersData) setCustomers(customersData);
        if (contractsData) setContracts(contractsData);
        if (projectsData) setProjects(projectsData);
        if (settlementsData) setSettlements(settlementsData);
        if (remindersData) setReminders(remindersData);
        if (auditIssuesData) setAuditIssues(auditIssuesData);
        if (knowledgeDocsData) {
          setKnowledgeDocs(knowledgeDocsData);
          setKnowledgeAccessNormalized(false);
        }
        if (marketSignalsData) setMarketSignals(marketSignalsData);
        if (projectWorkLogsData) setProjectWorkLogs(projectWorkLogsData);
        if (strategicInsightData !== null) setStrategicInsight(strategicInsightData);
        if (strategicTasksData) setStrategicTasks(strategicTasksData);
        if (aiDecisionLogsData) setAiDecisionLogs(aiDecisionLogsData);
        if (taskTemplatesData) {
          setTaskTemplates(taskTemplatesData);
          setTemplatesNormalized(false);
        }
        if (userProfilesData && userProfilesData.length > 0) {
          const nextUserProfiles = authRequired && authenticatedUser?.id
            ? (
              userProfilesData.some(u => u.id === authenticatedUser.id)
                ? userProfilesData.map(u => u.id === authenticatedUser.id ? { ...u, ...normalizeUserProfile(authenticatedUser) } : u)
                : [normalizeUserProfile(authenticatedUser), ...userProfilesData]
            )
            : userProfilesData;
          setUserProfiles(nextUserProfiles);
          if (authRequired && authenticatedUser?.id) {
            setCurrentUserId(authenticatedUser.id);
          } else if (currentUserIdData && nextUserProfiles.some(u => u.id === currentUserIdData)) {
            setCurrentUserId(currentUserIdData);
          } else if (!nextUserProfiles.some(u => u.id === effectiveUserId)) {
            setCurrentUserId(nextUserProfiles[0].id);
          }
        } else if (currentUserIdData) {
          setCurrentUserId(authRequired && authenticatedUser?.id ? authenticatedUser.id : currentUserIdData);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[StateSync] backend read failed, fallback to local state', msg);
      } finally {
        if (!cancelled) setBackendReadReadyUserId(effectiveUserId);
      }
    };

    setBackendReadReadyUserId('');
    hydrateFromBackend();
    return () => { cancelled = true; };
  }, [effectiveUserId, authRequired, authenticatedUser?.id]);

  useEffect(() => {
    if (!leadService.isReadEnabled()) return;
    let cancelled = false;

    const hydrateLeadsFromApi = async () => {
      try {
        const apiLeads = await leadService.listLeads();
        if (cancelled) return;
        setLeads(apiLeads);
        markHydrated('leads_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[LeadService] read failed, fallback to local leads', msg);
      }
    };

    hydrateLeadsFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!customerService.isReadEnabled()) return;
    let cancelled = false;

    const hydrateCustomersFromApi = async () => {
      try {
        const apiCustomers = await customerService.listCustomers();
        if (cancelled) return;
        setCustomers(apiCustomers);
        markHydrated('customers_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[CustomerService] read failed, fallback to local customers', msg);
      }
    };

    hydrateCustomersFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!contractService.isReadEnabled()) return;
    let cancelled = false;

    const hydrateContractsFromApi = async () => {
      try {
        const apiContracts = await contractService.listContracts();
        if (cancelled) return;
        setContracts(apiContracts);
        markHydrated('contracts_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[ContractService] read failed, fallback to local contracts', msg);
      }
    };

    hydrateContractsFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!projectService.isReadEnabled()) return;
    let cancelled = false;

    const hydrateProjectsFromApi = async () => {
      try {
        const apiProjects = await projectService.listProjects();
        if (cancelled) return;
        setProjects(apiProjects);
        markHydrated('projects_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[ProjectService] read failed, fallback to local projects', msg);
      }
    };

    hydrateProjectsFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!signalService.isReadEnabled()) return;
    let cancelled = false;
    const hydrateSignalsFromApi = async () => {
      try {
        const apiSignals = await signalService.listSignals();
        if (cancelled) return;
        setMarketSignals(apiSignals);
        markHydrated('market_signals_v1');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[SignalService] read failed, fallback to local signals', msg);
      }
    };
    hydrateSignalsFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!knowledgeService.isReadEnabled()) return;
    let cancelled = false;
    const hydrateKnowledgeFromApi = async () => {
      try {
        const apiDocs = await knowledgeService.listDocs();
        if (cancelled) return;
        setKnowledgeDocs(apiDocs);
        markHydrated('knowledge_docs_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[KnowledgeService] read failed, fallback to local docs', msg);
      }
    };
    hydrateKnowledgeFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!settlementService.isReadEnabled()) return;
    let cancelled = false;
    const hydrateSettlementsFromApi = async () => {
      try {
        const apiSettlements = await settlementService.listSettlements();
        if (cancelled) return;
        setSettlements(apiSettlements);
        markHydrated('settlements_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[SettlementService] read failed, fallback to local settlements', msg);
      }
    };
    hydrateSettlementsFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  useEffect(() => {
    if (!reminderService.isReadEnabled()) return;
    let cancelled = false;
    const hydrateRemindersFromApi = async () => {
      try {
        const apiReminders = await reminderService.listReminders();
        if (cancelled) return;
        setReminders(apiReminders);
        markHydrated('reminders_v8');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[ReminderService] read failed, fallback to local reminders', msg);
      }
    };
    hydrateRemindersFromApi();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  /*
    工作日志 / 任务模板 / 不符合项：2026-09-02 补上服务端读。

    在此之前这三份数据只存在于各人的浏览器里，取不到还会退回 MOCK 假数据。
    于是「一台空浏览器拿假数据覆盖真数据」是随时可能发生的事 ——
    而它不报错，只是数据悄悄变了。
  */
  useEffect(() => {
    if (!workLogService.isReadEnabled()) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await workLogService.list();
        if (cancelled) return;
        setProjectWorkLogs(rows);
        markHydrated('project_work_logs_v1');
      } catch (error) {
        console.warn('[WorkLogService] read failed, fallback to local work logs',
          error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, markHydrated]);

  useEffect(() => {
    if (!taskTemplateService.isReadEnabled()) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await taskTemplateService.list();
        if (cancelled) return;
        setTaskTemplates(rows);
        setTemplatesNormalized(false);
        markHydrated('task_templates_v1');
      } catch (error) {
        console.warn('[TaskTemplateService] read failed, fallback to local templates',
          error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, markHydrated]);

  useEffect(() => {
    if (!auditIssueService.isReadEnabled()) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await auditIssueService.list();
        if (cancelled) return;
        setAuditIssues(rows);
        markHydrated('audit_issues_v1');
      } catch (error) {
        console.warn('[AuditIssueService] read failed, fallback to local audit issues',
          error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, markHydrated]);

  // 人员花名册单一真相源：从「员工账号」(auth_users) 同步，业务(项目负责人/看板/提醒)与登录账号统一
  useEffect(() => {
    let cancelled = false;
    const hydrateProfilesFromAuth = async () => {
      try {
        const accounts = await authService.listUsers();
        if (cancelled || !Array.isArray(accounts) || accounts.length === 0) return;
        setUserProfiles(accounts.map((a: any) => ({
          id: a.id,
          name: a.name,
          roles: Array.isArray(a.roles) && a.roles.length ? a.roles : ['CONSULTANT'],
          activeRole: a.activeRole || (Array.isArray(a.roles) && a.roles[0]) || 'CONSULTANT',
          positionTags: Array.isArray(a.positionTags) ? a.positionTags : [],
          reportsToUserId: a.reportsToUserId || undefined,
        })) as UserProfile[]);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[AuthProfiles] 同步员工账号失败，沿用本地花名册', msg);
      }
    };
    hydrateProfilesFromAuth();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  const userPermissions: PermissionCode[] = Array.from(
    new Set(normalizedCurrentUser.roles.flatMap(r => ROLE_PERMISSIONS[r] || []))
  );
  const hasPermission = (permission: PermissionCode) => userPermissions.includes(permission);
  const dashboardMetrics = useMemo(() => buildDashboardMetrics({
    leads,
    customers,
    contracts,
    projects,
    projectWorkLogs,
    settlements,
    currentUser: normalizedCurrentUser,
    activeRole
  }), [leads, customers, contracts, projects, projectWorkLogs, settlements, normalizedCurrentUser, activeRole]);

  const todayStr = () => new Date().toISOString().split('T')[0];
  const parseDateMs = (value?: string) => {
    const ts = new Date(String(value || '')).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };
  const deriveReceivableStatus = (receivable: Receivable, nowMs = Date.now()): Receivable['status'] => {
    if (receivable.status === 'paid') return 'paid';
    const dueMs = parseDateMs(receivable.dueDate);
    if (!dueMs) return receivable.status === 'overdue' ? 'overdue' : 'unpaid';
    return dueMs < nowMs ? 'overdue' : 'unpaid';
  };
  const deriveProjectPaymentStatus = (receivables: Receivable[]): Project['paymentStatus'] => {
    if (!Array.isArray(receivables) || receivables.length === 0) return 'unpaid';
    const paidCount = receivables.filter(r => r.status === 'paid').length;
    if (paidCount === receivables.length) return 'paid';
    const hasOverdue = receivables.some(r => r.status === 'overdue');
    if (hasOverdue) return 'overdue';
    return paidCount > 0 ? 'partial' : 'unpaid';
  };
  const KNOWLEDGE_ALL_ROLES: RoleID[] = ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'];
  const KNOWLEDGE_MANAGEMENT_ROLES: RoleID[] = ['ADMIN', 'MANAGER', 'FINANCE'];
  const KNOWLEDGE_AI_ROLES: RoleID[] = ['ADMIN', 'MANAGER'];

  const normalizeServiceToken = (value: string) => (value || '')
    .toUpperCase()
    .replace(/[\s/\\\-_.()（）]+/g, '')
    .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, '');

  const splitServiceLineText = (value: string): string[] => {
    const normalized = String(value || '')
      .replace(/[；;｜|]/g, '、')
      .replace(/[和及与]/g, '、')
      .replace(/[\/]/g, '、')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];
    return normalized
      .split(/[、,，]/)
      .map(part => part.trim())
      .filter(Boolean);
  };

  const matchServiceCatalogItem = (text: string) => {
    const normalized = normalizeServiceToken(text || '');
    if (!normalized) return null;
    for (const item of SERVICE_CATALOG) {
      const tokens = [item.code, item.name, ...(item.aliases || [])]
        .filter(Boolean)
        .map(val => normalizeServiceToken(String(val)));
      if (tokens.some(token => normalized.includes(token) || token.includes(normalized))) {
        return item;
      }
    }
    return null;
  };

  const inferServiceCategoryByName = (name: string): ServiceItem['category'] => {
    const text = String(name || '');
    if (!text) return '其他';
    if (/ISO|IATF|HACCP|体系|贯标|认证/i.test(text)) return '体系认证';
    if (/CCC|CE|FDA|ROHS|REACH|产品认证/i.test(text)) return '产品认证';
    if (/申报|高新|专精特新|两化融合|技改|质量奖|研究院|研发中心/i.test(text)) return '政府项目申报';
    if (/许可|SC|QS|特种设备|药包材|医疗器械|排污|排水/i.test(text)) return '生产许可类';
    if (/顾问|培训|台账|咨询|审计|体系落地|精益|6S/i.test(text)) return '管理培训/顾问服务';
    return '其他';
  };

  const normalizeContractServiceSeeds = (raw: any): Array<Omit<ServiceItem, 'id'>> => {
    const rawList = Array.isArray(raw?.serviceItems) ? raw.serviceItems : [];
    const fromArray = rawList
      .map((entry: any) => (typeof entry === 'string' ? entry : (entry?.name || entry?.standardName || entry?.rawName || '')))
      .map((name: string) => String(name || '').trim())
      .filter(Boolean);
    const fromLine = splitServiceLineText(String(raw?.serviceLine || ''));
    const candidates = Array.from(new Set([...fromArray, ...fromLine]));
    const cleaned = candidates
      .map(item => item.replace(/^[□☐☑✅✔√■▣]+/, '').trim())
      .filter(item => item && item !== '未分类' && item !== 'ISO 标准');

    return cleaned.map((name) => {
      const matched = matchServiceCatalogItem(name);
      const category = matched?.category || inferServiceCategoryByName(name);
      const deliveryMode = matched?.deliveryMode || SERVICE_CATEGORY_DELIVERY_MODE[category];
      return {
        name: matched?.name || name,
        rawName: name,
        standardName: matched?.name || name,
        catalogId: matched?.id,
        category,
        deliveryMode,
        workflowTemplateId: matched?.workflowTemplateId || DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY[category],
        status: 'Pending' as const,
        autoGenerateTasks: true
      };
    });
  };

  const matchServiceCatalogText = (text: string) => {
    const normalized = normalizeServiceToken(text || '');
    if (!normalized) return null;
    for (const item of SERVICE_CATALOG) {
      const tokens = [item.code, item.name, ...(item.aliases || [])]
        .filter(Boolean)
        .map(val => normalizeServiceToken(String(val)));
      if (tokens.some(token => normalized.includes(token))) {
        return item;
      }
    }
    return null;
  };

  const appendKnowledgeDoc = (doc: KnowledgeDoc): { ok: boolean; reason?: string; duplicateId?: string } => {
    let result: { ok: boolean; reason?: string; duplicateId?: string } = { ok: true };
    setKnowledgeDocs(prev => {
      const duplicate = findDuplicateKnowledgeDoc(prev, doc);
      if (duplicate) {
        result = { ok: false, reason: 'DUPLICATE_DOC', duplicateId: duplicate.id };
        return prev;
      }
      return [doc, ...prev];
    });
    if (result.ok && knowledgeService.isEnabled()) {
      knowledgeService.createDoc(doc).catch(e => console.warn('[KnowledgeService] create failed', e));
    }
    return result;
  };

  const normalizeTaskTemplates = (raw: any[], opts: { userId: string; userName: string }) => {
    const safeArray = Array.isArray(raw) ? raw : [];
    const builtInBase = TASK_TEMPLATES.map(t => ({
      ...t,
      isBuiltIn: true,
      archived: false,
      usageCount: t.usageCount ?? 0
    })) as TaskTemplate[];

    const builtInMap = new Map<string, TaskTemplate>();
    for (const t of builtInBase) builtInMap.set(t.id, t);

    const normalizedUserTemplates: TaskTemplate[] = safeArray
      .filter(t => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.tasks))
      .map((t: any) => {
        const isBuiltIn = Boolean(t.isBuiltIn ?? (typeof t.id === 'string' && t.id.startsWith('TEMPLATE_')));
        const createdAt = t.createdAt || todayStr();
        const updatedAt = t.updatedAt || createdAt;
        const createdByUserId = t.createdByUserId || (t.id.startsWith('TPL-') ? opts.userId : undefined);
        const createdByName = t.createdByName || (createdByUserId ? opts.userName : undefined);
        const archived = Boolean(t.archived ?? false);
        const usageCount = Number.isFinite(Number(t.usageCount)) ? Number(t.usageCount) : 0;
        const lastUsedAt = t.lastUsedAt || undefined;
        return {
          id: t.id,
          name: t.name,
          tasks: t.tasks,
          isBuiltIn,
          createdByUserId,
          createdByName,
          createdAt,
          updatedAt,
          archived,
          usageCount,
          lastUsedAt
        } as TaskTemplate;
      })
      .filter(t => !t.isBuiltIn);

    const seen = new Set<string>();
    const merged: TaskTemplate[] = [];

    for (const t of builtInBase) {
      merged.push({ ...t, isBuiltIn: true, archived: false });
      seen.add(t.id);
    }

    for (const t of normalizedUserTemplates) {
      if (seen.has(t.id)) continue;
      merged.push({ ...t, isBuiltIn: false });
      seen.add(t.id);
    }

    return merged;
  };

  const isReminderVisible = (r: Reminder) => {
    if (r.forUserIds && r.forUserIds.length > 0) {
      return r.forUserIds.includes(effectiveUserId);
    }
    if (r.forRole && r.forRole.length > 0) {
      return r.forRole.includes(activeRole);
    }
    return true;
  };

  const visibleReminders = reminders.filter(isReminderVisible);

  const parseDateKey = (dateStr?: string) => {
    if (!dateStr) return 0;
    const t = new Date(dateStr).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  const getReminderSeverity = (r: Reminder): ReminderSeverity => {
    const id = r?.id || '';
    const title = r?.title || '';
    if (id.startsWith('AUTO-OVER-L2-') || title.includes('严重逾期') || title.includes('重大')) return 'high';
    if (id.startsWith('AUTO-OVER-L1-') || id.startsWith('AUTO-STAGNANT-') || id.startsWith('AUTO-EMPTY-') || r.type === 'risk') return 'medium';
    return 'low';
  };

  const getReminderTags = (r: Reminder): string[] => {
    const title = r?.title || '';
    const content = r?.content || '';
    const text = `${title} ${content}`;
    const tags = new Set<string>();
    if (text.includes('证书')) tags.add('证书');
    if (text.includes('到期') || text.includes('续期')) tags.add('到期/续期');
    if (text.includes('回款') || text.includes('到账') || text.includes('应收')) tags.add('回款');
    if (text.includes('内审')) tags.add('内审');
    if (text.includes('管理评审')) tags.add('管理评审');
    if (text.includes('项目') && (text.includes('停滞') || text.includes('僵尸'))) tags.add('项目健康');
    if (text.includes('逾期')) tags.add('逾期');
    if (text.includes('风险')) tags.add('风险');
    if (text.includes('AI')) tags.add('AI');
    return Array.from(tags);
  };

  const aggregatedReminders: AggregatedReminder[] = useMemo(() => {
    const groups = new Map<string, Reminder[]>();
    for (const r of visibleReminders) {
      if (!r?.linkType || !r?.linkId) continue;
      const groupKey = `${r.linkType}:${r.linkId}`;
      const prev = groups.get(groupKey) || [];
      prev.push(r);
      groups.set(groupKey, prev);
    }

    const resolveProjectCustomerName = (project: Project) => {
      const ref = project.contractRef || '';
      if (ref.startsWith('CUSTCERT:')) {
        const parts = ref.split(':');
        const customerId = parts[1];
        return customers.find(c => c.id === customerId)?.name;
      }
      if (ref.startsWith('CUST:')) {
        const customerId = ref.split(':')[1];
        return customers.find(c => c.id === customerId)?.name;
      }
      if (ref.startsWith('LEAD:')) {
        const leadId = ref.split(':')[1];
        return leads.find(l => l.id === leadId)?.company;
      }
      if (project.sourceType === 'customer' && project.sourceRef) {
        const customerId = String(project.sourceRef).split(':')[0];
        const found = customers.find(c => c.id === customerId);
        if (found?.name) return found.name;
      }
      const linked = contracts.find(c => c.id === ref || c.contractNo === ref);
      return linked?.customerName;
    };

    const severityRank: Record<ReminderSeverity, number> = { high: 3, medium: 2, low: 1 };

    const result: AggregatedReminder[] = [];
    for (const [groupKey, list] of groups.entries()) {
      const [linkTypeRaw, linkId] = groupKey.split(':');
      const linkType = linkTypeRaw as AggregatedReminder['linkType'];
      if (!linkId) continue;

      const sorted = [...list].sort((a, b) => {
        const sa = severityRank[getReminderSeverity(a)];
        const sb = severityRank[getReminderSeverity(b)];
        if (sa !== sb) return sb - sa;
        return parseDateKey(b.date) - parseDateKey(a.date);
      });

      const latestDate = sorted.reduce((acc, r) => (parseDateKey(r.date) > parseDateKey(acc) ? (r.date || acc) : acc), sorted[0]?.date || '');
      const severity = sorted.reduce<ReminderSeverity>((acc, r) => (severityRank[getReminderSeverity(r)] > severityRank[acc] ? getReminderSeverity(r) : acc), 'low');
      const mainScene = sorted[0]?.title || '提醒';

      const tagsSet = new Set<string>();
      for (const r of sorted) getReminderTags(r).forEach(t => tagsSet.add(t));

      let projectId: string | undefined;
      let projectName: string | undefined;
      let customerName: string | undefined;

      if (linkType === 'project') {
        projectId = linkId;
        const p = projects.find(x => x.id === linkId);
        projectName = p?.name;
        customerName = p ? resolveProjectCustomerName(p) : undefined;
      } else if (linkType === 'customer') {
        customerName = customers.find(c => c.id === linkId)?.name;
      } else if (linkType === 'lead') {
        customerName = leads.find(l => l.id === linkId)?.company;
      } else if (linkType === 'contract') {
        customerName = contracts.find(c => c.id === linkId || c.contractNo === linkId)?.customerName;
      } else if (linkType === 'audit') {
        const issue = auditIssues.find(x => x.id === linkId);
        const linkedProject = issue?.projectId ? projects.find(x => x.id === issue.projectId) : undefined;
        const linkedContract = issue?.contractId
          ? contracts.find(c => c.id === issue.contractId)
          : contracts.find(c => c.id === issue?.contractRef || c.contractNo === issue?.contractRef);
        const linkedCustomer = issue?.customerId ? customers.find(c => c.id === issue.customerId) : undefined;
        projectId = linkedProject?.id;
        projectName = linkedProject?.name;
        customerName = linkedCustomer?.name || linkedContract?.customerName || issue?.customerName;
      } else if (linkType === 'intel') {
        projectName = '情报雷达';
      }

      result.push({
        id: `AGG-${linkType}-${linkId}`,
        linkType,
        linkId,
        projectId,
        projectName,
        customerName,
        severity,
        mainScene,
        count: list.length,
        latestDate,
        samples: sorted.slice(0, 3),
        tags: Array.from(tagsSet)
      });
    }

    return result.sort((a, b) => {
      const sa = severityRank[a.severity];
      const sb = severityRank[b.severity];
      if (sa !== sb) return sb - sa;
      return parseDateKey(b.latestDate) - parseDateKey(a.latestDate);
    });
  }, [visibleReminders, projects, contracts, customers, leads, auditIssues]);

  useEffect(() => {
    if (templatesNormalized) return;
    setTaskTemplates(prev => normalizeTaskTemplates(prev, { userId: effectiveUserId, userName: normalizedCurrentUser.name }));
    setTemplatesNormalized(true);
  }, [templatesNormalized, effectiveUserId, normalizedCurrentUser.name]);

  useEffect(() => {
    if (knowledgeAccessNormalized) return;
    let changed = false;

    const defaultRolesByCategory = (category: string): RoleID[] => {
      if (category === 'PDCA') return KNOWLEDGE_MANAGEMENT_ROLES;
      if (category === 'AI生成') return KNOWLEDGE_AI_ROLES;
      return KNOWLEDGE_ALL_ROLES;
    };

    const nextDocs = knowledgeDocs.map(doc => {
      const updates: Partial<KnowledgeDoc> = {};
      const hasRoleAccess = Array.isArray(doc.accessRoles) && doc.accessRoles.length > 0;
      const hasUserAccess = Array.isArray(doc.accessUserIds) && doc.accessUserIds.length > 0;

      if (!hasRoleAccess && !hasUserAccess) {
        updates.accessRoles = defaultRolesByCategory(doc.category);
      }

      if (doc.category === 'PDCA' && !hasUserAccess) {
        if (!hasRoleAccess || doc.autoGenerated || doc.source === 'system' || doc.source === 'ai') {
          updates.accessRoles = KNOWLEDGE_MANAGEMENT_ROLES;
        }
      }

      if (doc.category === 'AI生成' && !hasUserAccess) {
        updates.accessRoles = KNOWLEDGE_AI_ROLES;
        let projectId = doc.linkType === 'project' ? doc.linkId : undefined;
        if (!projectId && doc.tags) {
          const tag = doc.tags.find(t => t.startsWith('project:'));
          if (tag) projectId = tag.split(':')[1];
        }
        const project = projectId ? projects.find(p => p.id === projectId) : undefined;
        if (project) {
          const ownerNames = [
            project.manager,
            ...project.tasks.map(t => t.owner)
          ].filter(Boolean);
          const ownerIds = resolveUserIds(ownerNames);
          if (ownerIds.length > 0) updates.accessUserIds = ownerIds;
          if (!doc.linkType && projectId) updates.linkType = 'project';
          if (!doc.linkId && projectId) updates.linkId = projectId;
          if (!doc.linkTitle) updates.linkTitle = project.name;
        }
      }

      if (Object.keys(updates).length === 0) return doc;
      changed = true;
      return { ...doc, ...updates };
    });

    if (changed) {
      setKnowledgeDocs(nextDocs);
    }
    setKnowledgeAccessNormalized(true);
  }, [knowledgeAccessNormalized, knowledgeDocs, projects]);

  // Inside AppProvider
  const upsertSystemReminder = (id: string, r: Omit<Reminder, 'id' | 'isRead'>) => {
    const isNew = !reminders.some(x => x.id === id);
    setReminders(prev => {
      if (prev.some(x => x.id === id)) return prev;
      return [{ ...r, id, isRead: false }, ...prev];
    });
    if (isNew && reminderService.isEnabled()) {
      reminderService.createReminder({ ...(r as any), id, isRead: false }).catch(e => console.warn('[ReminderService] create failed', e));
    }
  };


  const canManageTaskTemplate = (template: TaskTemplate) => {
    if (template?.isBuiltIn) return false;
    if (activeRole === 'ADMIN') return true;
    if (template?.createdByUserId && template.createdByUserId === effectiveUserId) return true;
    return false;
  };

  const createTemplateId = () => `TPL-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const addTaskTemplate = (template: TaskTemplate) => {
    const now = todayStr();
    const id = template?.id && typeof template.id === 'string' ? template.id : createTemplateId();
    const next: TaskTemplate = {
      ...template,
      id,
      isBuiltIn: false,
      createdByUserId: template.createdByUserId || effectiveUserId,
      createdByName: template.createdByName || normalizedCurrentUser.name,
      createdAt: template.createdAt || now,
      updatedAt: template.updatedAt || now,
      archived: Boolean(template.archived ?? false),
      usageCount: Number.isFinite(Number(template.usageCount)) ? Number(template.usageCount) : 0,
      lastUsedAt: template.lastUsedAt
    };
    setTaskTemplates(prev => {
      const exists = prev.some(t => t.id === next.id);
      const finalTpl = exists ? { ...next, id: createTemplateId() } : next;
      return [...prev, finalTpl];
    });
  };

  const updateTaskTemplate = (templateId: string, updates: Partial<TaskTemplate>) => {
    const tpl = taskTemplates.find(t => t.id === templateId);
    if (!tpl) return { ok: false, reason: '模板不存在' };
    if (tpl.isBuiltIn) return { ok: false, reason: '内置模板不可修改，请先复制为我的模板' };
    if (!canManageTaskTemplate(tpl)) return { ok: false, reason: '无权限修改该模板' };
    const now = todayStr();
    setTaskTemplates(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const nextTasks = Array.isArray(updates.tasks) ? updates.tasks : t.tasks;
      const nextName = typeof updates.name === 'string' ? updates.name : t.name;
      return { ...t, ...updates, name: nextName, tasks: nextTasks, updatedAt: now };
    }));
    return { ok: true };
  };

  const deleteTaskTemplate = (templateId: string) => {
    const tpl = taskTemplates.find(t => t.id === templateId);
    if (!tpl) return { ok: false, reason: '模板不存在' };
    if (tpl.isBuiltIn) return { ok: false, reason: '内置模板不可删除' };
    if (!canManageTaskTemplate(tpl)) return { ok: false, reason: '无权限删除该模板' };
    setTaskTemplates(prev => prev.filter(t => t.id !== templateId));
    return { ok: true };
  };

  const archiveTaskTemplate = (templateId: string, archived: boolean) => {
    const tpl = taskTemplates.find(t => t.id === templateId);
    if (!tpl) return { ok: false, reason: '模板不存在' };
    if (tpl.isBuiltIn) return { ok: false, reason: '内置模板不可归档' };
    if (!canManageTaskTemplate(tpl)) return { ok: false, reason: '无权限归档该模板' };
    const now = todayStr();
    setTaskTemplates(prev => prev.map(t => t.id === templateId ? { ...t, archived, updatedAt: now } : t));
    return { ok: true };
  };

  const cloneTaskTemplate = (templateId: string, name?: string) => {
    const tpl = taskTemplates.find(t => t.id === templateId);
    if (!tpl) return { ok: false, reason: '模板不存在' };
    const now = todayStr();
    const newId = createTemplateId();
    const newName = (name && name.trim()) ? name.trim() : `${tpl.name}（副本）`;
    const next: TaskTemplate = {
      id: newId,
      name: newName,
      tasks: Array.isArray(tpl.tasks) ? tpl.tasks.map(x => ({ ...x })) : [],
      isBuiltIn: false,
      createdByUserId: effectiveUserId,
      createdByName: normalizedCurrentUser.name,
      createdAt: now,
      updatedAt: now,
      archived: false,
      usageCount: 0,
      lastUsedAt: undefined
    };
    setTaskTemplates(prev => [...prev, next]);
    return { ok: true, newTemplateId: newId };
  };

  useEffect(() => {
    if (backendReadReadyUserId !== effectiveUserId) return;

    const datasets = {
      leads_v8: leads,
      customers_v8: customers,
      contracts_v8: contracts,
      projects_v8: projects,
      settlements_v8: settlements,
      reminders_v8: reminders,
      audit_issues_v1: auditIssues,
      knowledge_docs_v8: knowledgeDocs,
      market_signals_v1: marketSignals,
      project_work_logs_v1: projectWorkLogs,
      strategic_insight_v1: strategicInsight,
      strategic_tasks_v1: strategicTasks,
      user_profiles_v1: userProfiles,
      current_user_id: currentUserId,
      current_role: activeRole,
      ai_decision_logs_v1: aiDecisionLogs,
      task_templates_v1: taskTemplates
    };

    // 本地缓存照写不误：那是自己这台机器的副本，写坏了只影响自己
    Object.entries(datasets).forEach(([key, value]) => {
      dataService.set(key, value);
    });

    /*
      ── 只把「从服务端加载过的」推回服务端 ────────────────────────

      没加载过的数据集，这个浏览器手里那份可能是 localStorage 的陈年副本，
      也可能是代码里的 MOCK 假数据。用它去覆盖服务端，
      本质上是让一个不知情的人替所有人做决定。

      被排除在外的典型：
        current_user_id / current_role   本机 UI 状态，推上去等于
                                         把「我现在以谁的身份在看」写给全公司
        user_profiles_v1                 员工花名册的真相源是 auth_users，
                                         不是某个浏览器的内存
                                         （2026-08-28 的 11 个账号就是这么没的）
        ai_decision_logs_v1              本机日志

      一条都不剩地推空，则说明这个浏览器还没准备好 —— 那就整批不推，
      而不是推一批空数组上去。
    */
    const hydrated = hydratedDatasetsRef.current;
    const syncable = Object.fromEntries(
      Object.entries(datasets).filter(([key]) => hydrated.has(key))
    );

    if (Object.keys(syncable).length === 0) return;

    stateSyncService.scheduleSync({
      datasets: syncable,
      source: 'app-context',
      actorUserId: effectiveUserId,
      clientId: normalizedCurrentUser.id,
      appVersion: 'v5.0'
    });
  }, [backendReadReadyUserId, leads, customers, contracts, projects, settlements, reminders, auditIssues, knowledgeDocs, marketSignals, projectWorkLogs, strategicInsight, strategicTasks, userProfiles, currentUserId, activeRole, aiDecisionLogs, taskTemplates, effectiveUserId, normalizedCurrentUser.id]);

  const switchUser = (userId: string) => {
    if (authRequired) return;
    if (!userProfiles.some(u => u.id === userId)) return;
    setCurrentUserId(userId);
  };

  const updateUserProfile = (userId: string, updates: Partial<UserProfile>) => {
    setUserProfiles(prev => prev.map(u => {
      if (u.id !== userId) return u;
      const next = { ...u, ...updates };
      const safeRole = next.roles.includes(next.activeRole) ? next.activeRole : next.roles[0] || 'CONSULTANT';
      return { ...next, activeRole: safeRole };
    }));
  };

  const addUserProfile = (profile: UserProfile) => {
    if (!profile?.id) return;
    setUserProfiles(prev => prev.some(u => u.id === profile.id) ? prev : [...prev, profile]);
  };

  const deleteUserProfile = (userId: string) => {
    setUserProfiles(prev => prev.filter(u => u.id !== userId));
    if (currentUserId === userId) {
      const fallback = userProfiles.find(u => u.id !== userId)?.id;
      if (fallback) setCurrentUserId(fallback);
    }
  };

  const resolveUserIds = (candidates: Array<string | undefined>, extraIds: string[] = []) => {
    const idSet = new Set<string>();
    extraIds.filter(Boolean).forEach(id => idSet.add(id));
    const tokens = candidates.map(c => (c || '').trim()).filter(Boolean);
    if (tokens.length === 0) return Array.from(idSet);
    const tokenSet = new Set(tokens);
    const idSetFromProfiles = new Set(userProfiles.map(u => u.id));
    tokenSet.forEach(token => {
      if (idSetFromProfiles.has(token)) idSet.add(token);
    });
    userProfiles.forEach(u => {
      if (tokenSet.has(u.name)) idSet.add(u.id);
    });
    return Array.from(idSet);
  };

  const buildReminderTarget = (names: Array<string | undefined>, fallbackRoles: RoleID[], extraIds: string[] = []) => {
    const userIds = resolveUserIds(names, extraIds);
    return userIds.length > 0 ? { forUserIds: userIds } : { forRole: fallbackRoles };
  };

  useEffect(() => {
    if (wechatPushAttemptedIdsRef.current === null) {
      wechatPushAttemptedIdsRef.current = new Set(reminders.map(r => r.id));
      return;
    }

    const attempted = wechatPushAttemptedIdsRef.current;
    reminders.forEach((newReminder) => {
      if (attempted.has(newReminder.id) || newReminder.pushedToWeChat) return;
      attempted.add(newReminder.id);

      let targetUserIds: string[] = [];
      if (newReminder.forUserIds && newReminder.forUserIds.length > 0) {
        targetUserIds = newReminder.forUserIds;
      } else if (newReminder.forRole && newReminder.forRole.length > 0) {
        targetUserIds = userProfiles
          .filter(u => u.roles.some(role => newReminder.forRole!.includes(role)))
          .map(u => u.id);
      }

      /*
        2026-08-24 移除了微信推送的模拟实现。

        原来这里会给每个用户自动绑一个假 openid（wx_openid_xxx），
        然后把提醒标成 pushedToWeChat: true——**一条从没发出去的消息被记成已推送**。
        界面上看是「已微信通知」，同事那边什么都没收到；
        更糟的是这个标记会让人以为"系统已经提醒过他了"，从而不再当面跟进。

        真接微信/企业微信时在这里接：拿到用户的真实 userid（企业微信）
        或 openid（服务号），调用对应的消息接口，**发送成功才置这个标记**。
      */
      const pushed = false;

      if (pushed) {
        setReminders(prev => prev.map(item => item.id === newReminder.id
          ? { ...item, pushedToWeChat: true, channels: Array.from(new Set([...(item.channels || []), 'wechat'])) }
          : item
        ));
      }
    });
  }, [reminders, userProfiles]);

  const upsertMarketSignals = (signals: MarketSignal[]) => {
    const list = Array.isArray(signals) ? signals : [];
    if (list.length === 0) return;
    setMarketSignals(prev => {
      const map = new Map<string, MarketSignal>();
      prev.forEach(s => map.set(s.id, s));
      list.forEach(s => map.set(s.id, s));
      return Array.from(map.values()).sort((a, b) => b.score - a.score);
    });
    if (signalService.isEnabled()) {
      signalService.upsertSignals(list).catch(e => console.warn('[SignalService] bulk upsert failed', e));
    }
  };

  const updateMarketSignal = (id: string, updates: Partial<MarketSignal>) => {
    if (!id) return;
    setMarketSignals(prev => prev.map(s => s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s));
    if (signalService.isEnabled()) {
      signalService.updateSignal(id, updates).catch(e => console.warn('[SignalService] update failed', e));
    }
  };

  // Intel Radar: auto-refresh cached signals + in-app reminder while the app is open.
  // Backend does the scheduled fetch; frontend polls latest to surface it to users.
  const canIntel = hasPermission('NAV_INTEL');
  useEffect(() => {
    if (!canIntel) return;
    let isMounted = true;
    let inFlight = false;

    const pollLatest = async () => {
      if (!isMounted || inFlight) return;
      inFlight = true;
      try {
        const latest = await intelService.fetchLatestSignals();
        if (!latest.ok) return;
        if (latest.signals.length > 0) upsertMarketSignals(latest.signals);

        const runDate = String(latest.lastRunAt || '').slice(0, 10);
        if (!runDate) return;
        const lastNotice = dataService.get<string>('intel_last_notice', '');
        if (runDate === lastNotice) return;

        upsertSystemReminder(`REM-INTEL-${runDate}`, {
          title: `📡 情报雷达今日已更新`,
          content: `自动抓取已完成。点击进入情报雷达查看详情并转化为项目。`,
          date: runDate,
          type: 'opportunity',
          linkType: 'intel',
          linkId: runDate,
          forRole: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
        });
        dataService.set('intel_last_notice', runDate);
      } finally {
        inFlight = false;
      }
    };

    pollLatest();
    const timer = setInterval(pollLatest, 10 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [canIntel]);

  /*
    这里原来有一份 convertSignalToFollowUpProjectLocal —— 情报转跟进项目的
    纯前端级联，作为回退。2026-08-24 与 completeProjectLocal 一起删除。

    同一个理由：同一件事两份实现，必然漂移，而漂移不报错。
    情报写开关（VITE_SIGNALS_API_ENABLED）实测为开，这条路到不了。
  */

  // 单一业务权威入口：情报写开关开启时委托后端原子级联，前端仅刷新受影响数据集并补建转化通知；否则回退本地。
  const convertSignalToFollowUpProject = async (signalId: string): Promise<{ ok: boolean; projectId?: string; reason?: string }> => {
    const signal = marketSignals.find(s => s.id === signalId);
    if (!signal) return { ok: false, reason: '信号不存在' };
    if (signal.status === MARKET_SIGNAL_STATUS.CONVERTED && signal.convertedTo?.projectId) return { ok: true, projectId: signal.convertedTo.projectId };

    if (signalService.isEnabled()) {
      try {
        const res = await signalService.convert(signalId, { manager: normalizedCurrentUser.name });
        // 刷新受影响：项目(新建跟进项目) + 情报(状态转 converted)
        await Promise.all([
          projectService.isReadEnabled() ? projectService.listProjects().then(setProjects).catch(() => {}) : Promise.resolve(),
          signalService.isReadEnabled() ? signalService.listSignals().then(setMarketSignals).catch(() => {}) : Promise.resolve(),
        ]);
        // 转化通知是前端衍生（后端不建），仅首次转化时补建。
        if (!res.already && res.projectId) {
          addReminder({
            title: `📡 情报已转化为跟进项目`,
            content: `已基于“${signal.title}”生成跟进项目`,
            date: todayStr(),
            type: 'opportunity',
            linkId: res.projectId,
            linkType: 'project',
            ...buildReminderTarget([normalizedCurrentUser.name], ['MANAGER'])
          });
        }
        return { ok: true, projectId: res.projectId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, reason };
      }
    }

    // 开关关掉时明确报错，不静默走另一套逻辑
    return { ok: false, reason: '情报转化需要后端服务（VITE_SIGNALS_API_ENABLED 未开启）' };
  };

  const inferLeadCompanyFromSignal = (signal?: MarketSignal) => {
    if (!signal) return '待确认企业';
    const title = String(signal.title || '').trim();
    const sourceName = String(signal.sourceName || '').trim();
    const companyLike = title.match(/[A-Za-z0-9\u4e00-\u9fa5]{2,40}(?:有限责任公司|有限公司|集团|公司|企业|工厂|厂)/);
    if (companyLike?.[0]) return companyLike[0];
    if (sourceName && !/政府|人民政府|发改|工信|市场监管|财政|税务|协会|委员会/.test(sourceName)) {
      return sourceName;
    }
    return '待确认企业';
  };

  const convertIntelProjectToLead = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return { ok: false, reason: '项目不存在' };
    const capabilities = resolveProjectCapabilities(project);
    if (!capabilities.isFollowUpProject) return { ok: false, reason: '仅跟进项目支持该操作' };
    if (!capabilities.isIntelOrigin) return { ok: false, reason: '仅情报来源项目支持转线索' };

    const signalId = capabilities.sourceRef || String(project.contractRef || '').split(':')[1];
    const signal = marketSignals.find(s => s.id === signalId);
    const now = todayStr();
    const inferredCompany = inferLeadCompanyFromSignal(signal);
    const inferredIntent: Lead['intent'] = signal?.urgency === 'high' ? 'High' : signal?.urgency === 'low' ? 'Low' : 'Medium';
    const inferredProbability = signal?.urgency === 'high' ? 70 : signal?.urgency === 'low' ? 30 : 50;
    const inferredScore = Math.max(40, Math.min(100, Number(signal?.score || 60)));

    const existingLead = leads.find(l => (l.company || '').trim() === inferredCompany);
    const leadId = existingLead?.id || `L-INTEL-${Date.now()}`;

    if (!existingLead) {
      const newLead: Lead = {
        id: leadId,
        name: '待确认联系人',
        company: inferredCompany,
        status: Status.New,
        score: inferredScore,
        potentialValue: 0,
        lastContact: now,
        probability: inferredProbability,
        source: `情报雷达/${signal?.sourceName || '未知来源'}`,
        intent: inferredIntent,
        industry: signal?.industries?.[0],
        targetCertifications: signal?.serviceCategory || signal?.tags?.[0],
        targetCertExpiryDate: signal?.deadline
      };
      setLeads(prev => [newLead, ...prev]);
    }

    // 项目改名与来源改写必须落库：线索已新建并写后端，项目侧不能只改内存
    const previousProjectsForIntel = projects;
    const nextProjectsForIntel = projects.map(p => {
      if (p.id !== projectId) return p;
      const nextName = p.name.startsWith('【情报跟进】')
        ? p.name.replace('【情报跟进】', '【线索跟进】')
        : p.name;
      return {
        ...p,
        contractRef: `LEAD:${leadId}`,
        sourceType: p.sourceType || 'intel',
        sourceRef: p.sourceRef || signalId,
        projectMode: p.projectMode || 'followup',
        name: nextName
      };
    });
    setProjects(nextProjectsForIntel);
    commitProjectTransaction({
      projectId,
      nextProjects: nextProjectsForIntel,
      previousProjects: previousProjectsForIntel
    });

    if (signalId) {
      const convertedTo = signal?.convertedTo || {};
      updateMarketSignal(signalId, { convertedTo: { ...convertedTo, projectId, leadId } });
    }

    addReminder({
      title: '🧭 情报项目已转线索',
      content: `项目【${project.name}】已绑定线索【${inferredCompany}】。`,
      date: now,
      type: 'opportunity',
      linkType: 'project',
      linkId: projectId,
      ...buildReminderTarget([project.manager], ['MANAGER'])
    });

    return { ok: true, leadId };
  };

  const bindFollowUpProjectToCustomer = (projectId: string, customerId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return { ok: false, reason: '项目不存在' };
    const capabilities = resolveProjectCapabilities(project);
    if (!capabilities.isFollowUpProject) return { ok: false, reason: '仅跟进项目支持绑定客户' };
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return { ok: false, reason: '客户不存在' };

    const signalId = capabilities.isIntelOrigin ? (capabilities.sourceRef || String(project.contractRef || '').split(':')[1]) : '';
    const today = todayStr();

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const nextName = p.name.startsWith('【情报跟进】')
        ? `【客户跟进】${customer.name}`
        : p.name;
      return {
        ...p,
        contractRef: `CUST:${customerId}`,
        sourceType: capabilities.isIntelOrigin ? (p.sourceType || 'intel') : 'customer',
        sourceRef: capabilities.isIntelOrigin ? (p.sourceRef || signalId) : customerId,
        projectMode: p.projectMode || 'followup',
        customerId,
        name: nextName
      };
    }));

    if (signalId) {
      const signal = marketSignals.find(s => s.id === signalId);
      updateMarketSignal(signalId, { convertedTo: { ...(signal?.convertedTo || {}), projectId, customerId } });
    }

    setCustomers(prev => prev.map(c => {
      if (c.id !== customerId) return c;
      const nextRecords = [
        ...(c.followUpRecords || []),
        {
          id: `F-${Date.now()}`,
          date: today,
          type: 'system' as const,
          content: `已绑定情报跟进项目：${project.name}`,
          operator: normalizedCurrentUser.name
        }
      ];
      return { ...c, followUpRecords: nextRecords };
    }));

    addReminder({
      title: '🎯 跟进项目已绑定客户',
      content: `项目【${project.name}】已绑定客户【${customer.name}】。后续签约请在合同管理录入合同并自动立项。`,
      date: today,
      type: 'opportunity',
      linkType: 'project',
      linkId: projectId,
      ...buildReminderTarget([project.manager], ['MANAGER'])
    });

    return { ok: true };
  };

  // --- 系统自动扫描逻辑 (The Watchman) ---
  const runSystemScans = () => {
    const now = new Date();
    const nowMs = now.getTime();
    const today = new Date().toISOString().split('T')[0];

    // 1. Leads Scanning (Rules 1 & 2)
    leads.forEach(l => {
      if (l.status === Status.Converted || l.status === Status.Lost || !l.targetCertExpiryDate) return;
      
      const expiry = new Date(l.targetCertExpiryDate);
      if (Number.isNaN(expiry.getTime())) return;
      const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 3600 * 24));

      // Rule 2: < 60 days + High Intent -> Create FollowUp Project
      if (diffDays <= 60 && diffDays > 0 && l.intent === 'High') {
         const exists = projects.some(p => p.contractRef === `LEAD:${l.id}` && p.status === Status.Active);
              if (!exists) {
                 createFollowUpProjectFromLead(l.id, { expiryDate: l.targetCertExpiryDate });
                 upsertSystemReminder(`AUTO-LEAD-ACT-${l.id}`, {
                     title: `🚀 高意向线索自动立项`,
                     content: `线索【${l.company}】证书即将于 ${diffDays} 天后到期且意向度高，系统已自动创建跟进项目。`,
                     date: today,
                     type: 'task',
                     linkId: l.id,
                     linkType: 'lead',
                     forRole: ['MANAGER', 'CONSULTANT']
                 });
         }
         return;
      }

      // Rule 1: < 90 days -> Reminder
      if (diffDays <= 90 && diffDays > 0) {
         const remId = `AUTO-LEAD-WARN-${l.id}`;
         if (!reminders.some(r => r.id === remId)) {
             upsertSystemReminder(remId, {
                 title: `💡 线索证书即将到期`,
                 content: `线索【${l.company}】证书将于 ${diffDays} 天后到期，建议进行接触。`,
                 date: today,
                 type: 'opportunity',
                 linkId: l.id,
                 linkType: 'lead',
                 forRole: ['CONSULTANT']
             });
         }
      }
    });

    // 2. Customers Scanning (Rule 3)
    customers.forEach(c => {
         const certs = c.certificates || [];
         if (certs.length === 0) return;
         
         const sortedCerts = certs
            .filter(cer => cer.expiryDate && !Number.isNaN(new Date(cer.expiryDate).getTime()))
            .map(cer => ({ ...cer, diff: Math.ceil((new Date(cer.expiryDate).getTime() - now.getTime()) / (1000 * 3600 * 24)) }))
            .filter(item => item.diff > 0 && item.diff <= 120)
            .sort((a, b) => a.diff - b.diff);

         if (sortedCerts.length > 0) {
             const target = sortedCerts[0];
             const ref = `CUSTCERT:${c.id}:${target.id}`;
             const exists = projects.some(p => p.contractRef === ref && p.status === Status.Active);
             
             if (!exists) {
                 createFollowUpProjectFromCustomer(c.id, { certificateId: target.id, expiryDate: target.expiryDate });
                 upsertSystemReminder(`AUTO-CUST-RENEW-${c.id}-${target.id}`, {
                     title: `🔄 老客证书续期预警`,
                     content: `客户【${c.name}】的证书将于 ${target.diff} 天后到期，系统已自动创建续期跟进项目。`,
                     date: today,
                     type: 'opportunity',
                     linkId: c.id,
                     linkType: 'customer',
                     forRole: ['MANAGER', 'CONSULTANT']
                 });
             }
         }
    });

    // 3. Finance Scanning (Receivables + Payment Status)
    let hasContractStatusChanged = false;
    const updatedContracts = contracts.map(contract => {
      if (!Array.isArray(contract.receivables) || contract.receivables.length === 0) return contract;

      let receivableChanged = false;
      const normalizedReceivables = contract.receivables.map(receivable => {
        const runtimeStatus = deriveReceivableStatus(receivable, nowMs);
        if (runtimeStatus !== receivable.status) {
          receivableChanged = true;
          return { ...receivable, status: runtimeStatus };
        }
        return receivable;
      });

      normalizedReceivables.forEach(receivable => {
        if (receivable.status === 'paid') return;
        const dueMs = parseDateMs(receivable.dueDate);
        if (!dueMs) return;
        const diffDays = Math.ceil((dueMs - nowMs) / (1000 * 3600 * 24));
        const linkedProject = projects.find(p => p.contractRef === contract.id || (contract.contractNo && p.contractRef === contract.contractNo));
        const managerName = linkedProject?.manager || contract.contactPerson || '';

        if (diffDays <= 7 && diffDays >= 0) {
          const remId = `AUTO-AR-DUE-${contract.id}-${receivable.id}`;
          if (!reminders.some(r => r.id === remId)) {
            upsertSystemReminder(remId, {
              title: `💰 回款即将到期`,
              content: `客户【${contract.customerName}】${receivable.node} 将于 ${diffDays} 天后到期（¥${Number(receivable.amount || 0).toLocaleString()}），请提前催收。`,
              date: today,
              type: 'payment',
              linkId: contract.id,
              linkType: 'contract',
              ...buildReminderTarget([managerName], ['FINANCE', 'MANAGER'])
            });
          }
        }

        if (diffDays < 0 && diffDays >= -3) {
          const remId = `AUTO-AR-OVER-L1-${contract.id}-${receivable.id}`;
          if (!reminders.some(r => r.id === remId)) {
            upsertSystemReminder(remId, {
              title: `🚨 回款已逾期`,
              content: `客户【${contract.customerName}】${receivable.node} 已逾期 ${Math.abs(diffDays)} 天（¥${Number(receivable.amount || 0).toLocaleString()}）。`,
              date: today,
              type: 'risk',
              linkId: contract.id,
              linkType: 'contract',
              ...buildReminderTarget([managerName], ['FINANCE', 'MANAGER'])
            });
          }
        }

        if (diffDays < -3) {
          const remId = `AUTO-AR-OVER-L2-${contract.id}-${receivable.id}`;
          if (!reminders.some(r => r.id === remId)) {
            upsertSystemReminder(remId, {
              title: `🚨🚨 严重回款逾期`,
              content: `客户【${contract.customerName}】${receivable.node} 已严重逾期 ${Math.abs(diffDays)} 天（¥${Number(receivable.amount || 0).toLocaleString()}），请管理层介入。`,
              date: today,
              type: 'risk',
              linkId: contract.id,
              linkType: 'contract',
              forRole: ['ADMIN', 'MANAGER', 'FINANCE']
            });
          }
        }
      });

      if (!receivableChanged) return contract;
      hasContractStatusChanged = true;
      return { ...contract, receivables: normalizedReceivables };
    });

    const effectiveContracts = hasContractStatusChanged ? updatedContracts : contracts;
    if (hasContractStatusChanged) {
      setContracts(updatedContracts);
    }

    setProjects(prev => {
      let changed = false;
      const next = prev.map(project => {
        const linked = effectiveContracts.find(c => c.id === project.contractRef || (c.contractNo && project.contractRef === c.contractNo));
        if (!linked || !Array.isArray(linked.receivables) || linked.receivables.length === 0) return project;
        const nextStatus = deriveProjectPaymentStatus(linked.receivables);
        if (project.paymentStatus === nextStatus) return project;
        changed = true;
        return { ...project, paymentStatus: nextStatus };
      });
      return changed ? next : prev;
    });

    // 4. Audit Scanning (Deadline Escalation)
    auditIssues.forEach(issue => {
      if (issue.status === 'Closed' || !issue.deadline) return;
      const dueMs = parseDateMs(issue.deadline);
      if (!dueMs) return;
      const diffDays = Math.ceil((dueMs - nowMs) / (1000 * 3600 * 24));
      const issueLabel = issue.findings ? String(issue.findings).slice(0, 24) : issue.customerName;
      const targets = [issue.auditor];
      const fallbackRoles: RoleID[] = issue.severity === 'Major' ? ['ADMIN', 'MANAGER'] : ['MANAGER', 'CONSULTANT'];

      if (diffDays <= 2 && diffDays >= 0) {
        const remId = `AUTO-AUDIT-DUE-${issue.id}`;
        if (!reminders.some(r => r.id === remId)) {
          upsertSystemReminder(remId, {
            title: `🧾 不符合项临近截止`,
            content: `客户【${issue.customerName}】不符合项（${issueLabel}）将在 ${diffDays} 天后到期，请确认整改与验证进度。`,
            date: today,
            type: 'expire',
            linkId: issue.id,
            linkType: 'audit',
            ...buildReminderTarget(targets, fallbackRoles)
          });
        }
      }

      if (diffDays < 0) {
        const remId = `AUTO-AUDIT-OVER-${issue.id}`;
        if (!reminders.some(r => r.id === remId)) {
          upsertSystemReminder(remId, {
            title: issue.severity === 'Major' ? '🚨 重大不符合项逾期' : '⚠️ 不符合项逾期',
            content: `客户【${issue.customerName}】不符合项（${issueLabel}）已逾期 ${Math.abs(diffDays)} 天，请立即闭环。`,
            date: today,
            type: 'risk',
            linkId: issue.id,
            linkType: 'audit',
            ...buildReminderTarget(targets, fallbackRoles)
          });
        }
      }
    });

    // 5. Projects Scanning (Rule 4 + Zombies + AI Worker)
    projects.forEach(project => {
        if (project.status !== Status.Active) return;
        
        // Zombie Project
        if (!project.tasks || project.tasks.length === 0) {
            const remId = `AUTO-EMPTY-${project.id}`;
            if (!reminders.some(r => r.id === remId)) {
                upsertSystemReminder(remId, {
                    title: `⚠️ 僵尸项目预警`,
                    content: `项目【${project.name}】状态为进行中，但未创建任何任务，请尽快拆解任务或挂起项目。`,
                    date: today,
                    type: 'risk',
                    linkId: project.id,
                    linkType: 'project',
                    ...buildReminderTarget([project.manager], ['MANAGER'])
                });
            }
        }

        // Long-term Stagnant
        if (project.tasks.length > 0) {
            const createdTime = parseInt(project.id.split('-')[1] || '0');
            if (Date.now() - createdTime > 14 * 24 * 3600 * 1000 && project.progress === 0) {
                 const remId = `AUTO-STAGNANT-${project.id}`;
                 if (!reminders.some(r => r.id === remId)) {
                     upsertSystemReminder(remId, {
                         title: `🛑 项目长期停滞`,
                         content: `项目【${project.name}】已立项超过 2 周但进度仍为 0%，请负责人尽快推进或申请挂起。`,
                         date: today,
                         type: 'risk',
                         linkId: project.id,
                         linkType: 'project',
                         ...buildReminderTarget([project.manager], ['MANAGER'], ['U-002'])
                     });
                 }
            }
        }

        project.tasks.forEach(async (task) => {
          // --- AI Worker 自动执行逻辑 ---
          if (task.status === 'Pending' && (task.owner === 'AI 助手' || task.owner === 'AI-WORKER')) {
             console.log(`[AI Worker] 开始执行任务: ${task.title}`);
             try {
                 const execution = await aiService.executeProjectTask(task, project);
                 if (execution.success) {
                     updateProjectTask(project.id, task.id, { status: 'Completed' });
                     const knowledgeAccessUserIds = resolveUserIds(
                       [project.manager, task.owner].filter(name => name && !['AI 助手', 'AI-WORKER'].includes(name))
                     );
                     addKnowledgeDoc({
                         id: `DOC-AI-${Date.now()}`,
                         title: `[AI交付] ${task.title}`,
                         category: 'AI生成',
                         format: 'Markdown',
                         size: '2KB',
                         updatedAt: new Date().toISOString().split('T')[0],
                         content: execution.result,
                         summary: `AI 自动执行任务【${task.title}】生成的交付物`,
                         aiVisible: true,
                         source: 'ai',
                         autoGenerated: true,
                         linkType: 'project',
                         linkId: project.id,
                         linkTitle: project.name,
                         tags: ['AI交付', `project:${project.id}`],
                         accessRoles: KNOWLEDGE_MANAGEMENT_ROLES,
                         accessUserIds: knowledgeAccessUserIds
                     });
                     addReminder({
                         title: `🤖 AI 已完成任务：${task.title}`,
                         content: `AI 助手已自动执行并完成了任务，交付物已归档至知识库。`,
                         date: today,
                         type: 'task',
                         linkId: project.id,
                         linkType: 'project',
                         ...buildReminderTarget([project.manager], ['MANAGER'])
                     });
                 }
             } catch (e) {
                 console.error("AI Task Execution Failed", e);
             }
             return; 
          }

          if (task.status === 'Completed') return;
          
          const deadline = new Date(task.deadline);
          const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 3600 * 24));
          const duration = project.duration || 30;
          const alertDays = duration >= 15 ? 7 : 3;

          // Rule 4: Overdue Escalation
          if (diffDays <= alertDays && diffDays > 0) {
            const remId = `AUTO-EXP-${task.id}`;
              if (!reminders.some(r => r.id === remId)) {
                upsertSystemReminder(remId, {
                  title: `⏰ 任务即将在 ${diffDays} 天后到期`,
                  content: `项目【${project.name}】下的任务【${task.title}】即将到期，请尽快处理。`,
                  date: today,
                  type: 'expire',
                  linkId: project.id,
                  linkType: 'project',
                  ...buildReminderTarget([task.owner], ['MANAGER'])
              });
            }
          }

          if (diffDays < 0 && diffDays >= -3) {
             const remId = `AUTO-OVER-L1-${task.id}`;
               if (!reminders.some(r => r.id === remId)) {
                 upsertSystemReminder(remId, {
                   title: `🚨 任务已逾期`,
                   content: `任务【${task.title}】已逾期 ${Math.abs(diffDays)} 天，请立即处理。`,
                   date: today,
                   type: 'risk',
                   linkId: project.id,
                   linkType: 'project',
                   ...buildReminderTarget([task.owner, project.manager], ['MANAGER'])
               });
             }
          }

          if (diffDays < -3) {
            const remId = `AUTO-OVER-L2-${task.id}`;
              if (!reminders.some(r => r.id === remId)) {
                upsertSystemReminder(remId, {
                  title: `🚨🚨 严重逾期预警`,
                  content: `老板，项目【${project.name}】下的任务【${task.title}】已严重逾期 ${Math.abs(diffDays)} 天，请介入。`,
                  date: today,
                  type: 'risk',
                  linkId: project.id,
                  linkType: 'project',
                  forRole: ['ADMIN', 'MANAGER']
              });
            }
          }
        });
    });
  };

  useEffect(() => {
    const scanInterval = setInterval(runSystemScans, 10000); // 10s for demo
    return () => clearInterval(scanInterval);
  }, [leads, customers, contracts, projects, reminders, auditIssues]);

  // --- 进度自动计算算法 ---
  const calculateProjectProgress = (tasks: ProjectTask[]): number => {
    if (tasks.length === 0) return 0;
    // 已跳过的任务不进分母：跳过一个任务后进度永远到不了 100%，那是假的卡住
    const coreTasks = tasks.filter(t => t.category === 'Core' && t.status !== 'Skipped');
    if (coreTasks.length === 0) return 0;
    const completedCount = coreTasks.filter(t => t.status === 'Completed').length;
    return Math.round((completedCount / coreTasks.length) * 100);
  };

  // --- 项目操作逻辑 ---
  const buildProjectFromInput = (p: AddProjectInput): Project | null => {
    // 强制校验：必须有负责人
    if (!p.manager || p.manager === '待定') {
      console.warn('拒绝创建无负责人项目');
      return null;
    }

    const incomingAmount = Number((p as any).projectAmount ?? 0);
    const projectAmount = Number.isFinite(incomingAmount) && incomingAmount > 0 ? incomingAmount : 0;
    const costStatus: Project['costStatus'] = projectAmount > 0 ? '已确认' : '待补全';

    // 自动套用模板
    let initialTasks: ProjectTask[] = [];
    let initialServiceItems: ServiceItem[] = [];
    const category = (p as any).projectCategory || 'Delivery';
    const incomingContractRef = p.contractRef || '无关联';
    const inferredMeta = inferProjectMeta({
      contractRef: incomingContractRef,
      projectCategory: category,
      sourceType: (p as any).sourceType,
      sourceRef: (p as any).sourceRef,
      projectMode: (p as any).projectMode
    } as Project);

    const disableDefaultTemplateTasks = Boolean((p as any).disableDefaultTemplateTasks);

    // 1. 跟进项目：自动套用跟进模板
    if (category === 'FollowUp' && !disableDefaultTemplateTasks) {
        const tpl = taskTemplates.find(t => t.id === 'TEMPLATE_FOLLOWUP');
        if (tpl) {
            initialTasks = tpl.tasks.map((t, idx) => ({
                id: `T-${Date.now()}-${idx}`,
                title: t.title,
                deadline: new Date(Date.now() + (idx + 1) * 7 * 24 * 3600 * 1000).toISOString().split('T')[0], // 默认每周一个
                status: 'Pending',
                priority: t.priority as any,
                category: t.category as any,
                owner: p.manager!
            }));
        }
    } 
    // 2. 交付项目：自动套用交付模板
    if (category === 'Delivery' && !disableDefaultTemplateTasks) {
        const tpl = taskTemplates.find(t => t.id === 'TEMPLATE_DELIVERY');
        if (tpl) {
            initialTasks = tpl.tasks.map((t, idx) => ({
                id: `T-${Date.now()}-${idx}`,
                title: t.title,
                deadline: new Date(Date.now() + (idx + 1) * 7 * 24 * 3600 * 1000).toISOString().split('T')[0], 
                status: 'Pending',
                priority: t.priority as any,
                category: t.category as any,
                owner: p.manager!
            }));
        }
    }
    
    const seedItems = Array.isArray((p as any).initialServiceItems)
      ? ((p as any).initialServiceItems as Array<Omit<ServiceItem, 'id'>>)
      : [];
    if (seedItems.length > 0) {
      const usedNameKeys = new Set<string>();
      const generatedTasks: ProjectTask[] = [];
      initialServiceItems = seedItems
        .map((item) => {
          const serviceName = String(item?.name || '').trim();
          if (!serviceName) return null;
          const key = normalizeServiceToken(serviceName);
          if (!key || usedNameKeys.has(key)) return null;
          usedNameKeys.add(key);

          const serviceId = `SI-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          const resolvedCategory = item.category || inferServiceCategoryByName(serviceName);
          const resolvedTemplateId = item.workflowTemplateId || DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY[resolvedCategory];
          const next: ServiceItem = {
            id: serviceId,
            name: serviceName,
            owner: item.owner || p.manager || '待指派',
            status: item.status || 'Pending',
            notes: item.notes,
            catalogId: item.catalogId,
            standardName: item.standardName,
            rawName: item.rawName,
            category: resolvedCategory,
            deliveryMode: item.deliveryMode || SERVICE_CATEGORY_DELIVERY_MODE[resolvedCategory],
            workflowTemplateId: resolvedTemplateId,
            autoGenerateTasks: item.autoGenerateTasks !== false
          };
          if (next.autoGenerateTasks !== false) {
            generatedTasks.push(...buildWorkflowTasks({
              id: 'TMP',
              name: p.name || '未命名项目',
              contractRef: incomingContractRef,
              projectCategory: category,
              manager: p.manager || '待指派',
              progress: 0,
              status: Status.Active,
              paymentStatus: 'unpaid',
              deadline: p.deadline || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
              projectType: p.projectType || 'Self-Operated',
              tasks: [],
              settlementConfig: p.settlementConfig || { rule: 'Ratio', value: 10, base: 'Revenue' }
            } as Project, serviceId, resolvedTemplateId, next.owner));
          }
          return next;
        })
        .filter((item): item is ServiceItem => Boolean(item));

      if (generatedTasks.length > 0) {
        initialTasks = disableDefaultTemplateTasks ? generatedTasks : [...initialTasks, ...generatedTasks];
      }
    }

    return {
      id: `P-${Date.now()}`,
      name: p.name || '未命名项目',
      contractRef: incomingContractRef,
      sourceType: inferredMeta.sourceType,
      sourceRef: inferredMeta.sourceRef || undefined,
      projectMode: inferredMeta.projectMode,
      projectCategory: category,
      costStatus,
      projectAmount,
      manager: p.manager, // 此时必有值
      progress: calculateProjectProgress(initialTasks),
      status: Status.Active,
      paymentStatus: 'unpaid',
      deadline: p.deadline || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
      duration: p.duration || 30,
      projectType: p.projectType || 'Self-Operated',
      tasks: initialTasks, // 注入初始任务
      serviceItems: initialServiceItems,
      settlementConfig: p.settlementConfig || { rule: 'Ratio', value: 10, base: 'Revenue' }
    };
  };

  const addProject = (p: AddProjectInput) => {
    const newProject = buildProjectFromInput(p);
    if (!newProject) return;
    const previousProjects = projects;
    const nextProjects = [...projects, newProject];
    setProjects(nextProjects);

    if (projectService.isWriteEnabled()) {
      projectService.createProject(newProject)
        .then(async () => {
          if (!projectService.shouldVerifyWrites()) return;
          const persisted = await projectService.getProject(newProject.id);
          if (!persisted || persisted.name !== newProject.name) {
            throw new Error('project create readback mismatch');
          }
        })
        .catch(error => {
          console.warn('[ProjectService] create failed', error);
          if (projectService.shouldVerifyWrites()) {
            setProjects(previousProjects);
          }
        });
    }
  };

  const assignProjectManager = (projectId: string, manager: string, ownerUserId?: string): { ok: boolean; reason?: string } => {
    const nextManager = (manager || '').trim();
    if (!nextManager) return { ok: false, reason: '必须指定负责人' };

    const project = projects.find(p => p.id === projectId);
    if (!project) return { ok: false, reason: '项目不存在' };

    const perm = checkActionPermission('PROJECT_ASSIGN_MANAGER', project);
    if (!perm.allowed) return { ok: false, reason: perm.reason || '无权限' };

    // 负责人以用户 ID 为准：manager 只作显示用，改名不会让"我的项目"失联。
    // 未显式传 ID 时按姓名回查一次，兼容旧调用。
    const resolvedOwnerId = String(
      ownerUserId || userProfiles.find(u => u.name === nextManager)?.id || ''
    ).trim();

    const previousProjects = projects;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const oldManager = p.manager;
      const tasks = (p.tasks || []).map(t => {
        if (t.owner === '待指派' || t.owner === oldManager) return { ...t, owner: nextManager };
        return t;
      });
      return { ...p, manager: nextManager, ...(resolvedOwnerId ? { ownerUserId: resolvedOwnerId } : {}), tasks };
    });
    setProjects(nextProjects);

    if (projectService.isWriteEnabled()) {
      const nextProject = nextProjects.find(p => p.id === projectId);
      projectService.updateProject(projectId, nextProject || { manager: nextManager })
        .then(async () => {
          if (!projectService.shouldVerifyWrites()) return;
          const persisted = await projectService.getProject(projectId);
          if (!persisted || persisted.manager !== nextManager) {
            throw new Error('project manager readback mismatch');
          }
        })
        .catch(error => {
          console.warn('[ProjectService] manager update failed', error);
          if (projectService.shouldVerifyWrites()) {
            setProjects(previousProjects);
          }
        });
    }

    return { ok: true };
  };

  const createFollowUpTasks = (expiryDate: string | undefined, owner: string): ProjectTask[] => {
    const now = new Date();
    const base = expiryDate ? new Date(expiryDate) : new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const mk = (offsetDays: number, idx: number): ProjectTask => {
      const due = new Date(base.getTime() - offsetDays * 24 * 3600 * 1000);
      return {
        id: `T-FU-${Date.now()}-${idx}`,
        title: `认证到期前跟进（${offsetDays}天）`,
        deadline: fmt(due),
        status: 'Pending',
        priority: offsetDays <= 7 ? 'High' : 'Medium',
        category: 'Core',
        owner
      };
    };
    return [mk(30, 1), mk(15, 2), mk(7, 3)];
  };

  const createFollowUpProjectFromLead = (leadId: string, opts?: { owner?: string; expiryDate?: string }): string | null => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return null;

    // --- Hard Lock: Lifecycle Enforcement ---
    // Rule 1: Status Lock
    if (lead.status === Status.Converted) {
      alert("❌ 该线索已转化，请前往【客户库】创建新项目");
      return null;
    }

    // Rule 2: Association Lock (One-shot)
    const existingProjects = projects.filter(p => p.contractRef === `LEAD:${leadId}`);
    if (existingProjects.length > 0) {
      alert("❌ 该线索已生成过项目（无论状态），禁止重复使用。请前往【客户库】发起新合作。");
      return null;
    }
    // ----------------------------------------

    const owner = opts?.owner || normalizedCurrentUser.name || lead.name || '待定';
    const expiryDate = opts?.expiryDate;
    const projectId = `P-FU-${Date.now()}`;
    const tasks = createFollowUpTasks(expiryDate, owner);
    const newProject: Project = {
      id: projectId,
      name: `${lead.company} 认证到期挖角跟进`,
      contractRef: `LEAD:${leadId}`,
      sourceType: 'lead',
      sourceRef: leadId,
      projectMode: 'followup',
      projectCategory: 'FollowUp',
      manager: owner,
      progress: calculateProjectProgress(tasks),
      status: Status.Active,
      paymentStatus: 'unpaid',
      deadline: tasks.map(t => t.deadline).sort().slice(-1)[0] || new Date().toISOString().split('T')[0],
      duration: 30,
      projectType: 'Self-Operated',
      
      // T-001 Init
      costStatus: '待补全',
      projectAmount: 0,
      
      // 每个项目至少有一个服务项，避免系统里出现「有服务项 / 没服务项」两种结构
      tasks: attachTasksToDefaultService(tasks, `SVC-DEFAULT-${projectId}`),
      serviceItems: [buildDefaultServiceItem({
        projectId, projectName: `${lead.company} 认证到期挖角跟进`, owner
      })],
      settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
    };
    // 必须落库：线索会被锁成「已转化」并写入后端，项目若只进内存，
    // 刷新后就成了「线索已转化但项目不存在」，且线索无法再转，属于不可恢复的不一致。
    const previousProjectsForLead = projects;
    const nextProjectsForLead = [...projects, newProject];
    setProjects(nextProjectsForLead);
    commitProjectTransaction({
      projectId,
      nextProjects: nextProjectsForLead,
      previousProjects: previousProjectsForLead
    });
    updateLead(leadId, { status: Status.Converted }); // Hard Lock
    
    // addLeadFollowUp is no longer needed for Converted leads in active list, but good for history
    addLeadFollowUp(leadId, {
      date: new Date().toISOString().split('T')[0],
      type: 'system',
      content: `已立项：${newProject.name}（跟进项目）`,
      operator: normalizedCurrentUser.name
    });
    return projectId;
  };

  const createFollowUpProjectFromCustomer = (customerId: string, opts?: { owner?: string; expiryDate?: string; certificateId?: string }): string | null => {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return null;
    const certificateId = opts?.certificateId;
    const fallbackExpiry = (() => {
      const certs = customer.certificates || [];
      const withDate = certs.filter(c => c.expiryDate).map(c => ({ id: c.id, expiryDate: c.expiryDate }));
      withDate.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      return withDate[0]?.expiryDate;
    })();
    const expiryDate = opts?.expiryDate || fallbackExpiry;
    const ref = certificateId ? `CUSTCERT:${customerId}:${certificateId}` : `CUST:${customerId}`;
    const existing = projects.find(p => p.projectCategory === 'FollowUp' && p.contractRef === ref && p.status === Status.Active);
    if (existing) return existing.id;
    const owner = opts?.owner || normalizedCurrentUser.name || customer.contactPerson || '待定';
    const projectId = `P-FU-${Date.now()}`;
    const tasks = createFollowUpTasks(expiryDate, owner);
    const newProject: Project = {
      id: projectId,
      name: `${customer.name} 认证到期跟进`,
      contractRef: ref,
      sourceType: 'customer',
      sourceRef: certificateId ? `${customerId}:${certificateId}` : customerId,
      projectMode: 'followup',
      projectCategory: 'FollowUp',
      manager: owner,
      progress: calculateProjectProgress(tasks),
      status: Status.Active,
      paymentStatus: 'unpaid',
      deadline: tasks.map(t => t.deadline).sort().slice(-1)[0] || new Date().toISOString().split('T')[0],
      duration: 30,
      projectType: 'Self-Operated',
      // 同上：默认服务项保证任务不会悬空
      tasks: attachTasksToDefaultService(tasks, `SVC-DEFAULT-${projectId}`),
      serviceItems: [buildDefaultServiceItem({
        projectId, projectName: `${customer.name} 认证到期跟进`, owner
      })],
      settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
    };
    // 同样必须落库：客户跟进记录会写后端，项目不能只留内存
    const previousProjectsForCustomer = projects;
    const nextProjectsForCustomer = [...projects, newProject];
    setProjects(nextProjectsForCustomer);
    commitProjectTransaction({
      projectId,
      nextProjects: nextProjectsForCustomer,
      previousProjects: previousProjectsForCustomer
    });
    addCustomerFollowUp(customerId, {
      date: new Date().toISOString().split('T')[0],
      type: 'system',
      content: `已立项：${newProject.name}（跟进项目）`,
      operator: normalizedCurrentUser.name
    });
    return projectId;
  };

  const addProjectWorkLog: AppContextType['addProjectWorkLog'] = (payload) => {
    const projectId = String(payload?.projectId || '').trim();
    if (!projectId) return { ok: false, reason: '项目ID不能为空' };
    const project = projects.find(p => p.id === projectId);
    if (!project) return { ok: false, reason: '项目不存在' };

    const taskId = String(payload?.taskId || '').trim();
    const serviceItemIdRaw = String(payload?.serviceItemId || '').trim();
    const projectTasks = Array.isArray(project.tasks) ? project.tasks : [];
    const projectServiceItems = Array.isArray(project.serviceItems) ? project.serviceItems : [];

    if (!taskId && !serviceItemIdRaw) {
      return { ok: false, reason: '工作日志必须至少关联一个服务项或任务' };
    }

    const task = taskId ? projectTasks.find(t => t.id === taskId) : undefined;
    if (taskId && !task) {
      return { ok: false, reason: '关联任务不存在或不属于当前项目' };
    }

    const inferredServiceItemId = serviceItemIdRaw || task?.serviceItemId || '';
    if (inferredServiceItemId && !projectServiceItems.some(si => si.id === inferredServiceItemId)) {
      return { ok: false, reason: '关联服务项不存在或不属于当前项目' };
    }

    const workContent = String(payload?.workContent || '').trim();
    if (!workContent) return { ok: false, reason: '工作内容不能为空' };

    const actualHours = Number(payload?.actualHours || 0);
    if (!Number.isFinite(actualHours) || actualHours <= 0) {
      return { ok: false, reason: '实际耗时必须大于 0' };
    }

    const logDate = String(payload?.logDate || todayStr()).trim() || todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      return { ok: false, reason: '日志日期格式必须为 YYYY-MM-DD' };
    }

    const nowIso = new Date().toISOString();
    const next: ProjectWorkLog = {
      id: `WLOG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      projectId,
      serviceItemId: inferredServiceItemId || undefined,
      taskId: task?.id,
      logDate,
      workContent,
      actualHours,
      issueNote: String(payload?.issueNote || '').trim() || undefined,
      nextPlan: String(payload?.nextPlan || '').trim() || undefined,
      source: payload?.source || WORK_LOG_SOURCE.MANUAL,
      operatorUserId: effectiveUserId,
      operatorName: normalizedCurrentUser.name,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    setProjectWorkLogs(prev => [next, ...prev]);
    return { ok: true };
  };

  const updateProjectWorkLog: AppContextType['updateProjectWorkLog'] = (logId, updates) => {
    const id = String(logId || '').trim();
    if (!id) return { ok: false, reason: '日志ID不能为空' };
    const existing = projectWorkLogs.find(item => item.id === id);
    if (!existing) return { ok: false, reason: '日志不存在' };
    if (existing.operatorUserId !== effectiveUserId && activeRole !== 'ADMIN' && activeRole !== 'MANAGER') {
      return { ok: false, reason: '仅可编辑本人日志（管理员/经理可管理）' };
    }

    const patch: Partial<ProjectWorkLog> = {};
    if (typeof updates.logDate === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(updates.logDate)) return { ok: false, reason: '日志日期格式必须为 YYYY-MM-DD' };
      patch.logDate = updates.logDate;
    }
    if (typeof updates.workContent === 'string') {
      const workContent = updates.workContent.trim();
      if (!workContent) return { ok: false, reason: '工作内容不能为空' };
      patch.workContent = workContent;
    }
    if (updates.actualHours !== undefined) {
      const actualHours = Number(updates.actualHours);
      if (!Number.isFinite(actualHours) || actualHours <= 0) return { ok: false, reason: '实际耗时必须大于 0' };
      patch.actualHours = actualHours;
    }
    if (updates.issueNote !== undefined) {
      patch.issueNote = String(updates.issueNote || '').trim() || undefined;
    }
    if (updates.nextPlan !== undefined) {
      patch.nextPlan = String(updates.nextPlan || '').trim() || undefined;
    }

    setProjectWorkLogs(prev => prev.map(item => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
    return { ok: true };
  };

  const deleteProjectWorkLog: AppContextType['deleteProjectWorkLog'] = (logId) => {
    const id = String(logId || '').trim();
    if (!id) return { ok: false, reason: '日志ID不能为空' };
    const existing = projectWorkLogs.find(item => item.id === id);
    if (!existing) return { ok: false, reason: '日志不存在' };
    if (existing.operatorUserId !== effectiveUserId && activeRole !== 'ADMIN' && activeRole !== 'MANAGER') {
      return { ok: false, reason: '仅可删除本人日志（管理员/经理可管理）' };
    }
    setProjectWorkLogs(prev => prev.filter(item => item.id !== id));
    return { ok: true };
  };

  const commitProjectTransaction = (params: {
    projectId?: string;
    nextProjects: Project[];
    nextProjectWorkLogs?: ProjectWorkLog[];
    nextCustomers?: Customer[];
    nextReminders?: Reminder[];
    nextKnowledgeDocs?: KnowledgeDoc[];
    previousProjects: Project[];
    previousProjectWorkLogs?: ProjectWorkLog[];
    previousCustomers?: Customer[];
    previousReminders?: Reminder[];
    previousKnowledgeDocs?: KnowledgeDoc[];
    verify?: (datasets: Record<string, unknown>) => void;
  }) => {
    if (!projectService.isWriteEnabled()) return;

    const datasets: ProjectTransactionDatasets = {
      projects_v8: params.nextProjects
    };
    const readbackKeys = ['projects_v8'];

    if (params.nextProjectWorkLogs) {
      datasets.project_work_logs_v1 = params.nextProjectWorkLogs;
      readbackKeys.push('project_work_logs_v1');
    }
    if (params.nextCustomers) {
      datasets.customers_v8 = params.nextCustomers;
      readbackKeys.push('customers_v8');
    }
    if (params.nextReminders) {
      datasets.reminders_v8 = params.nextReminders;
      readbackKeys.push('reminders_v8');
    }
    if (params.nextKnowledgeDocs) {
      datasets.knowledge_docs_v8 = params.nextKnowledgeDocs;
      readbackKeys.push('knowledge_docs_v8');
    }

    projectService.commitTransaction(datasets, params.projectId)
      .then(async () => {
        if (!projectService.shouldVerifyWrites()) return;
        const readback = await stateSyncService.fetchState(readbackKeys);
        if (!readback?.ok) throw new Error(readback?.error || 'project transaction readback failed');
        const readbackDatasets = (readback.datasets || {}) as Record<string, unknown>;
        if (params.projectId) {
          const readbackProjects = asArray<Project>(readbackDatasets.projects_v8) || [];
          if (!readbackProjects.some(item => item.id === params.projectId)) {
            throw new Error('project transaction readback missing project');
          }
        }
        params.verify?.(readbackDatasets);
      })
      .catch(error => {
        console.warn('[ProjectService] transaction failed', error);
        if (!projectService.shouldVerifyWrites()) return;
        setProjects(params.previousProjects);
        if (params.previousProjectWorkLogs) setProjectWorkLogs(params.previousProjectWorkLogs);
        if (params.previousCustomers) setCustomers(params.previousCustomers);
        if (params.previousReminders) setReminders(params.previousReminders);
        if (params.previousKnowledgeDocs) setKnowledgeDocs(params.previousKnowledgeDocs);
      });
  };

  const updateProjectTask = (projectId: string, taskId: string, updates: Partial<ProjectTask>) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      setProjects(prev => prev.map(p => {
        if (p.id !== projectId) return p;
        const newTasks = (p.tasks || []).map(t => t.id === taskId ? { ...t, ...updates } : t);
        return { ...p, tasks: newTasks, progress: calculateProjectProgress(newTasks) };
      }));
      return;
    }

    const previousProjects = projects;
    const previousProjectWorkLogs = projectWorkLogs;
    const oldTask = (project.tasks || []).find(t => t.id === taskId);
    const newTasks = (project.tasks || []).map(t => t.id === taskId ? { ...t, ...updates } : t);
    const statusChangedToCompleted = Boolean(oldTask && updates.status === 'Completed' && oldTask.status !== 'Completed');
    const allCompleted = newTasks.length > 0 && newTasks.every(t => t.status === 'Completed');
    const inferredServiceItemId = String((updates.serviceItemId || oldTask?.serviceItemId || '')).trim();
    const canAppendTaskLog = statusChangedToCompleted && (
      !inferredServiceItemId || (project.serviceItems || []).some(si => si.id === inferredServiceItemId)
    );

    if (statusChangedToCompleted && allCompleted && project.status !== Status.Completed) {
      const nowIso = new Date().toISOString();
      const createdLog: ProjectWorkLog | null = canAppendTaskLog ? {
        id: `WLOG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        projectId,
        serviceItemId: inferredServiceItemId || undefined,
        taskId,
        logDate: todayStr(),
        workContent: `完成任务：${String(updates.title || oldTask?.title || '未命名任务')}`,
        actualHours: 0.5,
        issueNote: undefined,
        nextPlan: undefined,
        source: WORK_LOG_SOURCE.TASK_TRANSITION,
        operatorUserId: effectiveUserId,
        operatorName: normalizedCurrentUser.name,
        createdAt: nowIso,
        updatedAt: nowIso
      } : null;
      const nextProjectWorkLogs = createdLog ? [createdLog, ...projectWorkLogs] : projectWorkLogs;
      if (createdLog) setProjectWorkLogs(nextProjectWorkLogs);
      void completeProject(projectId, {
        source: 'auto',
        tasksOverride: newTasks,
        projectWorkLogsOverride: createdLog ? {
          next: nextProjectWorkLogs,
          previous: projectWorkLogs,
          expectedLogId: createdLog.id
        } : undefined
      });
      return;
    }

    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, tasks: newTasks, progress: calculateProjectProgress(newTasks) };
    });

    const nowIso = new Date().toISOString();
    const createdLog: ProjectWorkLog | null = canAppendTaskLog ? {
      id: `WLOG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      projectId,
      serviceItemId: inferredServiceItemId || undefined,
      taskId,
      logDate: todayStr(),
      workContent: `完成任务：${String(updates.title || oldTask?.title || '未命名任务')}`,
      actualHours: 0.5,
      issueNote: undefined,
      nextPlan: undefined,
      source: WORK_LOG_SOURCE.TASK_TRANSITION,
      operatorUserId: effectiveUserId,
      operatorName: normalizedCurrentUser.name,
      createdAt: nowIso,
      updatedAt: nowIso
    } : null;
    const nextProjectWorkLogs = createdLog ? [createdLog, ...projectWorkLogs] : projectWorkLogs;

    if (createdLog) setProjectWorkLogs(nextProjectWorkLogs);
    setProjects(nextProjects);

    if (typeof updates.status === 'string') {
      commitProjectTransaction({
        projectId,
        nextProjects,
        nextProjectWorkLogs: createdLog ? nextProjectWorkLogs : undefined,
        previousProjects,
        previousProjectWorkLogs: createdLog ? previousProjectWorkLogs : undefined,
        verify: datasets => {
          const readbackProjects = asArray<Project>(datasets.projects_v8) || [];
          const readbackProject = readbackProjects.find(item => item.id === projectId);
          const readbackTask = (readbackProject?.tasks || []).find(item => item.id === taskId);
          if (!readbackTask || readbackTask.status !== updates.status) {
            throw new Error('project task status readback mismatch');
          }
          if (createdLog) {
            const readbackLogs = asArray<ProjectWorkLog>(datasets.project_work_logs_v1) || [];
            if (!readbackLogs.some(item => item.id === createdLog.id && item.projectId === projectId && item.taskId === taskId)) {
              throw new Error('project task log readback mismatch');
            }
          }
        }
      });
    }
  };

  const buildWorkflowTasks = (project: Project, serviceItemId: string, templateId?: string, ownerName?: string): ProjectTask[] => {
    if (!templateId) return [];
    const template = SERVICE_WORKFLOW_TEMPLATES.find(t => t.id === templateId);
    if (!template) return [];
    const base = new Date();
    const owner = ownerName || project.manager || '待指派';
    return template.steps.map((step, idx) => {
      const due = new Date(base.getTime() + step.offsetDays * 24 * 3600 * 1000);
      const priority = step.priority || (step.offsetDays <= 7 ? 'High' : step.offsetDays <= 21 ? 'Medium' : 'Low');
      return {
        id: `T-WF-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`,
        title: step.title,
        deadline: due.toISOString().split('T')[0],
        status: 'Pending',
        priority,
        category: step.category,
        owner,
        serviceItemId
      };
    });
  };

  const addProjectServiceItem = (projectId: string, item: Omit<ServiceItem, 'id'>) => {
    const name = (item?.name || '').trim() || '新服务项';
    const status = item?.status || 'Pending';
    const owner = item?.owner;
    const notes = item?.notes;
    const previousProjects = projects;
    let createdServiceItem: ServiceItem | null = null;
    let generatedTaskIds: string[] = [];
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const serviceItems = Array.isArray(p.serviceItems) ? p.serviceItems : [];
      const allowAutoTasks = item?.autoGenerateTasks !== false;
      const resolvedTemplateId = allowAutoTasks
        ? (item?.workflowTemplateId ?? (item?.category ? DEFAULT_SERVICE_WORKFLOW_BY_CATEGORY[item.category] : undefined))
        : undefined;
      const next: ServiceItem = {
        id: `SI-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name,
        status,
        owner,
        notes,
        catalogId: item?.catalogId,
        standardName: item?.standardName,
        rawName: item?.rawName,
        category: item?.category,
        deliveryMode: item?.deliveryMode,
        workflowTemplateId: resolvedTemplateId
      };
      createdServiceItem = next;
      const generatedTasks = buildWorkflowTasks(p, next.id, resolvedTemplateId, owner || p.manager);
      generatedTaskIds = generatedTasks.map(task => task.id);
      const tasks = [...(p.tasks || []), ...generatedTasks];
      return { ...p, serviceItems: [...serviceItems, next], tasks, progress: calculateProjectProgress(tasks) };
    });
    setProjects(nextProjects);

    if (createdServiceItem) {
      commitProjectTransaction({
        projectId,
        nextProjects,
        previousProjects,
        verify: datasets => {
          const readbackProjects = asArray<Project>(datasets.projects_v8) || [];
          const readbackProject = readbackProjects.find(project => project.id === projectId);
          const serviceItems = Array.isArray(readbackProject?.serviceItems) ? readbackProject!.serviceItems : [];
          if (!serviceItems.some(serviceItem => serviceItem.id === createdServiceItem!.id && serviceItem.name === createdServiceItem!.name)) {
            throw new Error('project service item create readback mismatch');
          }
          if (generatedTaskIds.length > 0) {
            const tasks = Array.isArray(readbackProject?.tasks) ? readbackProject!.tasks : [];
            const persistedTaskIds = new Set(tasks.map(task => task.id));
            if (!generatedTaskIds.every(taskId => persistedTaskIds.has(taskId))) {
              throw new Error('project service item generated tasks readback mismatch');
            }
          }
        }
      });
    }
  };

  const updateProjectServiceItem = (projectId: string, itemId: string, updates: Partial<ServiceItem>) => {
    const previousProjects = projects;
    let updatedServiceItem: ServiceItem | null = null;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const serviceItems = Array.isArray(p.serviceItems) ? p.serviceItems : [];
      const next = serviceItems.map(si => {
        if (si.id !== itemId) return si;
        const name = typeof updates.name === 'string' ? updates.name : si.name;
        const normalizedName = (name || '').trim() || '未命名服务项';
        updatedServiceItem = { ...si, ...updates, name: normalizedName };
        return updatedServiceItem;
      });
      return { ...p, serviceItems: next };
    });
    setProjects(nextProjects);

    if (updatedServiceItem) {
      commitProjectTransaction({
        projectId,
        nextProjects,
        previousProjects,
        verify: datasets => {
          const readbackProjects = asArray<Project>(datasets.projects_v8) || [];
          const readbackProject = readbackProjects.find(project => project.id === projectId);
          const serviceItems = Array.isArray(readbackProject?.serviceItems) ? readbackProject!.serviceItems : [];
          if (!serviceItems.some(serviceItem => serviceItem.id === itemId && serviceItem.name === updatedServiceItem!.name)) {
            throw new Error('project service item update readback mismatch');
          }
        }
      });
    }
  };

  const deleteProjectServiceItem = (projectId: string, itemId: string) => {
    const previousProjects = projects;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const serviceItems = Array.isArray(p.serviceItems) ? p.serviceItems : [];
      const nextItems = serviceItems.filter(si => si.id !== itemId);
      const tasks = (p.tasks || []).map(t => (t.serviceItemId === itemId ? { ...t, serviceItemId: undefined } : t));
      return { ...p, serviceItems: nextItems, tasks };
    });
    setProjects(nextProjects);
    commitProjectTransaction({ projectId, nextProjects, previousProjects });
  };

  const addProjectTask = (projectId: string, task: Omit<ProjectTask, 'id'>) => {
    const previousProjects = projects;
    let createdTask: ProjectTask | null = null;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      // 使用更随机的 ID 避免快速点击时的冲突
      createdTask = { ...task, id: `T-${Date.now()}-${Math.floor(Math.random() * 10000)}` };
      const newTasks = [...p.tasks, createdTask];
      return { ...p, tasks: newTasks, progress: calculateProjectProgress(newTasks) };
    });
    setProjects(nextProjects);

    if (projectService.isWriteEnabled() && createdTask) {
      projectService.addTask(projectId, createdTask)
        .then(async () => {
          if (!projectService.shouldVerifyWrites()) return;
          const persisted = await projectService.getProject(projectId);
          const tasks = Array.isArray(persisted?.tasks) ? persisted.tasks : [];
          if (!tasks.some(item => item.id === createdTask!.id && item.title === createdTask!.title)) {
            throw new Error('project task create readback mismatch');
          }
        })
        .catch(error => {
          console.warn('[ProjectService] task create failed', error);
          if (projectService.shouldVerifyWrites()) {
            setProjects(previousProjects);
          }
        });
    }
  };

  const deleteProjectTask = (projectId: string, taskId: string) => {
    const previousProjects = projects;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const newTasks = p.tasks.filter(t => t.id !== taskId);
      return { ...p, tasks: newTasks, progress: calculateProjectProgress(newTasks) };
    });
    setProjects(nextProjects);
    commitProjectTransaction({ projectId, nextProjects, previousProjects });
  };

  const resolveProjectPDCAContext = (project: Project, contractOverride?: Contract) => {
    const linkedContract = contractOverride || contracts.find(c => c.id === project.contractRef || c.contractNo === project.contractRef);
    const primaryServiceItem = (project.serviceItems || []).find(si => si.standardName || si.name);
    const catalogMatch = primaryServiceItem ? null : matchServiceCatalogText(`${linkedContract?.serviceLine || ''} ${linkedContract?.title || ''} ${project.name || ''}`);
    const projectTypeLabel =
      primaryServiceItem?.standardName ||
      primaryServiceItem?.name ||
      catalogMatch?.name ||
      linkedContract?.serviceLine ||
      linkedContract?.title ||
      project.name ||
      project.projectType ||
      'Self-Operated';

    const serviceCategory = primaryServiceItem?.category || catalogMatch?.category;
    const certCategories = ['体系认证', '产品认证', '生产许可类'];
    const isCertProject = Boolean(
      (serviceCategory && certCategories.includes(serviceCategory)) ||
      projectTypeLabel.includes('体系') ||
      projectTypeLabel.includes('认证') ||
      project.name.includes('体系') ||
      project.name.includes('认证') ||
      (project.contractRef || '').includes('CERT')
    );

    const nextOpportunity = (() => {
      if (serviceCategory === '政府项目申报') return '政策窗口/复评';
      if (serviceCategory === '管理培训/顾问服务') return '续费/复训';
      if (serviceCategory === '其他') return '待评估';
      return isCertProject ? '年审' : '待评估';
    })();

    return {
      projectTypeLabel,
      serviceCategory,
      nextOpportunity,
      isCertProject,
      linkedContract
    };
  };

  const buildPdcaKnowledgeDoc = (params: {
    customer: Customer;
    contract?: Contract | null;
    project?: Project | null;
    projectTypeLabel?: string;
    nextOpportunity?: string;
  }): KnowledgeDoc => {
    const nowStr = todayStr();
    const contract = params.contract || null;
    const project = params.project || null;
    const receivables = contract?.receivables || [];
    const paidCount = receivables.filter(r => r.status === 'paid').length;
    const contractAmount = Number(contract?.amount || 0);
    const serviceItems = (project?.serviceItems || [])
      .map(si => si.standardName || si.name || si.rawName)
      .filter(Boolean);
    const serviceLabel =
      serviceItems.join(' / ') ||
      params.projectTypeLabel ||
      contract?.serviceLine ||
      contract?.title ||
      project?.name ||
      '未填写';

    const tasks = project?.tasks || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'Completed').length;
    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const taskLines = totalTasks > 0
      ? tasks.slice(0, 8).map(t => `- ${t.title}（${t.status === 'Completed' ? '已完成' : '进行中'}，负责人：${t.owner || '待分配'}）`).join('\n')
      : '- 暂无任务流水（请补充）';

    const receivableLines = receivables.length > 0
      ? receivables.map(r => `- ${r.node}：¥${Number(r.amount || 0).toLocaleString()}（${r.status === 'paid' ? '已回款' : '未回款'}）`).join('\n')
      : '- 暂无回款节点';

    const titleBase = contract?.title || project?.name || serviceLabel;
    const summary = `回款已完成，系统自动生成 PDCA 复盘草稿（服务：${serviceLabel}）。`;

    const content = `# 客户复盘 (PDCA)

## 基本信息
- 客户：${params.customer.name}
- 项目/合同：${titleBase}
- 服务项：${serviceLabel}
- 合同金额：¥${contractAmount.toLocaleString()}
- 回款进度：${paidCount}/${receivables.length}

## P 计划
- 目标/范围：${serviceLabel}
- 负责人：${project?.manager || contract?.contactPerson || '待指派'}
- 关键里程碑：请补充

## D 执行
- 任务完成率：${totalTasks > 0 ? `${taskCompletionRate}% (${completedTasks}/${totalTasks})` : '暂无任务记录'}
${taskLines}

## C 检查
- 质量/进度结论：请补充
- 风险问题：请补充

## A 改进
- 下一次机会：${params.nextOpportunity || '待评估'}
- 可复用资产：请补充
- 经验教训：请补充

## 回款明细
${receivableLines}
`;

    const tags = ['PDCA', '回款完成', serviceLabel];
    if (contract?.id) tags.push(`contract:${contract.id}`);
    if (project?.id) tags.push(`project:${project.id}`);

    /*
      标准识别与标题拼装走共用模块，和服务端 completeProject.js 用同一份规则。

      2026-08-24 之前两边是各写各的：服务端那份带标准号、可信层级、行业标签，
      这份只有标题和分类。于是同一个业务动作产出的复盘质量
      **取决于一个环境变量**，而没人知道，也不会有任何报错。
    */
    const standards = detectStandards(serviceLabel, contract?.serviceLine, contract?.title,
                                      project?.name, content);

    return {
      id: `DOC-PDCA-${Date.now()}`,
      title: buildPdcaTitle(params.customer.name, serviceLabel, standards),
      category: 'PDCA',
      format: 'Markdown',
      size: '2 KB',
      updatedAt: nowStr,
      content,
      summary,
      aiVisible: true,
      source: 'system',
      autoGenerated: true,
      // 复盘是我们自己的经验，不是标准原文——AI 引用时要说明出处
      trustLevel: 'ourExperience',
      standards,
      industry: params.customer.industry || '',
      linkType: 'customer',
      linkId: params.customer.id,
      linkTitle: params.customer.name,
      tags: [...tags, ...standards],
      accessRoles: KNOWLEDGE_MANAGEMENT_ROLES
    };
  };

  const applyCustomerPDCAUpdate = (customerId: string, update: Partial<Customer>) => {
    setCustomers(prev => prev.map(c => {
      if (c.id !== customerId) return c;
      return { ...c, ...update };
    }));
  };

  /*
    这里原来有一份 completeProjectLocal —— 纯前端的项目完成级联，
    作为「后端写开关关闭时」的回退。2026-08-24 删除。

    删的理由不是它没用，是**两套实现已经产出不同的结果**：
    后端会生成客户复盘 PDCA 知识文档，前端本地版一份都不生成
    （实测 0 处知识文档相关代码）。而复盘正是知识中心最值钱的部分。

    也就是说，一旦走回退路径，项目完成了、客户分级更新了、提醒发了，
    **唯独复盘没了**——而没有人会发现，因为没有任何报错。

    写开关（VITE_PROJECTS_API_WRITE_ENABLED）实测为开，回退路径到不了。
    留着一条到不了、又和主路径不一致的代码，只会在将来某次
    「临时关掉开关排查问题」时悄悄少写一份复盘。

    现在关掉开关会**明确报错**，而不是静默走另一套逻辑。
  */

  // 项目完成级联后，从 PG 重拉受影响数据集，让 UI 反映后端权威结果（客户分级/提醒/PDCA/结算草稿）。
  const refreshAfterProjectCompletion = async () => {
    await Promise.all([
      projectService.isReadEnabled() ? projectService.listProjects().then(setProjects).catch(() => {}) : Promise.resolve(),
      customerService.isReadEnabled() ? customerService.listCustomers().then(setCustomers).catch(() => {}) : Promise.resolve(),
      reminderService.isReadEnabled() ? reminderService.listReminders().then(setReminders).catch(() => {}) : Promise.resolve(),
      settlementService.isReadEnabled() ? settlementService.listSettlements().then(setSettlements).catch(() => {}) : Promise.resolve(),
      knowledgeService.isReadEnabled() ? knowledgeService.listDocs().then(setKnowledgeDocs).catch(() => {}) : Promise.resolve(),
    ]);
  };

  // 单一业务权威入口：写开关开启时委托后端原子级联，前端仅用返回结果刷新；否则回退到 completeProjectLocal（迁移前）。
  const completeProject = async (projectId: string, opts?: CompleteProjectOptions): Promise<{ ok: boolean; eventId?: string; reason?: string }> => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return { ok: false, reason: '项目不存在' };
    if (project.status === Status.Completed) return { ok: false, reason: '项目已完成' };

    if (projectService.isWriteEnabled()) {
      try {
        const res = await projectService.complete(projectId, {
          source: opts?.source,
          tasksOverride: opts?.tasksOverride,
        });
        // 工作日志是前端侧衍生（未迁 PG，txUpsert 显式忽略），保持本地行为即可。
        if (opts?.projectWorkLogsOverride?.next) {
          setProjectWorkLogs(opts.projectWorkLogsOverride.next);
        }
        await refreshAfterProjectCompletion();
        return { ok: true, eventId: res.eventId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, reason };
      }
    }

    /*
      不再有前端回退。开关关掉时明确报错，而不是悄悄走另一套逻辑——
      静默降级比报错危险：两条路产出的结果不一样，而没人会发现。
    */
    return { ok: false, reason: '项目完成需要后端服务（VITE_PROJECTS_API_WRITE_ENABLED 未开启）' };
  };

  const reopenProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return { ok: false, reason: '项目不存在' };
    if (project.status !== Status.Completed || !project.completionRecord) return { ok: false, reason: '项目未完成' };

    const record = project.completionRecord;
    const reminderIds = Array.isArray(record.generatedReminderIds) ? record.generatedReminderIds : [];
    const customerId = record.customerId;
    const customerPatchBefore = record.customerPatchBefore;
    const previousProjects = projects;
    const previousReminders = reminders;
    const previousCustomers = customers;

    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const progress = calculateProjectProgress(p.tasks || []);
      return { ...p, status: Status.Active, progress, completionRecord: undefined };
    });

    let nextReminders = reminders;
    if (reminderIds.length > 0) {
      const idSet = new Set(reminderIds);
      nextReminders = reminders.filter(r => !idSet.has(r.id));
    }

    let nextCustomers = customers;
    if (customerId && customerPatchBefore) {
      nextCustomers = customers.map(c => {
        if (c.id !== customerId) return c;
        return {
          ...c,
          status: customerPatchBefore.status,
          firstServiceDate: customerPatchBefore.firstServiceDate,
          lastServiceDate: customerPatchBefore.lastServiceDate,
          serviceCount: customerPatchBefore.serviceCount,
          cooperationCount: customerPatchBefore.cooperationCount,
          lastProjectAt: customerPatchBefore.lastProjectAt,
          lastProjectType: customerPatchBefore.lastProjectType,
          nextOpportunity: customerPatchBefore.nextOpportunity,
          totalAmount: customerPatchBefore.totalAmount,
          yearAmount: customerPatchBefore.yearAmount,
          level: customerPatchBefore.level
        };
      });
    }

    setProjects(nextProjects);
    if (reminderIds.length > 0) setReminders(nextReminders);
    if (customerId && customerPatchBefore) setCustomers(nextCustomers);

    commitProjectTransaction({
      projectId,
      nextProjects,
      nextReminders: reminderIds.length > 0 ? nextReminders : undefined,
      nextCustomers: customerId && customerPatchBefore ? nextCustomers : undefined,
      previousProjects,
      previousReminders: reminderIds.length > 0 ? previousReminders : undefined,
      previousCustomers: customerId && customerPatchBefore ? previousCustomers : undefined,
      verify: datasets => {
        const readbackProjects = asArray<Project>(datasets.projects_v8) || [];
        const readbackProject = readbackProjects.find(item => item.id === projectId);
        if (readbackProject?.status !== Status.Active || readbackProject.completionRecord) {
          throw new Error('project reopen readback mismatch');
        }
        if (reminderIds.length > 0) {
          const readbackReminders = asArray<Reminder>(datasets.reminders_v8) || [];
          const persistedReminderIds = new Set(readbackReminders.map(item => item.id));
          if (reminderIds.some(id => persistedReminderIds.has(id))) {
            throw new Error('project reopen reminder cleanup readback mismatch');
          }
        }
        if (customerId && customerPatchBefore) {
          const readbackCustomers = asArray<Customer>(datasets.customers_v8) || [];
          const readbackCustomer = readbackCustomers.find(item => item.id === customerId);
          if (!readbackCustomer) throw new Error('project reopen customer readback missing');
          if (
            readbackCustomer.firstServiceDate !== customerPatchBefore.firstServiceDate ||
            readbackCustomer.lastServiceDate !== customerPatchBefore.lastServiceDate ||
            readbackCustomer.serviceCount !== customerPatchBefore.serviceCount ||
            readbackCustomer.cooperationCount !== customerPatchBefore.cooperationCount ||
            readbackCustomer.lastProjectAt !== customerPatchBefore.lastProjectAt ||
            readbackCustomer.lastProjectType !== customerPatchBefore.lastProjectType ||
            readbackCustomer.nextOpportunity !== customerPatchBefore.nextOpportunity ||
            readbackCustomer.totalAmount !== customerPatchBefore.totalAmount ||
            readbackCustomer.yearAmount !== customerPatchBefore.yearAmount ||
            readbackCustomer.level !== customerPatchBefore.level
          ) {
            throw new Error('project reopen customer rollback readback mismatch');
          }
        }
      }
    });

    return { ok: true };
  };

  const updateProjectCost = (projectId: string, amount: number) => {
    if (amount <= 0) return { ok: false, reason: '项目金额必须大于 0' };

    const previousProjects = projects;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        projectAmount: amount,
        costStatus: '已确认' as const // T-002 Auto Linkage
      };
    });
    setProjects(nextProjects);

    if (projectService.isWriteEnabled()) {
      projectService.updateProject(projectId, {
        projectAmount: amount,
        costStatus: '已确认' as const
      })
        .then(async () => {
          if (!projectService.shouldVerifyWrites()) return;
          const persisted = await projectService.getProject(projectId);
          if (!persisted || Number(persisted.projectAmount || 0) !== amount || persisted.costStatus !== '已确认') {
            throw new Error('project cost readback mismatch');
          }
        })
        .catch(error => {
          console.warn('[ProjectService] cost update failed', error);
          if (projectService.shouldVerifyWrites()) {
            setProjects(previousProjects);
          }
        });
    }
    return { ok: true };
  };

  const applyTemplateToProject = (projectId: string, templateId: string) => {
    const template = taskTemplates.find(t => t.id === templateId);
    if (!template) return;
    const now = todayStr();
    // 套模板会一次生成一批任务，不落库的话刷新就全没了
    const previousProjects = projects;
    const nextProjects = projects.map(p => {
      if (p.id !== projectId) return p;
      const baseDate = new Date();
      const newTasks: ProjectTask[] = template.tasks.map((t, idx) => ({
        ...t,
        // 使用更随机的 ID
        id: `T-TPL-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`,
        status: 'Pending',
        owner: p.manager,
        deadline: new Date(baseDate.getTime() + (idx + 1) * 5 * 24 * 3600 * 1000).toISOString().split('T')[0]
      }));
      return { ...p, tasks: [...p.tasks, ...newTasks], progress: calculateProjectProgress([...p.tasks, ...newTasks]) };
    });
    setProjects(nextProjects);
    commitProjectTransaction({ projectId, nextProjects, previousProjects });
    setTaskTemplates(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const usageCount = Number.isFinite(Number(t.usageCount)) ? Number(t.usageCount) : 0;
      return { ...t, usageCount: usageCount + 1, lastUsedAt: now, updatedAt: now };
    }));
  };



  const addLead = (lead: Omit<Lead, 'id'>) => {
    // 归属人以用户 ID 落库：判断「我的线索」不再靠姓名比对，改名/重名都不会串
    const newLead: Lead = {
      ...lead,
      id: `L-${Date.now()}`,
      ownerUserId: lead.ownerUserId || normalizedCurrentUser.id
    };
    const previousLeads = leads;
    setLeads(prev => [newLead, ...prev]);
    if (leadService.isEnabled()) {
      leadService.createLead(newLead)
        .then(async savedLead => {
          if (leadService.shouldVerifyWrites()) {
            const verifiedLead = await leadService.getLead(savedLead.id);
            if (verifiedLead.id !== savedLead.id || verifiedLead.company !== savedLead.company) {
              throw new Error('created lead readback mismatch');
            }
          }
          setLeads(prev => prev.map(l => l.id === newLead.id ? savedLead : l));
        })
        .catch(error => {
          console.warn('[LeadService] create failed', error);
          if (leadService.shouldVerifyWrites()) {
            setLeads(previousLeads);
          }
        });
    }
  };

  const updateLead = (id: string, updates: Partial<Lead>) => {
    const previousLeads = leads;
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    if (leadService.isEnabled()) {
      leadService.updateLead(id, updates)
        .then(async savedLead => {
          if (leadService.shouldVerifyWrites()) {
            const verifiedLead = await leadService.getLead(savedLead.id);
            if (verifiedLead.id !== savedLead.id || verifiedLead.company !== savedLead.company) {
              throw new Error('updated lead readback mismatch');
            }
          }
          setLeads(prev => prev.map(l => l.id === id ? savedLead : l));
        })
        .catch(error => {
          console.warn('[LeadService] update failed', error);
          if (leadService.shouldVerifyWrites()) {
            setLeads(previousLeads);
          }
        });
    }
  };

  const addLeadFollowUp = (leadId: string, record: Omit<FollowUpRecord, 'id'>) => {
    const newRecord = { ...record, id: `F-${Date.now()}` };
    const previousLeads = leads;
    setLeads(prev => prev.map(l => {
      if (l.id !== leadId) return l;
      const followUpRecords = [...(l.followUpRecords || []), newRecord];
      return { ...l, followUpRecords };
    }));
    if (leadService.isEnabled()) {
      leadService.addFollowUp(leadId, newRecord)
        .then(async ({ lead: savedLead, record: savedRecord }) => {
          if (leadService.shouldVerifyWrites()) {
            const verifiedLead = await leadService.getLead(savedLead.id);
            const records = Array.isArray(verifiedLead.followUpRecords) ? verifiedLead.followUpRecords : [];
            if (!records.some(item => item.id === savedRecord.id)) {
              throw new Error('follow-up readback mismatch');
            }
          }
          setLeads(prev => prev.map(l => l.id === leadId ? savedLead : l));
        })
        .catch(error => {
          console.warn('[LeadService] follow-up failed', error);
          if (leadService.shouldVerifyWrites()) {
            setLeads(previousLeads);
          }
        });
    }
  };

  const addCustomer = (customer: Omit<Customer, 'id'>) => {
    const newCustomer: Customer = { ...customer, id: `C-${Date.now()}` };
    const previousCustomers = customers;
    setCustomers(prev => [newCustomer, ...prev]);
    if (customerService.isEnabled()) {
      customerService.createCustomer(newCustomer)
        .then(async savedCustomer => {
          if (customerService.shouldVerifyWrites()) {
            const verifiedCustomer = await customerService.getCustomer(savedCustomer.id);
            if (verifiedCustomer.id !== savedCustomer.id || verifiedCustomer.name !== savedCustomer.name) {
              throw new Error('created customer readback mismatch');
            }
          }
          setCustomers(prev => prev.map(c => c.id === newCustomer.id ? savedCustomer : c));
        })
        .catch(error => {
          console.warn('[CustomerService] create failed', error);
          if (customerService.shouldVerifyWrites()) {
            setCustomers(previousCustomers);
          }
        });
    }
  };

  const addCustomerFollowUp = (customerId: string, record: Omit<FollowUpRecord, 'id'>) => {
    const newRecord = { ...record, id: `F-${Date.now()}` };
    const previousCustomers = customers;
    setCustomers(prev => prev.map(c => {
      if (c.id !== customerId) return c;
      const followUpRecords = [...(c.followUpRecords || []), newRecord];
      return { ...c, followUpRecords };
    }));
    if (customerService.isEnabled()) {
      customerService.addFollowUp(customerId, newRecord)
        .then(async ({ customer: savedCustomer, record: savedRecord }) => {
          if (customerService.shouldVerifyWrites()) {
            const verifiedCustomer = await customerService.getCustomer(savedCustomer.id);
            const records = Array.isArray(verifiedCustomer.followUpRecords) ? verifiedCustomer.followUpRecords : [];
            if (!records.some(item => item.id === savedRecord.id)) {
              throw new Error('customer follow-up readback mismatch');
            }
          }
          setCustomers(prev => prev.map(c => c.id === customerId ? savedCustomer : c));
        })
        .catch(error => {
          console.warn('[CustomerService] follow-up failed', error);
          if (customerService.shouldVerifyWrites()) {
            setCustomers(previousCustomers);
          }
        });
    }
  };

  const importExcel = async (file: File): Promise<ImportRecord | null> => {
    try {
      // 1. 读取文件
      const arrayBuffer = await file.arrayBuffer();
      // 使用全局 XLSX 库（需要在 index.html 中引入或确保环境支持）
      // 这里假设 window.XLSX 存在，与原 Leads.tsx 逻辑一致
      const XLSX = (window as any).XLSX;
      if (!XLSX) {
        console.error('XLSX library not found');
        return null;
      }
      
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet); // 默认解析第一行为表头

      // 2. 创建批次 & 存 Raw
      const batch = importService.createImportBatch(file.name, jsonData, normalizedCurrentUser.name);
      
      // 3. 立即执行一次解析 (MVP)
      // Pass current leads and customers for deduplication
      const { newLeads, stats } = importService.processBatch(batch.id, leads, customers);
      
      // Update batch with stats
      batch.stats = stats;
      
      // 4. 更新状态
      setImportRecords(importService.getImportRecords());
      
      // 5. 写入 Leads 数据库
      if (newLeads.length > 0) {
        const previousLeads = leads;
        setLeads(prev => [...newLeads, ...prev]);
        // 必须落库：导入几百条只进内存的话，刷新后全部丢失
        if (leadService.isEnabled()) {
          leadService.bulkUpsertLeads(newLeads)
            .catch(error => {
              console.warn('[LeadService] bulk import failed', error);
              alert('导入的线索保存失败，已撤销本次导入，请重试。');
              setLeads(previousLeads);
            });
        }
      }
      
      return batch;
    } catch (e) {
      console.error('Import failed', e);
      return null;
    }
  };

  const normalizeText = (val: any) => (val ?? '').toString().replace(/\u3000/g, ' ').trim().replace(/\s+/g, ' ');
  const normalizeCompanyKey = (val: any) =>
    normalizeText(val)
      .toLowerCase()
      .replace(/[（(].*?[）)]/g, '')
      .replace(/股份有限公司|有限责任公司|有限公司|集团|公司/g, '')
      .replace(/[\s\-_/]/g, '');
  const findCustomerByName = (name: any) => {
    const key = normalizeCompanyKey(name);
    if (!key) return undefined;
    return customers.find(c => normalizeCompanyKey(c.name) === key);
  };
  const resolveContractCustomerId = (raw: { customerId?: any; customerName?: any }) => {
    const directId = normalizeText(raw?.customerId);
    if (directId && customers.some(c => c.id === directId)) return directId;
    return findCustomerByName(raw?.customerName)?.id;
  };
  const normalizeContractNo = (val: any) => normalizeText(val).toUpperCase();
  const normalizeDate = (val: any) => {
    const raw = normalizeText(val);
    if (!raw) return '';
    const ts = Date.parse(raw.replace(/[年/]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, ''));
    if (!Number.isNaN(ts)) return new Date(ts).toISOString().split('T')[0];
    return raw;
  };
  const normalizeAmount = (val: any) => {
    const raw = (val ?? '').toString();
    const num = Number(raw.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(num)) return num.toFixed(2);
    return '0.00';
  };
  const contractFingerprint = (c: { customerName?: any; title?: any; signDate?: any; amount?: any }) => {
    const customerName = normalizeText(c.customerName).toLowerCase();
    const title = normalizeText(c.title).toLowerCase();
    const signDate = normalizeDate(c.signDate);
    const amount = normalizeAmount(c.amount);
    return `${customerName}|${title}|${signDate}|${amount}`;
  };

  useEffect(() => {
    if (!Array.isArray(contracts) || contracts.length === 0 || customers.length === 0) return;
    setContracts(prev => {
      let changed = false;
      const next = prev.map(contract => {
        const linkedId = resolveContractCustomerId(contract);
        if (!linkedId || contract.customerId === linkedId) return contract;
        changed = true;
        return { ...contract, customerId: linkedId };
      });
      return changed ? next : prev;
    });
  }, [contracts, customers]);

  const backfillPdcaForPaidContracts = () => {
    const paidContracts = contracts.filter(c => Array.isArray(c.receivables) && c.receivables.length > 0 && c.receivables.every(r => r.status === 'paid'));
    let scanned = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const docsToAdd: KnowledgeDoc[] = [];
    const customerUpdateMap = new Map<string, Partial<Customer>>();
    const existingPdcaTags = new Set<string>();
    knowledgeDocs.forEach(doc => {
      if (doc.category !== 'PDCA') return;
      (doc.tags || []).forEach(tag => existingPdcaTags.add(tag));
    });

    const toDateValue = (val: string) => {
      if (!val) return 0;
      const ts = Date.parse(val.replace(/[年/]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, ''));
      return Number.isNaN(ts) ? 0 : ts;
    };

    paidContracts.forEach(contract => {
      scanned++;
      const relatedProject = projects.find(p => p.contractRef === contract.id || (contract.contractNo && p.contractRef === contract.contractNo));
      const customerByContractId = contract.customerId ? customers.find(c => c.id === contract.customerId) : undefined;
      const customerByProjectId = relatedProject?.customerId ? customers.find(c => c.id === relatedProject.customerId) : undefined;
      const customerByName = findCustomerByName(contract.customerName);
      const targetCustomer = customerByContractId || customerByProjectId || customerByName;
      if (!targetCustomer) {
        skipped++;
        return;
      }

      const ctxProject = relatedProject || ({
        id: 'P-PAYMENT-BACKFILL',
        name: `${contract.customerName} - ${contract.serviceLine || contract.title}`,
        contractRef: contract.id,
        projectCategory: 'Delivery',
        manager: contract.contactPerson || '待指派',
        progress: 0,
        status: Status.Active,
        paymentStatus: 'paid',
        deadline: todayStr(),
        duration: 0,
        projectType: 'Self-Operated',
        tasks: [],
        settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
      } as Project);

      const { projectTypeLabel, nextOpportunity } = resolveProjectPDCAContext(ctxProject, contract);

      const contractTag = `contract:${contract.id}`;
      if (!existingPdcaTags.has(contractTag)) {
        docsToAdd.push(
          buildPdcaKnowledgeDoc({
            customer: targetCustomer,
            contract,
            project: relatedProject || ctxProject,
            projectTypeLabel,
            nextOpportunity
          })
        );
        existingPdcaTags.add(contractTag);
        created++;
      }

      const candidateDate = normalizeDate(contract.signDate) || todayStr();
      const currentDate = targetCustomer.lastProjectAt || '';
      if (!currentDate || toDateValue(candidateDate) >= toDateValue(currentDate)) {
        const existingUpdate = customerUpdateMap.get(targetCustomer.id) || {};
        customerUpdateMap.set(targetCustomer.id, {
          ...existingUpdate,
          lastProjectAt: candidateDate,
          lastProjectType: projectTypeLabel,
          nextOpportunity
        });
        updated++;
      }
    });

    if (docsToAdd.length > 0) {
      setKnowledgeDocs(prev => [...docsToAdd, ...prev]);
    }

    if (customerUpdateMap.size > 0) {
      setCustomers(prev => prev.map(c => {
        const updates = customerUpdateMap.get(c.id);
        if (!updates) return c;
        return { ...c, ...updates };
      }));
    }

    return { scanned, created, updated, skipped };
  };

  const addContract = (
    raw: any,
    createProject?: boolean,
    fromLeadId?: string
  ): {
    ok: boolean;
    reason?: string;
    existingContractId?: string;
    autoCreatedCustomerId?: string;
    autoCreatedCustomerName?: string;
  } => {
    const id = raw.id || `CT-${Date.now()}`;
    const previousContracts = contracts;
    const previousCustomers = customers;
    const previousProjects = projects;
    const previousLeads = leads;
    const incomingContractNo = normalizeContractNo(raw.contractNo);
    let linkedCustomerId = resolveContractCustomerId(raw || {});
    const normalizedServiceItems = normalizeContractServiceSeeds(raw || {});
    let seededCustomer: Customer | null = null;
    let autoCreatedCustomerId: string | undefined;
    let autoCreatedCustomerName: string | undefined;

    const existing = (() => {
      if (incomingContractNo) {
        return contracts.find(c => normalizeContractNo(c.contractNo) === incomingContractNo);
      }
      const fp = contractFingerprint(raw || {});
      return contracts.find(c => contractFingerprint(c) === fp);
    })();

    if (existing) {
      return { ok: false, reason: '合同已存在，已阻止重复录入。', existingContractId: existing.id };
    }

    if (!linkedCustomerId) {
      const customerName = normalizeText(raw?.customerName);
      if (customerName) {
        const matched = findCustomerByName(customerName);
        if (matched) {
          linkedCustomerId = matched.id;
        } else {
          const now = Date.now();
          const fallbackContactName = normalizeText(raw?.contactPerson) || '待补充联系人';
          const fallbackMobile = normalizeText(raw?.mobile || raw?.phone || raw?.contactMobile);
          const seededContact = {
            id: `CP-AUTO-${now}`,
            name: fallbackContactName,
            mobile: fallbackMobile || undefined,
            isPrimary: true
          };
          seededCustomer = {
            id: `C-${now}`,
            name: customerName,
            contactPerson: fallbackContactName,
            totalValue: 0,
            riskStatus: 'low',
            activeContracts: 0,
            mobile: fallbackMobile || undefined,
            status: Status.Pending,
            contacts: [seededContact],
            followUpRecords: [
              {
                id: `F-AUTO-${now}`,
                date: todayStr(),
                type: 'system',
                content: '由合同录入自动创建客户主体，待确认合同生效并补充客户资料。',
                operator: '系统'
              }
            ]
          };
          linkedCustomerId = seededCustomer.id;
          autoCreatedCustomerId = seededCustomer.id;
          autoCreatedCustomerName = seededCustomer.name;
        }
      }
    }

    const newContract: Contract = {
      id,
      title: raw.title || '未命名合同',
      owner: normalizedCurrentUser.name,
      customerId: linkedCustomerId,
      customerName: raw.customerName || '未知客户',
      amount: typeof raw.amount === 'number' ? raw.amount : Number(raw.amount || 0),
      signDate: normalizeDate(raw.signDate) || new Date().toISOString().split('T')[0],
      status: raw.status || Status.Active,
      serviceLine: raw.serviceLine || '未分类',
      riskLevel: raw.riskLevel || 'Low',
      archiveStatus: raw.archiveStatus || ARCHIVE_STATUS.ACTIVE,
      receivables: Array.isArray(raw.receivables)
        ? raw.receivables.map((r: Receivable) => ({ ...r, status: deriveReceivableStatus(r) }))
        : [],
      attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
      contractNo: incomingContractNo || undefined,
      contactPerson: raw.contactPerson,
      paymentMethod: raw.paymentMethod,
      remarks: raw.remarks,
      serviceItems: normalizedServiceItems.map(item => ({
        name: item.name,
        rawName: item.rawName,
        catalogId: item.catalogId,
        standardName: item.standardName,
        category: item.category,
        deliveryMode: item.deliveryMode,
        workflowTemplateId: item.workflowTemplateId
      }))
    };

    const nextContracts = [newContract, ...contracts];
    const nextCustomers = seededCustomer ? [seededCustomer, ...customers] : customers;
    let nextProjects = projects;
    let createdProject: Project | null = null;

    if (createProject) {
      const ref = newContract.id;
      const existingProject = projects.find(p => p.status === Status.Active && (p.contractRef === ref || (newContract.contractNo && p.contractRef === newContract.contractNo)));
      if (!existingProject) {
        createdProject = buildProjectFromInput({
          name: `${newContract.customerName} ${newContract.title}`,
          contractRef: ref,
          customerId: linkedCustomerId,
          projectAmount: newContract.amount || 0,
          manager: '待指派',
          projectCategory: 'Delivery',
          sourceType: 'contract',
          sourceRef: ref,
          projectMode: 'delivery',
          initialServiceItems: normalizedServiceItems,
          disableDefaultTemplateTasks: normalizedServiceItems.length > 0
        });
        if (createdProject) {
          nextProjects = [...projects, createdProject];
        }
      }
    }

    const nextLeads = fromLeadId
      ? leads.map(l => l.id === fromLeadId ? { ...l, status: Status.Converted } : l)
      : leads;

    setContracts(nextContracts);
    if (seededCustomer) setCustomers(nextCustomers);
    if (createdProject) setProjects(nextProjects);
    if (fromLeadId) {
      setLeads(nextLeads);
    }

    if (contractService.isWriteEnabled()) {
      contractService.commitTransaction({
        contracts_v8: nextContracts,
        customers_v8: nextCustomers,
        projects_v8: nextProjects,
        leads_v8: nextLeads
      }, newContract.id)
        .then(async () => {
          if (!contractService.shouldVerifyWrites()) return;
          const readback = await stateSyncService.fetchState(['contracts_v8', 'customers_v8', 'projects_v8', 'leads_v8']);
          const readbackContracts = Array.isArray(readback.datasets?.contracts_v8) ? readback.datasets.contracts_v8 as Contract[] : [];
          const persistedContract = readbackContracts.find(item => item.id === newContract.id);
          if (!persistedContract || persistedContract.title !== newContract.title) {
            throw new Error('contract transaction readback mismatch');
          }
          if (seededCustomer) {
            const readbackCustomers = Array.isArray(readback.datasets?.customers_v8) ? readback.datasets.customers_v8 as Customer[] : [];
            if (!readbackCustomers.some(item => item.id === seededCustomer!.id)) {
              throw new Error('contract transaction customer readback mismatch');
            }
          }
          if (createdProject) {
            const readbackProjects = Array.isArray(readback.datasets?.projects_v8) ? readback.datasets.projects_v8 as Project[] : [];
            if (!readbackProjects.some(item => item.id === createdProject!.id && item.contractRef === newContract.id)) {
              throw new Error('contract transaction project readback mismatch');
            }
          }
          if (fromLeadId) {
            const readbackLeads = Array.isArray(readback.datasets?.leads_v8) ? readback.datasets.leads_v8 as Lead[] : [];
            if (!readbackLeads.some(item => item.id === fromLeadId && item.status === Status.Converted)) {
              throw new Error('contract transaction lead readback mismatch');
            }
          }
        })
        .catch(error => {
          console.warn('[ContractService] transaction failed', error);
          if (contractService.shouldVerifyWrites()) {
            setContracts(previousContracts);
            setCustomers(previousCustomers);
            setProjects(previousProjects);
            setLeads(previousLeads);
          }
        });
    }

    return { ok: true, autoCreatedCustomerId, autoCreatedCustomerName };
  };

  const commitContractTransaction = (params: {
    contractId?: string;
    nextContracts: Contract[];
    nextCustomers?: Customer[];
    nextProjects?: Project[];
    nextLeads?: Lead[];
    nextKnowledgeDocs?: KnowledgeDoc[];
    previousContracts?: Contract[];
    previousCustomers?: Customer[];
    previousProjects?: Project[];
    previousLeads?: Lead[];
    previousKnowledgeDocs?: KnowledgeDoc[];
    verify?: (datasets: Record<string, unknown>) => void;
  }) => {
    if (!contractService.isWriteEnabled()) return;

    const {
      contractId,
      nextContracts,
      nextCustomers = customers,
      nextProjects = projects,
      nextLeads = leads,
      nextKnowledgeDocs = knowledgeDocs,
      previousContracts = contracts,
      previousCustomers = customers,
      previousProjects = projects,
      previousLeads = leads,
      previousKnowledgeDocs = knowledgeDocs,
      verify
    } = params;

    contractService.commitTransaction({
      contracts_v8: nextContracts,
      customers_v8: nextCustomers,
      projects_v8: nextProjects,
      leads_v8: nextLeads,
      knowledge_docs_v8: nextKnowledgeDocs
    }, contractId)
      .then(async () => {
        if (!contractService.shouldVerifyWrites()) return;
        const readback = await stateSyncService.fetchState(['contracts_v8', 'customers_v8', 'projects_v8', 'leads_v8', 'knowledge_docs_v8']);
        const readbackContracts = Array.isArray(readback.datasets?.contracts_v8) ? readback.datasets.contracts_v8 as Contract[] : [];
        if (contractId && !readbackContracts.some(item => item.id === contractId)) {
          throw new Error('contract transaction readback missing contract');
        }
        verify?.(readback.datasets || {});
      })
      .catch(error => {
        console.warn('[ContractService] transaction failed', error);
        if (contractService.shouldVerifyWrites()) {
          setContracts(previousContracts);
          setCustomers(previousCustomers);
          setProjects(previousProjects);
          setLeads(previousLeads);
          setKnowledgeDocs(previousKnowledgeDocs);
        }
      });
  };

  const deleteContract = (id: string) => {
    setContracts(prev => prev.filter(c => c.id !== id));
  };

  const archiveContract = (id: string) => {
    const previousContracts = contracts;
    const nextContracts = contracts.map(c => c.id === id ? { ...c, archiveStatus: ARCHIVE_STATUS.ARCHIVED } : c);
    setContracts(nextContracts);
    commitContractTransaction({
      contractId: id,
      nextContracts,
      previousContracts,
      verify: (datasets) => {
        const readbackContracts = Array.isArray(datasets.contracts_v8) ? datasets.contracts_v8 as Contract[] : [];
        const archived = readbackContracts.find(item => item.id === id);
        if (!archived || archived.archiveStatus !== ARCHIVE_STATUS.ARCHIVED) {
          throw new Error('contract archive readback mismatch');
        }
      }
    });
  };

  const addContractAttachment = (contractId: string, attachment: ContractAttachment) => {
    if (!contractId || !attachment?.id) return { ok: false, reason: '参数错误' };
    const previousContracts = contracts;
    let updatedContract: Contract | null = null;
    const nextContracts = contracts.map(c => {
      if (c.id !== contractId) return c;
      const nextAttachments = Array.isArray(c.attachments) ? c.attachments : [];
      if (nextAttachments.some(a => a.id === attachment.id)) return c;
      updatedContract = { ...c, attachments: [...nextAttachments, attachment] };
      return updatedContract;
    });
    if (!updatedContract) return { ok: false, reason: '合同不存在' };
    setContracts(nextContracts);
    commitContractTransaction({
      contractId,
      nextContracts,
      previousContracts,
      verify: (datasets) => {
        const readbackContracts = Array.isArray(datasets.contracts_v8) ? datasets.contracts_v8 as Contract[] : [];
        const contract = readbackContracts.find(item => item.id === contractId);
        const attachments = Array.isArray(contract?.attachments) ? contract.attachments : [];
        if (!attachments.some(item => item.id === attachment.id)) {
          throw new Error('contract attachment readback mismatch');
        }
      }
    });
    return { ok: true };
  };

  const removeContractAttachment = (contractId: string, attachmentId: string) => {
    if (!contractId || !attachmentId) return { ok: false, reason: '参数错误' };
    let updated = false;
    setContracts(prev => prev.map(c => {
      if (c.id !== contractId) return c;
      const nextAttachments = Array.isArray(c.attachments) ? c.attachments : [];
      const filtered = nextAttachments.filter(a => a.id !== attachmentId);
      if (filtered.length === nextAttachments.length) return c;
      updated = true;
      return { ...c, attachments: filtered };
    }));
    return updated ? { ok: true } : { ok: false, reason: '附件不存在或合同不存在' };
  };

  const bindContractToCustomer = (contractId: string, customerId: string) => {
    const targetCustomer = customers.find(c => c.id === customerId);
    if (!targetCustomer) return { ok: false, reason: '客户不存在' };

    let linkedContract: Contract | null = null;
    const previousContracts = contracts;
    const previousProjects = projects;
    const nextContracts = contracts.map(contract => {
      if (contract.id !== contractId) return contract;
      linkedContract = { ...contract, customerId };
      return linkedContract;
    });

    if (!linkedContract) return { ok: false, reason: '合同不存在' };

    const nextProjects = projects.map(project => {
      if (project.contractRef !== linkedContract!.id && project.contractRef !== linkedContract!.contractNo) return project;
      if (project.customerId === customerId) return project;
      return { ...project, customerId };
    });

    setContracts(nextContracts);
    setProjects(nextProjects);
    commitContractTransaction({
      contractId,
      nextContracts,
      nextProjects,
      previousContracts,
      previousProjects,
      verify: (datasets) => {
        const readbackContracts = Array.isArray(datasets.contracts_v8) ? datasets.contracts_v8 as Contract[] : [];
        const contract = readbackContracts.find(item => item.id === contractId);
        if (!contract || contract.customerId !== customerId) {
          throw new Error('contract customer binding readback mismatch');
        }
      }
    });

    return { ok: true };
  };

  const resolveAuditLinkedProject = (issue: Partial<AuditIssue>) => {
    if (issue.projectId) {
      const direct = projects.find(project => project.id === issue.projectId);
      if (direct) return direct;
    }

    const contract = issue.contractId
      ? contracts.find(item => item.id === issue.contractId)
      : contracts.find(item => item.id === issue.contractRef || item.contractNo === issue.contractRef);
    if (!contract) return null;

    return projects.find(project => project.contractRef === contract.id || (contract.contractNo && project.contractRef === contract.contractNo)) || null;
  };

  const buildAuditRectificationTaskTitle = (issue: Partial<AuditIssue>) => {
    const summary = String(issue.findings || '不符合项').replace(/\s+/g, ' ').trim().slice(0, 24) || '不符合项';
    return `整改闭环｜${issue.customerName || '客户'}｜${summary}`;
  };

  const syncAuditRectificationTask = (issue: AuditIssue, previousIssue?: AuditIssue) => {
    const targetProject = resolveAuditLinkedProject(issue);
    const previousProjectId = previousIssue?.projectId || resolveAuditLinkedProject(previousIssue || {})?.id;
    const previousTaskId = previousIssue?.rectificationTaskId;
    let nextTaskId = issue.rectificationTaskId || previousTaskId;
    const shouldCompleteTask = issue.status === 'Closed';
    const nextDeadline = String(issue.deadline || '').trim() || new Date().toISOString().split('T')[0];
    const nextOwner = String(issue.auditor || targetProject?.manager || normalizedCurrentUser.name || '待指派').trim() || '待指派';
    const nextTitle = buildAuditRectificationTaskTitle(issue);

    setProjects(prev => prev.map(project => {
      let tasks = Array.isArray(project.tasks) ? [...project.tasks] : [];
      let changed = false;

      if (previousTaskId && previousProjectId && project.id === previousProjectId && (!targetProject || targetProject.id !== previousProjectId)) {
        const filtered = tasks.filter(task => task.id !== previousTaskId);
        if (filtered.length !== tasks.length) {
          tasks = filtered;
          changed = true;
        }
      }

      if (targetProject && project.id === targetProject.id) {
        const existingTaskIndex = nextTaskId ? tasks.findIndex(task => task.id === nextTaskId) : -1;
        const taskPayload = {
          title: nextTitle,
          deadline: nextDeadline,
          status: shouldCompleteTask ? 'Completed' as const : 'Pending' as const,
          priority: issue.severity === 'Major' ? 'High' as const : 'Medium' as const,
          category: 'Core' as const,
          owner: nextOwner
        };

        if (existingTaskIndex >= 0) {
          tasks[existingTaskIndex] = { ...tasks[existingTaskIndex], ...taskPayload };
          changed = true;
        } else {
          nextTaskId = `T-AUD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
          tasks.push({ id: nextTaskId, ...taskPayload });
          changed = true;
        }
      }

      if (!changed) return project;
      return { ...project, tasks, progress: calculateProjectProgress(tasks) };
    }));

    return {
      projectId: targetProject?.id,
      rectificationTaskId: nextTaskId
    };
  };

  const addAuditIssue = (issue: Omit<AuditIssue, 'id'>) => {
    const draftIssue: AuditIssue = { ...issue, id: `AUD-${Date.now()}` };
    const synced = syncAuditRectificationTask(draftIssue);
    const newIssue: AuditIssue = {
      ...draftIssue,
      projectId: draftIssue.projectId || synced.projectId,
      rectificationTaskId: synced.rectificationTaskId || draftIssue.rectificationTaskId
    };
    setAuditIssues(prev => [newIssue, ...prev]);
    return newIssue.id;
  };

  const updateAuditIssue = (id: string, updates: Partial<AuditIssue>) => {
    const existing = auditIssues.find(issue => issue.id === id);
    if (!existing) return;

    const mergedIssue: AuditIssue = { ...existing, ...updates };
    const synced = syncAuditRectificationTask(mergedIssue, existing);
    const nextIssue: AuditIssue = {
      ...mergedIssue,
      projectId: mergedIssue.projectId || synced.projectId || existing.projectId,
      rectificationTaskId: synced.rectificationTaskId || mergedIssue.rectificationTaskId || existing.rectificationTaskId
    };

    setAuditIssues(prev => prev.map(issue => issue.id === id ? nextIssue : issue));
  };

  const rejectReceivable = (contractId: string, receivableId: string, reason: string) => {
    let nextReceivables: Contract['receivables'] | null = null;
    setContracts(prev => prev.map(c => {
      if (c.id !== contractId) return c;
      const receivables = c.receivables.map(r => {
        if (r.id !== receivableId) return r;
        const next = { ...r, status: 'unpaid' as const, rejectionReason: reason };
        return { ...next, status: deriveReceivableStatus(next) };
      });
      nextReceivables = receivables;
      return { ...c, receivables };
    }));
    // 无专用后端接口：经合同 PATCH 持久化回款数组（消除纯本地态）。
    if (contractService.isWriteEnabled() && nextReceivables) {
      contractService.updateContract(contractId, { receivables: nextReceivables }).catch(e => console.warn('[ContractService] rejectReceivable persist failed', e));
    }
  };

  /**
   * 销售报备"客户已付款，请财务核对"。
   * 刻意不改 status——确认到账只有财务能做（PAYMENT_CONFIRM）。
   * 这里只记录报备事实并推一条待办给财务，责任链是：销售报信 → 财务确认。
   */
  const claimReceivablePaid: AppContextType['claimReceivablePaid'] = (contractId, receivableId, note) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return { ok: false, reason: '合同不存在' };
    const receivable = (contract.receivables || []).find(r => r.id === receivableId);
    if (!receivable) return { ok: false, reason: '回款节点不存在' };
    if (receivable.status === 'paid') return { ok: false, reason: '该节点已确认到账，无需报备' };
    if (receivable.paymentClaim) return { ok: false, reason: '已报备过，财务核对中' };

    const claim = {
      claimedBy: normalizedCurrentUser.name,
      claimedByUserId: normalizedCurrentUser.id,
      claimedAt: new Date().toISOString(),
      note: String(note || '').trim() || undefined
    };
    const nextReceivables = contract.receivables.map(r => (r.id === receivableId ? { ...r, paymentClaim: claim } : r));
    setContracts(prev => prev.map(c => (c.id === contractId ? { ...c, receivables: nextReceivables } : c)));
    if (contractService.isWriteEnabled()) {
      contractService.updateContract(contractId, { receivables: nextReceivables })
        .catch(e => console.warn('[ContractService] claimReceivablePaid persist failed', e));
    }

    addReminder({
      title: '💰 待核对到账',
      content: `${claim.claimedBy} 报备：客户【${contract.customerName}】的「${receivable.node}」已付款 ¥${Number(receivable.amount || 0).toLocaleString()}，请核对银行流水后确认到账。${claim.note ? `备注：${claim.note}` : ''}`,
      date: new Date().toISOString().split('T')[0],
      type: 'payment',
      linkType: 'contract',
      linkId: contractId,
      ...buildReminderTarget([], ['FINANCE', 'ADMIN'])
    });
    return { ok: true };
  };

  const importSettlements = (items: Settlement[]) => {
    setSettlements(prev => [...items, ...prev]);
    if (settlementService.isEnabled() && Array.isArray(items) && items.length > 0) {
      settlementService.upsertMany(items).catch(e => console.warn('[SettlementService] bulk upsert failed', e));
    }
  };

  const updateSettlementStatus = (settlementId: string, status: Settlement['status']) => {
    let target: Settlement | null = null;
    setSettlements(prev => prev.map(item => {
      if (item.id !== settlementId) return item;
      target = { ...item, status };
      return target;
    }));

    if (target && status === 'paid') {
      addReminder({
        title: `💸 顾问结算已支付`,
        content: `结算对象【${target.beneficiary}】已支付 ¥${Number(target.amount || 0).toLocaleString()}（${target.contractRef}）。`,
        date: todayStr(),
        type: 'payment',
        linkType: 'project',
        linkId: target.contractRef,
        forRole: ['FINANCE', 'MANAGER']
      });
    }
    if (settlementService.isEnabled()) {
      settlementService.updateStatus(settlementId, status).catch(e => console.warn('[SettlementService] update failed', e));
    }
  };

  const deleteKnowledgeDoc = (id: string) => {
    setKnowledgeDocs(prev => prev.filter(d => d.id !== id));
    if (knowledgeService.isEnabled()) {
      knowledgeService.deleteDoc(id).catch(e => console.warn('[KnowledgeService] delete failed', e));
    }
  };

  const updateKnowledgeDoc = (id: string, updates: Partial<KnowledgeDoc>) => {
    setKnowledgeDocs(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    if (knowledgeService.isEnabled()) {
      knowledgeService.updateDoc(id, updates).catch(e => console.warn('[KnowledgeService] update failed', e));
    }
  };

  const normalizeStrategicTask = (task: any, fallbackIndex = 0): StrategicTask | null => {
    const title = String(task?.title || '').trim();
    if (!title) return null;
    const priorityRaw = String(task?.priority || 'Medium').toLowerCase();
    const priority: StrategicTask['priority'] =
      priorityRaw === 'high' ? 'High' : priorityRaw === 'low' ? 'Low' : 'Medium';
    const statusRaw = String(task?.status || 'Pending').toLowerCase();
    const status = statusRaw.includes('progress')
      ? 'In Progress'
      : statusRaw.includes('complete') || statusRaw === 'done'
        ? 'Completed'
        : 'Pending';
    const rawDate = String(task?.deadline || '').trim();
    const parsed = Date.parse(rawDate.replace(/[年/]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, ''));
    const fallbackDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const deadline = Number.isFinite(parsed) ? new Date(parsed).toISOString().split('T')[0] : fallbackDate;
    return {
      id: typeof task?.id === 'string' && task.id.trim() ? task.id : `ST-${Date.now()}-${fallbackIndex}`,
      title,
      priority,
      owner: String(task?.owner || normalizedCurrentUser.name || '待定'),
      status,
      deadline,
      impact: String(task?.impact || '待评估'),
      type: String(task?.type || 'Strategy')
    };
  };

  const addStrategicTask = (task: StrategicTask) => {
    const normalized = normalizeStrategicTask(task);
    if (!normalized) return;
    setStrategicTasks(prev => [normalized, ...prev]);
  };

  const updateStrategicTaskStatus = (id: string, status: string) => {
    setStrategicTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const deleteStrategicTask = (id: string) => {
    setStrategicTasks(prev => prev.filter(t => t.id !== id));
  };

  const runDeepAnalysis = async () => {
    setIsAnalyzingStrategy(true);
    try {
      const accessibleKnowledgeDocs = knowledgeDocs.filter(d => {
        if (d.accessUserIds && d.accessUserIds.length > 0 && !d.accessUserIds.includes(currentUser.id)) return false;
        if (d.accessRoles && d.accessRoles.length > 0 && !d.accessRoles.some(r => currentUser.roles.includes(r))) return false;
        return true;
      });
      const worldSnapshot = serializeWorldState(leads, customers, contracts, projects, auditIssues);
      const settlementSnapshot = {
        total: settlements.length,
        paid: settlements.filter(s => s.status === 'paid').length,
        pending: settlements.filter(s => s.status !== 'paid').length,
        paidAmount: settlements.filter(s => s.status === 'paid').reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
        pendingAmount: settlements.filter(s => s.status !== 'paid').reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
      };
      const knowledgeHighlights = accessibleKnowledgeDocs
        .slice(0, 20)
        .map(doc => ({
          title: doc.title,
          category: doc.category,
          summary: String(doc.summary || doc.content || '').slice(0, 240)
        }));
      const contextData = { worldSnapshot, settlementSnapshot, knowledgeHighlights };
      const insight = await aiService.generateDeepStrategicInsight(contextData);
      setStrategicInsight({ ...insight, generatedAt: new Date().toISOString().slice(0, 10) });
    } catch (e) {
      setStrategicInsight(null);
    } finally {
      setIsAnalyzingStrategy(false);
    }
  };

  const generateStrategicTasksFromInsight = async () => {
    if (!strategicInsight) return;
    setIsAnalyzingStrategy(true);
    try {
      const prompt = `Based on this strategic insight, generate 6 executable strategic tasks. Output JSON array with fields: id,title,priority,owner,status,deadline,impact,type. Insight: ${JSON.stringify(strategicInsight)}`;
      const tasks = await aiService.generateJSON('kimi-k2.5', prompt);
      if (Array.isArray(tasks)) {
        const normalized = tasks
          .map((t, idx) => normalizeStrategicTask(t, idx))
          .filter((t): t is StrategicTask => Boolean(t));
        if (normalized.length > 0) {
          setStrategicTasks(prev => {
            const existingKeySet = new Set(prev.map(item => `${String(item.title || '').trim()}|${String(item.deadline || '').trim()}`));
            const incoming = normalized.filter(item => !existingKeySet.has(`${String(item.title || '').trim()}|${String(item.deadline || '').trim()}`));
            return [...incoming, ...prev];
          });
        }
      }
    } catch (e) {
    } finally {
      setIsAnalyzingStrategy(false);
    }
  };

  const addMonths = (dateStr: string, months: number) => {
    const d = new Date(dateStr);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() !== day) d.setDate(0);
    return d.toISOString().split('T')[0];
  };

  const generateAuditPlan = (issueDate: string, ruleId: string): AuditNode[] => {
    const base = issueDate;
    const mk = (idx: number, type: AuditNode['type'], offsetMonths: number): AuditNode => ({
      id: `AN-${Date.now()}-${idx}`,
      type,
      plannedDate: addMonths(base, offsetMonths),
      status: 'Pending'
    });
    if (ruleId.endsWith('_5Y')) {
      return [
        mk(1, 'Annual Review', 12),
        mk(2, 'Annual Review', 24),
        mk(3, 'Annual Review', 36),
        mk(4, 'Annual Review', 48),
        mk(5, 'Re-certification', 60)
      ];
    }
    return [
      mk(1, 'Surveillance 1', 12),
      mk(2, 'Surveillance 2', 24),
      mk(3, 'Re-certification', 36)
    ];
  };

  const updateCertificateAuditStatus = (customerId: string, certificateId: string, auditNodeId: string, status: AuditNode['status']) => {
    // 复用 updateCustomer 落库，避免"标记完成后刷新又变回未完成"
    const target = customers.find(c => c.id === customerId);
    if (!target) return;
    const certificates = (target.certificates || []).map(cert => {
      if (cert.id !== certificateId) return cert;
      const auditPlan = (cert.auditPlan || []).map(node => node.id === auditNodeId ? { ...node, status } : node);
      return { ...cert, auditPlan };
    });
    updateCustomer(customerId, { certificates });
  };



  // 【双大脑遗留】纯前端回款级联版，仅在合同写开关关闭时作为迁移前回退；云端启用后应整体删除。
  const toggleReceivableStatusLocal = (cid: string, rid: string) => {
    let paidCompleted = false;
    let updatedContract: Contract | null = null;
    const previousContracts = contracts;
    const previousProjects = projects;
    const previousCustomers = customers;
    const previousKnowledgeDocs = knowledgeDocs;

    const nextContracts = contracts.map(c => {
      if (c.id !== cid) return c;
      const updatedReceivables = c.receivables.map(r => {
        if (r.id !== rid) return r;
        if (r.status === 'paid') {
          const reverted = { ...r, status: 'unpaid' as const };
          return { ...reverted, status: deriveReceivableStatus(reverted) };
        }
        return { ...r, status: 'paid' as const };
      });
      const allPaid = updatedReceivables.length > 0 && updatedReceivables.every(r => r.status === 'paid');
      paidCompleted = allPaid;
      updatedContract = { ...c, receivables: updatedReceivables };
      return updatedContract;
    });
    setContracts(nextContracts);

    let nextProjects = projects;
    if (updatedContract) {
      const nextPaymentStatus = deriveProjectPaymentStatus(updatedContract.receivables || []);
      nextProjects = projects.map(project => {
        if (project.contractRef !== updatedContract!.id && project.contractRef !== updatedContract!.contractNo) return project;
        if (project.paymentStatus === nextPaymentStatus) return project;
        return { ...project, paymentStatus: nextPaymentStatus };
      });
      setProjects(nextProjects);
    }

    let nextCustomers = customers;
    let nextKnowledgeDocs = knowledgeDocs;
    if (paidCompleted && updatedContract) {
      const relatedProject = nextProjects.find(p => p.contractRef === updatedContract!.id || (updatedContract!.contractNo && p.contractRef === updatedContract!.contractNo));
      const customerByContractId = updatedContract.customerId ? customers.find(c => c.id === updatedContract.customerId) : undefined;
      const customerByProjectId = relatedProject?.customerId ? customers.find(c => c.id === relatedProject.customerId) : undefined;
      const customerByName = findCustomerByName(updatedContract!.customerName);
      const targetCustomer = customerByContractId || customerByProjectId || customerByName;
      if (targetCustomer) {
        const alreadyCounted = (targetCustomer.pdcaPaidContractIds || []).includes(updatedContract.id);
        const nowStr = new Date().toISOString().split('T')[0];
        const ctxProject = relatedProject || {
          id: 'P-PAYMENT',
          name: `${updatedContract.customerName} - ${updatedContract.serviceLine || updatedContract.title}`,
          contractRef: updatedContract.id,
          projectCategory: 'Delivery',
          manager: updatedContract.contactPerson || '待指派',
          progress: 0,
          status: Status.Active,
          paymentStatus: 'paid',
          deadline: nowStr,
          duration: 0,
          projectType: 'Self-Operated',
          tasks: [],
          settlementConfig: { rule: 'Ratio', value: 10, base: 'Revenue' }
        } as Project;

        const { projectTypeLabel, nextOpportunity } = resolveProjectPDCAContext(ctxProject, updatedContract);

        if (!alreadyCounted) {
          const currentYear = new Date().getFullYear();
          const isCurrentYear = nowStr.startsWith(String(currentYear));
          const addAmount = Number(updatedContract.amount || 0);
          const totalAmount = (targetCustomer.totalAmount || 0) + addAmount;
          const yearAmount = (targetCustomer.yearAmount || 0) + (isCurrentYear ? addAmount : 0);
          let level: 'A' | 'B' | 'C' = 'C';
          if (totalAmount >= 100000) level = 'A';
          else if (totalAmount >= 30000) level = 'B';

          const customerUpdate = {
            lastProjectAt: nowStr,
            lastProjectType: projectTypeLabel,
            nextOpportunity,
            totalAmount,
            yearAmount,
            level,
            pdcaPaidContractIds: [...(targetCustomer.pdcaPaidContractIds || []), updatedContract.id]
          };
          nextCustomers = nextCustomers.map(c => c.id === targetCustomer.id ? { ...c, ...customerUpdate } : c);
          setCustomers(nextCustomers);
        }

        const hasPdcaDoc = knowledgeDocs.some(d =>
          d.category === 'PDCA' &&
          (d.tags || []).includes(`contract:${updatedContract.id}`)
        );
        if (!hasPdcaDoc) {
          const nextDoc = buildPdcaKnowledgeDoc({
            customer: targetCustomer,
            contract: updatedContract,
            project: relatedProject || ctxProject,
            projectTypeLabel,
            nextOpportunity
          });
          nextKnowledgeDocs = [nextDoc, ...nextKnowledgeDocs];
          setKnowledgeDocs(nextKnowledgeDocs);
        }
      }
    }

    if (updatedContract) {
      commitContractTransaction({
        contractId: updatedContract.id,
        nextContracts,
        nextCustomers,
        nextProjects,
        nextKnowledgeDocs,
        previousContracts,
        previousCustomers,
        previousProjects,
        previousKnowledgeDocs,
        verify: (datasets) => {
          const readbackContracts = Array.isArray(datasets.contracts_v8) ? datasets.contracts_v8 as Contract[] : [];
          const contract = readbackContracts.find(item => item.id === updatedContract!.id);
          const receivable = contract?.receivables?.find(item => item.id === rid);
          const localReceivable = updatedContract!.receivables.find(item => item.id === rid);
          if (!receivable || receivable.status !== localReceivable?.status) {
            throw new Error('contract receivable readback mismatch');
          }
          if (nextKnowledgeDocs !== previousKnowledgeDocs) {
            const readbackDocs = Array.isArray(datasets.knowledge_docs_v8) ? datasets.knowledge_docs_v8 as KnowledgeDoc[] : [];
            if (!readbackDocs.some(item => (item.tags || []).includes(`contract:${updatedContract!.id}`))) {
              throw new Error('contract pdca doc readback mismatch');
            }
          }
        }
      });
    }
  };

  // 单一业务权威入口：合同写开关开启时委托后端回款级联，前端仅刷新受影响数据集；否则回退本地。
  const toggleReceivableStatus = async (cid: string, rid: string): Promise<void> => {
    if (contractService.isWriteEnabled()) {
      try {
        await contractService.confirmReceivable(cid, rid);
        // 刷新受影响：合同(回款状态) + 项目(付款状态) + 客户(全额到账升级) + 知识(PDCA 文档)
        await Promise.all([
          contractService.isReadEnabled() ? contractService.listContracts().then(setContracts).catch(() => {}) : Promise.resolve(),
          projectService.isReadEnabled() ? projectService.listProjects().then(setProjects).catch(() => {}) : Promise.resolve(),
          customerService.isReadEnabled() ? customerService.listCustomers().then(setCustomers).catch(() => {}) : Promise.resolve(),
          knowledgeService.isReadEnabled() ? knowledgeService.listDocs().then(setKnowledgeDocs).catch(() => {}) : Promise.resolve(),
        ]);
        return;
      } catch (error) {
        console.warn('[ContractService] confirmReceivable failed', error instanceof Error ? error.message : String(error));
        return;
      }
    }
    toggleReceivableStatusLocal(cid, rid);
  };

  // 注：手动结算函数 generateProjectSettlement 已移除——项目完成结算草稿由后端 completeProject 级联自动生成（见 A1/A5）。

  // --- AI Decision Center Implementation ---
  
  /** 把动作类型翻成人话，队列里要让人一眼看懂 AI 想干什么 */
  const describeAiAction = (action: AIAction): string => ({
    ADD_REMINDER: '建议加一条风险提醒',
    SUGGEST_TASK: `建议补充任务：${action.payload?.title || ''}`,
    UPDATE_RISK: `建议把风险等级调为 ${action.payload?.level || ''}`,
    UPDATE_STATUS: `建议把状态改为 ${action.payload?.status || ''}`,
    CREATE_CONTRACT: '建议创建合同',
  }[action.type] || `建议执行 ${action.type}`);

  const executeAIAction = (action: AIAction, projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    switch (action.type) {
      case 'ADD_REMINDER':
        addReminder({
          title: `AI 风险预警: ${project.name}`,
          content: action.payload.content || action.reason,
          type: 'risk',
          linkType: 'project',
          linkId: projectId,
          priority: action.payload.priority || 'Medium',
          forRole: ['MANAGER', 'ADMIN']
        });
        break;
      case 'SUGGEST_TASK':
         addReminder({
          title: `AI 建议补充任务: ${project.name}`,
          content: `建议添加任务: ${action.payload.title} (建议截止: ${action.payload.deadline})`,
          type: 'todo',
          linkType: 'project',
          linkId: projectId,
          forRole: ['MANAGER', 'CONSULTANT']
        });
        break;
    }
  };

  const runProjectDiagnosis = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    try {
      const analysis = await aiService.analyzeProjectStatus(project);
      
      const log: AIDecisionLog = {
        id: `LOG-${Date.now()}`,
        projectId: project.id,
        projectName: project.name,
        timestamp: new Date().toISOString(),
        analysisSummary: analysis.analysisSummary,
        riskLevel: analysis.riskLevel,
        suggestedActions: analysis.suggestedActions || [],
        executed: false
      };

      setAiDecisionLogs(prev => [log, ...prev]);

      // Update project insight —— 诊断花了 AI token，结果必须落库，否则刷新就白花了
      const previousProjectsForDiagnosis = projects;
      const nextProjectsForDiagnosis = projects.map(p => p.id === projectId ? {
        ...p,
        aiInsight: {
          lastAnalysisTime: new Date().toISOString(),
          riskLevel: analysis.riskLevel,
          summary: analysis.analysisSummary
        }
      } : p);
      setProjects(nextProjectsForDiagnosis);
      commitProjectTransaction({
        projectId,
        nextProjects: nextProjectsForDiagnosis,
        previousProjects: previousProjectsForDiagnosis
      });

      /*
        AI 的建议一律入「待确认队列」，不再自动执行。

        改之前：高优先级的 ADD_REMINDER 直接调 executeAIAction 落地，人不知道 AI 改了什么；
        其余动作类型压根不执行，只在页面上展示（5 种声明，2 种实现）。
        两头都错——该受监督的偷偷做了，该产生价值的只是摆着看。

        现在：AI 只提案，人在工作台一键批准/驳回，批准后才执行。
        驳回时必须填原因，那是让 AI 变准的唯一真实依据。
      */
      const proposals = (analysis.suggestedActions || []) as AIAction[];
      const projectName = projects.find(p => p.id === projectId)?.name || projectId;
      await Promise.all(proposals.map(action =>
        fetch('/api/ai-proposals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            source: 'project_diagnosis',
            sourceRef: projectId,
            title: `${describeAiAction(action)}｜${projectName}`,
            action,
            reason: action.reason || analysis.analysisSummary || '',
            confidence: analysis.riskLevel === 'High' ? 'high' : analysis.riskLevel === 'Low' ? 'low' : 'medium',
          }),
        }).catch(err => {
          // 入队失败不能让诊断整体失败——诊断结论本身还是有价值的
          console.warn('[AI提案] 入队失败：', err?.message);
        })
      ));
    } catch (error) {
      console.error("AI Diagnosis failed", error);
    }
  };

  useEffect(() => {
    dataService.set('ai_decision_logs_v1', aiDecisionLogs);
    dataService.set('aiDecisionLogs_v1', aiDecisionLogs);
  }, [aiDecisionLogs]);

  const addReminder = (r: any) => {
    const rawLinkType = r?.linkType;
    const rawLinkId = r?.linkId;

    if (!rawLinkType) return;

    if (rawLinkType === 'intel' || rawLinkType === 'audit') {
      if (!rawLinkId) return;
      const prefix = rawLinkType === 'intel' ? 'REM-INTEL' : 'REM-AUDIT';
      const id = r?.id || `${prefix}-${rawLinkId}`;
      upsertSystemReminder(id, r);
      return;
    }

    if (rawLinkType && rawLinkType !== 'project') {
      let projectId: string | null = null;

      if (rawLinkType === 'customer' && rawLinkId) {
        projectId = createFollowUpProjectFromCustomer(rawLinkId);
      } else if (rawLinkType === 'lead' && rawLinkId) {
        projectId = createFollowUpProjectFromLead(rawLinkId);
      } else if (rawLinkType === 'contract' && rawLinkId) {
        const existing = projects.find(p => p.contractRef === rawLinkId && p.status === Status.Active);
        projectId = existing?.id || null;
      }

      if (projectId) {
        const normalized = { ...r, linkType: 'project', linkId: projectId };
        upsertSystemReminder(`REM-${Date.now()}`, normalized);
        return;
      }

      return;
    }

    if (rawLinkType === 'project' && !rawLinkId) return;

    upsertSystemReminder(r?.id || `REM-${Date.now()}`, r);
  };
  const dismissReminder = (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    if (reminderService.isEnabled()) {
      reminderService.removeReminder(id).catch(e => console.warn('[ReminderService] remove failed', e));
    }
  };

  /*
    标记已读。

    只改 isRead，不删记录 —— 提醒本身是「这件事发生过」的痕迹，
    看过了不代表可以扔掉。要清掉走 dismissReminder。

    只动本人可见的那些（visibleReminders）：
    「全部已读」如果把别人的提醒也标掉，等于替同事把他的待办清了。
  */
  const markRemindersRead = (ids: string[]) => {
    if (!ids.length) return;
    const target = new Set(ids);
    setReminders(prev => prev.map(r => (target.has(r.id) && !r.isRead ? { ...r, isRead: true } : r)));
  };

  const markAllRemindersRead = () => {
    const mine = new Set(visibleReminders.filter(r => !r.isRead).map(r => r.id));
    if (!mine.size) return;
    setReminders(prev => prev.map(r => (mine.has(r.id) ? { ...r, isRead: true } : r)));
  };
  const addKnowledgeDoc = async (doc: any) => appendKnowledgeDoc(doc);
  const updateCustomer = (id: string, u: any) => {
    const previousCustomers = customers;
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...u } : c));
    if (customerService.isEnabled()) {
      customerService.updateCustomer(id, u)
        .then(async savedCustomer => {
          if (customerService.shouldVerifyWrites()) {
            const verifiedCustomer = await customerService.getCustomer(savedCustomer.id);
            if (verifiedCustomer.id !== savedCustomer.id || verifiedCustomer.name !== savedCustomer.name) {
              throw new Error('updated customer readback mismatch');
            }
          }
          setCustomers(prev => prev.map(c => c.id === id ? savedCustomer : c));
        })
        .catch(error => {
          console.warn('[CustomerService] update failed', error);
          if (customerService.shouldVerifyWrites()) {
            setCustomers(previousCustomers);
          }
        });
    }
  };

  const checkActionPermission = (action: ActionCode, context?: any): { allowed: boolean; reason?: string } => {
    return checkRoleActionPermission(activeRole, normalizedCurrentUser, action, context);
  };

  return (
    <AppContext.Provider value={{
      leads, customers, contracts, projects, settlements, reminders, auditIssues, knowledgeDocs, vendors, marketSignals, projectWorkLogs,
      currentUser: normalizedCurrentUser, userProfiles, isAuthRequired: authRequired, switchUser, updateUserProfile, addUserProfile, deleteUserProfile,
      activeRole, setActiveRole, activePersona, availablePersonas, resolveDashboardPersona, userPermissions, hasPermission, checkActionPermission, visibleReminders, aggregatedReminders, dashboardMetrics, taskTemplates, addTaskTemplate, updateTaskTemplate, deleteTaskTemplate, archiveTaskTemplate, cloneTaskTemplate,
      addProject, assignProjectManager, updateProjectTask, deleteProjectTask, addProjectTask, applyTemplateToProject, addProjectServiceItem, updateProjectServiceItem, deleteProjectServiceItem, addProjectWorkLog, updateProjectWorkLog, deleteProjectWorkLog,
      createFollowUpProjectFromLead,
      createFollowUpProjectFromCustomer,
      addLead, updateLead, addLeadFollowUp,
      addCustomer, addCustomerFollowUp,
      addContract, bindContractToCustomer, deleteContract, archiveContract, addContractAttachment, removeContractAttachment,
      addAuditIssue, updateAuditIssue,
      rejectReceivable, claimReceivablePaid, importSettlements, updateSettlementStatus,
      deleteKnowledgeDoc, updateKnowledgeDoc, backfillPdcaForPaidContracts,
      upsertMarketSignals, updateMarketSignal, convertSignalToFollowUpProject, convertIntelProjectToLead, bindFollowUpProjectToCustomer,
      strategicInsight, isAnalyzingStrategy, strategicTasks, runDeepAnalysis, generateStrategicTasksFromInsight, addStrategicTask, updateStrategicTaskStatus, deleteStrategicTask,
      runSystemScans, generateAuditPlan, updateCertificateAuditStatus,
      toggleReceivableStatus, addReminder, dismissReminder, markRemindersRead, markAllRemindersRead,
      addKnowledgeDoc, updateCustomer,
      aiDecisionLogs, runProjectDiagnosis, completeProject, reopenProject, updateProjectCost,
      importRecords, importExcel // 暴露新功能
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
