

export enum Status {
  New = 'New',
  Pending = 'Pending',
  Converted = 'Converted',
  Risk = 'Risk',
  Lost = 'Lost',
  Active = 'Active',
  Completed = 'Completed'
}

// 一、身份角色定义
export type RoleID = 'ADMIN' | 'MANAGER' | 'CONSULTANT' | 'FINANCE';

export interface Role {
  id: RoleID;
  name: string;
  description: string;
}

export type PermissionCode =
  | 'NAV_CRM'
  | 'NAV_DELIVERY'
  | 'NAV_FINANCE'
  | 'NAV_AUDIT'
  | 'NAV_KNOWLEDGE'
  | 'NAV_INTEL'
  | 'NAV_STRATEGY'
  | 'NAV_AI_CENTER';

export interface UserProfile {
  id: string;
  name: string;
  roles: RoleID[];
  activeRole: RoleID;
  positionTags?: string[];
  reportsToUserId?: string;
  wechatBinding?: WeChatBinding;
}

export type NotificationChannel = 'system' | 'wechat' | 'email' | 'sms';

export interface WeChatBinding {
  userId: string;
  wechatId: string; // OpenID or mock ID
  nickname?: string;
  boundAt: string;
  status: 'active' | 'disabled';
  config: {
    pushEnabled: boolean;
    minSeverity: ReminderSeverity; // 'high' | 'medium' | 'low'
    dailySummary: boolean;
  };
}

// 二、任务原子化协议
export interface ProjectTask {
  id: string;
  title: string;
  deadline: string;
  status: 'Pending' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  category: 'Core' | 'Auxiliary' | 'System' | 'ThirdParty'; // 区分核心与辅助任务用于计算进度
  owner: string;
  serviceItemId?: string;
}

// 三、任务模版引擎
export interface TaskTemplate {
  id: string;
  name: string;
  tasks: Omit<ProjectTask, 'id' | 'deadline' | 'status' | 'owner'>[];
  isBuiltIn?: boolean;
  createdByUserId?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  usageCount?: number;
  lastUsedAt?: string;
}

export interface AuditNode {
  id: string;
  type: 'Initial' | 'Surveillance 1' | 'Surveillance 2' | 'Surveillance 3' | 'Surveillance 4' | 'Re-certification' | 'Special Audit' | 'Annual Review' | 'Update';
  plannedDate: string; 
  status: 'Pending' | 'Scheduled' | 'Completed' | 'Overdue' | 'Skipped';
  actualDate?: string;
  contractId?: string; 
  remarks?: string; 
}

export interface CertificateDetail {
  id: string;
  name: string;
  number?: string;
  issueDate?: string;
  expiryDate: string;
  issuingBody?: string;
  status: 'Valid' | 'Expiring' | 'Expired';
  cycleRule?: string; 
  auditPlan?: AuditNode[];
}

export interface ContactPerson {
  id: string;
  name: string;
  position?: string;
  mobile?: string;
  wechat?: string;
  isPrimary?: boolean;
}

export interface FollowUpRecord {
  id: string;
  date: string;
  type: 'call' | 'visit' | 'wechat' | 'email' | 'system';
  content: string;
  operator: string;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  status: Status;
  score: number;
  potentialValue: number;
  lastContact: string;
  probability: number;
  source: string;
  intent: 'High' | 'Medium' | 'Low';
  position?: string;
  mobile?: string;
  wechat?: string;
  industry?: string;
  targetCertifications?: string;
  unifiedSocialCreditCode?: string;
  existingCertifications?: string[];
  contacts?: ContactPerson[];
  targetCertExpiryDate?: string;
  followUpRecords?: FollowUpRecord[];
  isAnalyzing?: boolean;
  // 工商扩展信息 (Excel 导入用)
  registeredAddress?: string; // 注册地址
  legalRepresentative?: string; // 法定代表人
  registeredCapital?: string; // 注册资本
  businessScope?: string; // 经营范围
  foundingDate?: string; // 成立日期
  operationStatus?: string; // 经营状态
  companyType?: string; // 企业类型
  issuingBody?: string; // 发证机构 (Excel 导入用)
}

export interface Customer {
  id: string;
  name: string;
  contactPerson: string;
  totalValue: number;
  riskStatus: 'low' | 'medium' | 'high';
  activeContracts: number;
  mobile?: string;
  industry?: string;
  existingCertifications?: string[];
  certificates?: CertificateDetail[];
  followUpRecords?: FollowUpRecord[];
  // Added fields to fix "Property does not exist" errors in Customers.tsx
  contacts?: ContactPerson[];
  legalRepresentative?: string;
  registeredCapital?: string;
  foundingDate?: string;
  unifiedSocialCreditCode?: string;
  registeredAddress?: string;
  businessScope?: string;
  companyType?: string;
  operationStatus?: string;
  targetCertifications?: string;
  status?: Status;
  firstServiceDate?: string;
  lastServiceDate?: string;
  serviceCount?: number;
  // PDCA Fields
  cooperationCount?: number; // 合作次数
  lastProjectAt?: string; // 最近一次项目时间
  lastProjectType?: string; // 最近一次项目类型
  nextOpportunity?: string; // 下一次机会
  customerNotes?: string; // 客户认知沉淀

  // T-001 Customer Value Stats
  totalAmount?: number; // 历史累计消费
  yearAmount?: number; // 当年累计消费
  level?: 'A' | 'B' | 'C'; // 系统自动评级
  pdcaPaidContractIds?: string[]; // 已计入PDCA的回款合同
}

export interface Receivable {
  id: string;
  node: string;
  amount: number;
  dueDate: string;
  status: 'paid' | 'unpaid' | 'overdue';
  rejectionReason?: string;
}

export interface ContractAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  uploadDate: string;
  url?: string;
}

export interface Contract {
  id: string;
  title: string;
  customerName: string;
  amount: number;
  signDate: string;
  status: Status;
  serviceLine: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  archiveStatus: 'active' | 'archived';
  receivables: Receivable[];
  attachments: ContractAttachment[];
  contractNo?: string;
  contactPerson?: string;
  paymentMethod?: string;
  remarks?: string;
}

export interface Reminder {
  id: string;
  title: string;
  content: string;
  date: string;
  type: 'task' | 'payment' | 'expire' | 'risk' | 'opportunity';
  isRead: boolean;
  linkId?: string;
  linkType?: 'lead' | 'customer' | 'project' | 'contract' | 'intel';
  forRole?: RoleID[]; // 提醒针对的角色
  forUserIds?: string[]; // 优先级高于 forRole
  channels?: NotificationChannel[];
  pushedToWeChat?: boolean;
}

export type ReminderSeverity = 'high' | 'medium' | 'low';

export interface AggregatedReminder {
  id: string;
  linkType: 'lead' | 'customer' | 'project' | 'contract' | 'intel';
  linkId: string;
  projectId?: string;
  projectName?: string;
  customerName?: string;
  severity: ReminderSeverity;
  mainScene: string;
  count: number;
  latestDate: string;
  samples: Reminder[];
  tags: string[];
}

export interface Vendor {
  id: string;
  name: string;
  serviceType: string;
  contactPerson: string;
  phone: string;
  rating: number;
}

export type ProjectType = 'Self-Operated' | 'Outsourced' | 'Joint';
export type ProjectCategory = 'Delivery' | 'FollowUp';
export type SettlementRuleType = 'Ratio' | 'Fixed' | 'ProfitShare';

export type ServiceItemStatus = 'Pending' | 'InProgress' | 'Completed';

export type ServiceDeliveryMode = 'Self' | 'Partner';
export type ServiceCategory = '体系认证' | '产品认证' | '政府项目申报' | '管理培训/顾问服务' | '生产许可类' | '其他';

export interface ServiceItem {
  id: string;
  name: string;
  owner?: string;
  status: ServiceItemStatus;
  notes?: string;
  catalogId?: string;
  standardName?: string;
  rawName?: string;
  category?: ServiceCategory;
  deliveryMode?: ServiceDeliveryMode;
  workflowTemplateId?: string;
  autoGenerateTasks?: boolean;
}

export interface ServiceCatalogItem {
  id: string;
  name: string;
  category: ServiceCategory;
  deliveryMode: ServiceDeliveryMode;
  code?: string;
  aliases?: string[];
  workflowTemplateId?: string;
}

export interface ServiceWorkflowTemplateStep {
  title: string;
  offsetDays: number;
  category: ProjectTask['category'];
  priority?: ProjectTask['priority'];
}

export interface ServiceWorkflowTemplate {
  id: string;
  name: string;
  steps: ServiceWorkflowTemplateStep[];
}

export interface SettlementConfig {
  rule: SettlementRuleType;
  value: number;
  base?: 'Revenue' | 'GrossProfit';
}

export interface Project {
  id: string;
  customerId?: string; // 关联客户ID (最终必须存在)
  name: string;
  contractRef: string;

  // T-001 Cost Closure
  costStatus?: '待补全' | '已确认';
  projectAmount?: number; // 必须 > 0 才能完成

  projectCategory: ProjectCategory;
  manager: string;
  progress: number;
  status: Status;
  paymentStatus: 'paid' | 'partial' | 'unpaid' | 'overdue';
  deadline: string;
  duration?: number; // 交付周期（天）
  projectType: ProjectType;
  tasks: ProjectTask[]; // 核心任务列表
  serviceItems?: ServiceItem[];
  vendorId?: string;
  vendorName?: string;
  purchasingCost?: number;
  settlementConfig: SettlementConfig;
  aiInsight?: {
    lastAnalysisTime: string;
    riskLevel: 'Low' | 'Medium' | 'High';
    summary: string;
  };
  completionRecord?: {
    eventId: string;
    actualEndDate: string;
    duration: number; // 实际周期（天）
    passRate: boolean; // 是否一次通过
    taskCompletionRate: number; // 任务完成率
    delayedTasksCount: number; // 延期任务数
    rating?: 'S' | 'A' | 'B' | 'C'; // 系统评级
    autoCompleted?: boolean;
    customerId?: string;
    generatedReminderIds?: string[];
    customerPatchBefore?: {
      status?: Status;
      firstServiceDate?: string;
      lastServiceDate?: string;
      serviceCount?: number;
    };
  };
}

export type AIActionType = 'ADD_REMINDER' | 'UPDATE_RISK' | 'SUGGEST_TASK' | 'UPDATE_STATUS' | 'CREATE_CONTRACT';

export interface AIAction {
  type: AIActionType;
  payload: any;
  reason: string;
}

export interface AIDecisionLog {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: string;
  analysisSummary: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  suggestedActions: AIAction[];
  executed: boolean;
}

export interface Settlement {
  id: string;
  type: 'Internal' | 'External';
  beneficiary: string;
  contractRef: string;
  month: string;
  amount: number;
  status: 'paid' | 'confirmed' | 'draft';
  notes?: string;
}

export interface AuditIssue {
  id: string;
  customerName: string;
  findings: string;
  severity: 'Minor' | 'Major' | 'Observation';
  status: 'Open' | 'Rectifying' | 'Verifying' | 'Closed';
  auditor: string;
  // Added fields to fix "Property does not exist" errors in Audit.tsx
  rectificationPlan?: string;
  auditType?: string;
  createDate?: string;
  deadline?: string;
  contractRef?: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  format: string;
  size: string;
  updatedAt: string;
  content?: string;
  summary?: string;
  aiVisible?: boolean;
  // Added to fix property errors in Knowledge.tsx and Contracts.tsx
  sourceUrl?: string;
  // Knowledge Hub linkage & access control
  linkType?: 'customer' | 'project' | 'contract' | 'task' | 'pdca' | 'audit' | 'strategy' | 'service' | 'other';
  linkId?: string;
  linkTitle?: string;
  tags?: string[];
  source?: 'manual' | 'system' | 'ai';
  autoGenerated?: boolean;
  accessRoles?: RoleID[]; // empty/undefined => all roles
  accessUserIds?: string[]; // explicit allowlist
}

export type MarketSignalKind = 'policy' | 'industry' | 'company' | 'tender' | 'standard' | 'event';
export type MarketSignalStatus = 'new' | 'triaged' | 'converted' | 'ignored' | 'expired';
export type MarketUrgency = 'high' | 'medium' | 'low';

export interface MarketSignal {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string; // YYYY-MM-DD
  summary: string;
  content?: string;
  kind: MarketSignalKind;
  regions: string[]; // e.g. 温州/苍南/平阳/龙港
  industries: string[]; // e.g. 塑料编织制品制造业/食包/药材/印刷/食品/餐饮
  departments?: string[];
  tags?: string[];
  deadline?: string; // optional window/deadline

  // Mapping to internal services
  serviceCategory?: string;
  serviceItemCode?: string;
  opportunityHypothesis?: string[];
  recommendedActions?: string[];

  // Ops
  score: number; // 0-100
  urgency: MarketUrgency;
  status: MarketSignalStatus;
  ownerUserId?: string;

  // Conversion chain
  convertedTo?: {
    projectId?: string;
    contractId?: string;
    customerId?: string;
    leadId?: string;
    pdcaDocId?: string;
  };
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface StrategicTask {
  id: string;
  title: string;
  status: string;
  // Added fields to fix property errors in Strategy.tsx
  priority?: 'High' | 'Medium' | 'Low';
  owner?: string;
  deadline?: string;
  impact?: string;
  type?: string;
}

// --- 权限系统核心类型定义 ---

// 1. 动作代码定义 (Action Codes)
export type ActionCode = 
  | 'PROJECT_CREATE'
  | 'PROJECT_EDIT_INFO'
  | 'PROJECT_ASSIGN_MANAGER'
  | 'PROJECT_PAUSE'
  | 'TASK_CREATE'
  | 'TASK_COMPLETE'
  | 'TASK_DELETE'
  | 'CONTRACT_CREATE'
  | 'CONTRACT_VIEW_AMOUNT'
  | 'PAYMENT_CONFIRM'
  | 'CUSTOMER_CREATE'
  | 'LEAD_CONVERT';

// 2. AI 可调用指令白名单 (AI Allowed Actions)
export type AIAllowedAction = 
  | 'CREATE_PROJECT'      // -> PROJECT_CREATE
  | 'ADD_TASK'            // -> TASK_CREATE
  | 'COMPLETE_TASK'       // -> TASK_COMPLETE
  | 'UPDATE_PROGRESS'     // -> PROJECT_EDIT_INFO
  | 'ADD_REMINDER'        // -> 通用能力 (所有人可用)
  | 'CREATE_CUSTOMER'     // -> CUSTOMER_CREATE
  | 'CREATE_CONTRACT';    // -> CONTRACT_CREATE

// 3. 角色能力表结构
export interface RoleCapability {
  actions: ActionCode[]; // 该角色拥有的动作代码列表
  dataScope: 'ALL' | 'DEPARTMENT' | 'OWN' | 'NONE'; // 数据范围
}

// --- Raw Data Layer ---
export interface ImportRowRaw {
  [key: string]: any; // 保留所有原始列，不丢弃任何信息
}

export interface ImportRecord {
  id: string;
  fileName: string;
  importDate: string;
  totalRows: number;
  processedRows: number;
  status: 'pending' | 'processed' | 'archived';
  rawContent: ImportRowRaw[]; // 完整保留原始数据
  operator: string;
  stats?: {
    created: number;
    duplicated: number;
    skipped?: number;
  };
}
