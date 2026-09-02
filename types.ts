

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
/**
 * 权限模板。角色 ≠ 岗位：岗位放 positionTags，例外权限用 extraActions 委派。
 * SYS_ADMIN 是技术管理员，与业务最高权限 ADMIN 分开，便于将来收紧业务可见范围。
 */
export type RoleID = 'ADMIN' | 'SYS_ADMIN' | 'MANAGER' | 'SALES' | 'CONSULTANT' | 'FINANCE';

/**
 * 系统管理员权限模式。
 * full   —— 技术 + 业务全权（系统稳定运行前使用）
 * limited —— 技术全权 + 业务只读，改业务数据需临时提权
 */
export type SysAdminMode = 'full' | 'limited';

/** 客户/线索可见范围策略（公司级，由老板设置） */
export type CustomerVisibilityPolicy =
  | 'all'        // 全员可见
  | 'dedupe'     // 可查重：能搜到「已由某某跟进」，看不到联系方式与跟进记录
  | 'owner';     // 仅负责人可见
export type DashboardPersona = 'boss' | 'sales' | 'consultant' | 'finance';

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
  /** 在角色默认能力之外额外授予的动作（行政代管账号、顾问续签合同等场景） */
  extraActions?: ActionCode[];
  /** 显式撤销的动作，优先级高于角色默认与 extraActions */
  deniedActions?: ActionCode[];
  /** 账号有效期（YYYY-MM-DD）。留空表示永久有效，用于长期兼职/亲属 */
  accountExpiresAt?: string;
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
/**
 * 任务跳过原因。界面上一律显示中文，不出现英文码。
 * 取值来自真实业务场景，改这里要和业务方确认。
 */
export type TaskSkipReason =
  | 'CustomerHandled'
  | 'CustomerDropped'
  | 'StandardChanged'
  | 'DeferredToRenewal'
  | 'LegacyBackfill'
  | 'Other';

export const TASK_SKIP_REASON_LABEL: Record<TaskSkipReason, string> = {
  CustomerHandled: '客户自行处理',
  CustomerDropped: '客户放弃该体系',
  StandardChanged: '标准变更，不需要此步骤',
  DeferredToRenewal: '顺延到续期项目',
  /*
    系统上线前就做完的活。

    这批项目是真做过的，但当时没在系统里记过程，
    补录时**不能直接标成"已完成"**——那等于凭空造出一条
    "某人某天勾了这个任务"的执行记录，而实际没人勾过。

    标成跳过 + 这个原因，说的是实话：活干了，过程记录没有。
    将来查"这个项目当时谁做的第几步"，看到的是"无过程记录"，
    而不是一条看起来煞有介事却查无此人的记录。
  */
  LegacyBackfill: '系统上线前完成，无过程记录',
  Other: '其他',
};

export interface ProjectTask {
  id: string;
  title: string;
  deadline: string;
  /**
   * 任务状态。'Skipped'（已跳过）是刻意加的第三态。
   *
   * 为什么不强制「任务全完成才能完结项目」：
   * 强制不会让人做事，只会让人假打勾——空着至少还知道没做，假勾了你以为做了。
   * 现实中也确实存在客户自行处理、客户放弃该体系、标准变更等情况。
   * 所以改成「不强制完成，但强制交代」：跳过必须填原因。
   */
  status: 'Pending' | 'Completed' | 'Skipped';
  /**
   * 跳过原因（status='Skipped' 时必填）。
   * 结构化枚举而不是自由文本——攒起来才能回答
   * 「哪个任务在 80% 的项目里都被跳过」，那是精简任务模板的唯一真实依据。
   */
  skipReason?: TaskSkipReason;
  /** 选「其他」时的补充说明 */
  skipNote?: string;
  priority: 'High' | 'Medium' | 'Low';
  category: 'Core' | 'Auxiliary' | 'System' | 'ThirdParty'; // 区分核心与辅助任务用于计算进度
  owner: string;
  serviceItemId?: string;
}

export type ProjectWorkLogSource = 'manual' | 'task_transition';

export interface ProjectWorkLog {
  id: string;
  projectId: string;
  serviceItemId?: string;
  taskId?: string;
  logDate: string; // YYYY-MM-DD
  workContent: string;
  actualHours: number;
  issueNote?: string;
  nextPlan?: string;
  source: ProjectWorkLogSource;
  operatorUserId: string;
  operatorName: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
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
  scope?: string;
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
  /** 归属销售的用户 ID。判断「我的线索」以它为准，姓名只作显示 */
  ownerUserId?: string;
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
  /**
   * 销售报备"客户已付款，请财务核对"。
   * 这不是到账确认——确认到账始终只有财务能做（PAYMENT_CONFIRM）。
   * 记录报备人和时间，责任链清楚：销售报信、财务确认。
   */
  paymentClaim?: {
    claimedBy: string;
    claimedByUserId: string;
    claimedAt: string;
    note?: string;
  };
}

export interface ContractAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  uploadDate: string;
  url?: string;
}

export interface ContractServiceItemSnapshot {
  name: string;
  rawName?: string;
  catalogId?: string;
  standardName?: string;
  category?: ServiceCategory;
  deliveryMode?: ServiceDeliveryMode;
  workflowTemplateId?: string;
}

export interface Contract {
  id: string;
  title: string;
  owner?: string;
  customerId?: string; // 关联客户ID（新增可选字段，兼容历史数据）
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
  serviceItems?: ContractServiceItemSnapshot[]; // 合同服务项快照（来自合同识别/人工录入）
}

export interface Reminder {
  id: string;
  title: string;
  content: string;
  date: string;
  type: 'task' | 'payment' | 'expire' | 'risk' | 'opportunity';
  isRead: boolean;
  linkId?: string;
  linkType?: 'lead' | 'customer' | 'project' | 'contract' | 'intel' | 'audit';
  forRole?: RoleID[]; // 提醒针对的角色
  forUserIds?: string[]; // 优先级高于 forRole
  channels?: NotificationChannel[];
  pushedToWeChat?: boolean;
}

export type ReminderSeverity = 'high' | 'medium' | 'low';

export interface AggregatedReminder {
  id: string;
  linkType: 'lead' | 'customer' | 'project' | 'contract' | 'intel' | 'audit';
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
export type ProjectSourceType = 'intel' | 'lead' | 'customer' | 'contract' | 'manual';
export type ProjectMode = 'followup' | 'delivery';
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
  /** 负责人的用户 ID。判断「我的项目」与数据权限以它为准，manager 只作显示 */
  ownerUserId?: string;
  name: string;
  contractRef: string;
  sourceType?: ProjectSourceType; // 新增：项目来源类型（兼容字段，不替换旧逻辑）
  sourceRef?: string; // 新增：来源对象ID（如 signalId / leadId / customerId）
  projectMode?: ProjectMode; // 新增：项目模式（followup/delivery）

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
    completedAt?: string; // ISO 8601
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
      cooperationCount?: number;
      lastProjectAt?: string;
      lastProjectType?: string;
      nextOpportunity?: string;
      totalAmount?: number;
      yearAmount?: number;
      level?: 'A' | 'B' | 'C';
    };
  };
}

/*
  AI 可以提案的动作。

  后三个是 2026-09-01 补的**高风险动作**——它们的共同点不是「重要」，
  是「做错了很难发现、发现了很难回退」：
    · CONFIRM_RECEIVABLE 确认到账不可撤销，还会触发项目付款状态和客户分级
    · COMPLETE_PROJECT   一口气写七八处（评级、分级、PDCA、提醒、结算草稿）
    · CREATE_CONTRACT    金额是提成和业绩的基数，AI 读错小数点就全错

  它们**只能提案，不能直接执行**——见 AIChatWidget 的分流。
  区别不在动作本身有多危险，在**这个动作是谁决定的**：
  人自己点按钮是他的判断；AI 从一句话推断出要动哪一笔，中间隔着一层猜测。
*/
export type AIActionType =
  | 'ADD_REMINDER' | 'UPDATE_RISK' | 'SUGGEST_TASK' | 'UPDATE_STATUS'
  | 'CREATE_CONTRACT' | 'CONFIRM_RECEIVABLE' | 'COMPLETE_PROJECT';

export interface AIAction {
  type: AIActionType;
  payload: any;
  reason: string;
}

/**
 * AI 提案：AI 起草的一个动作，等人确认后才生效（待确认队列）。
 *
 * 为什么必须有这层：原来 AI 诊断出的高优先级动作是**直接自动执行**的
 * （AppContext 里 `executeAIAction` 无条件调用），人不知道 AI 改了什么；
 * 而其余动作压根不执行，只在页面上展示。两头都错——
 * 该受监督的偷偷做了，该产生价值的只是摆着看。
 *
 * 收口成一条管道后：AI 一律只提案，人一键批准/驳回，执行只发生在批准之后。
 * 这样 AI 从「填表工具」变成「受监督的助手」，能力可以放开而不失控。
 */
export type AIProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type AIProposalSource =
  | 'project_diagnosis'    // 项目诊断
  | 'audit_remediation'    // 不符合项整改方案
  | 'lead_scoring'         // 线索评分与排序
  | 'task_template'        // 任务模板精简建议
  | 'doc_draft'            // 体系文件起草
  | 'chat_high_risk';      // AI 对话框里推断出的高风险动作（2026-09-01）

export interface AIProposal {
  id: string;
  createdAt: string;
  source: AIProposalSource;
  /** 关联对象 id（项目/不符合项/线索…），配合 source 定位 */
  sourceRef: string;
  /** 给人看的一句话，队列里就显示这个 */
  title: string;
  /** 可执行动作，批准后由 executeAIAction 落地 */
  action: AIAction;
  /** AI 为什么这么建议——人要据此判断，不能只给结论 */
  reason: string;
  confidence?: 'high' | 'medium' | 'low';
  status: AIProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  /**
   * 驳回原因。和任务的「跳过原因」是同一个道理：
   * 它记录了 AI 哪里想错了，是让 AI 变准的唯一真实依据，
   * 攒起来比任何通用模型调优都管用。
   */
  rejectReason?: string;
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

export interface AuditEvidence {
  id: string;
  name: string;
  size: string;
  type: string;
  uploadDate: string;
  uploadedBy?: string;
  note?: string;
  url?: string;
  isExample?: boolean;
}

export interface AuditVerification {
  verifiedBy: string;
  verifiedAt: string;
  notes: string;
}

export interface AuditIssue {
  id: string;
  customerName: string;
  customerId?: string;
  projectId?: string;
  contractId?: string;
  findings: string;
  severity: 'Minor' | 'Major' | 'Observation';
  status: 'Open' | 'Rectifying' | 'Verifying' | 'Closed';
  auditor: string;
  rectificationPlan?: string;
  auditType?: string;
  createDate?: string;
  deadline?: string;
  contractRef?: string;
  rectificationTaskId?: string;
  evidences?: AuditEvidence[];
  verification?: AuditVerification;
  knowledgeDocId?: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  format: string;
  size: string;
  updatedAt: string;
  dedupeHash?: string;
  originalFileName?: string;
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

  /* ── 检索维度（2026-08-24 新增，全部可选，不影响存量文档）──────────
     为什么加这几个而不是做文件夹式分类：
     一份《平阳油茶合作社 SC 认证复盘》同时属于「农业」「SC 标准」
     「客户复盘」「我们的经验」「2026 年」——放进任何**一个**文件夹都是错的。
     多维标签才能让「食品厂做 SC 要注意什么」这种问法检索得准。 */

  /** 行业。信义按行业做认证，塑编厂和食品厂的经验不能混着给 */
  industry?: string;
  /** 涉及的标准/体系，如 ['ISO 9001', 'SC']。业务上最有区分度的维度 */
  standards?: string[];

  /**
   * 可信层级。**AI 引用时必须区分**，这是最要紧的一个字段。
   *
   *   official       标准原文、官方文件 —— 可以直接照着答
   *   ourExperience  我们做过的项目总结 —— 是经验不是规定，要说明「据我们以往经验」
   *   aiDraft        AI 生成还没人审 —— 只能当草稿提示，不能当依据
   *
   * 不分层的后果：AI 把一份没人审过的 AI 草稿当成公司规定答给客户。
   * 越是"记得清楚"的 AI，说错时越有说服力。
   */
  trustLevel?: 'official' | 'ourExperience' | 'aiDraft';

  /**
   * 失效日期。标准会改版（ISO 9001:2015 之后还会有新版），
   * **过期的知识比没有知识更危险**——它看起来仍然权威。
   * 到期后检索时降权并提示"这份依据可能已过期"。
   */
  validUntil?: string;
  /** 上次人工复核的时间与复核人。长期没人看过的经验要标出来 */
  reviewedAt?: string;
  reviewedBy?: string;
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
  | 'PROJECT_VIEW'
  | 'PROJECT_CREATE'
  | 'PROJECT_EDIT_INFO'
  | 'PROJECT_ASSIGN_MANAGER'
  | 'PROJECT_PAUSE'
  | 'TASK_CREATE'
  | 'TASK_COMPLETE'
  | 'TASK_DELETE'
  | 'LEAD_CREATE'          // 新建/导入线索
  | 'SETTLEMENT_MANAGE'    // 生成、调整、发放结算（与只读的 SETTLEMENT_VIEW 分开）
  | 'KNOWLEDGE_WRITE'      // 写入知识中心
  | 'REMINDER_WRITE'       // 创建/修改提醒
  /** 运行项目 AI 诊断。原来写死成 ['ADMIN','SYS_ADMIN','MANAGER'] 数组，
   *  绕过权限矩阵——体检脚本查不到，改角色定义也不会同步。 */
  | 'PROJECT_AI_DIAGNOSE'
  /** 系统自检与自愈（`/api/admin/diagnose`）。**和 PROJECT_AI_DIAGNOSE 不是一回事**：
   *  那个是「诊断某个项目的交付风险」，属于业务动作，总助也该有；
   *  这个是「检查整套系统是否健康、并自动修复配置」，属于运维动作。
   *
   *  2026-08-31 补。原来 AI 对话框的 diagnose 动作被错映射到 PROJECT_AI_DIAGNOSE，
   *  于是前端放行总助、而服务端 `/api/admin/diagnose` 只认 ADMIN——
   *  总助会撞上一个看起来像 bug 的 403。两边现在用同一个动作码。 */
  | 'SYSTEM_DIAGNOSE'
  /** 删除**别人**的工作日志（删自己的不需要此权限）。
   *  工作日志是现场第一手记录，属于最值钱的沉淀数据，删除权必须进矩阵。 */
  | 'WORKLOG_DELETE_ANY'
  | 'CONTRACT_CREATE'
  | 'CONTRACT_VIEW_AMOUNT'
  | 'PAYMENT_CONFIRM'
  /** 查看结算/提成金额。刻意与 CONTRACT_VIEW_AMOUNT 分开：
   *  销售必须看得到自己谈的合同金额，但不该看到别人的提成。 */
  | 'SETTLEMENT_VIEW'
  | 'CUSTOMER_CREATE'
  | 'LEAD_CONVERT'
  /* ── 修改类动作 ──────────────────────────────────────────────
     2026-08-21 补。之前只有 *_CREATE 没有 *_EDIT，
     导致「销售可以看全部客户，但只能修改自己的」这条规矩
     **没有动作码可挂**——建了角色也管不住修改行为。
     授权判定按后缀识别读写方向（见 authorize.js 的 WRITE_ACTION），
     所以命名必须保持 _EDIT 后缀。 */
  | 'CUSTOMER_EDIT'
  | 'LEAD_EDIT'
  | 'CONTRACT_EDIT'
  /* ── 归属动作 ────────────────────────────────────────────────
     两种归属机制，业务方 2026-08-21 定：
       线索  → 认领（LEAD_CLAIM）：无主线索谁跟进谁认领，改的瞬间归到他名下。
               455 条无主线索靠人工指派不现实，让归属在日常干活中自然长出来。
       合同/项目 → 指派（*_ASSIGN_OWNER）：必须由管理者显式指定负责人，
               不能自认领——合同和项目牵扯金额与交付责任，认领等于自己给自己派活。
     PROJECT_ASSIGN_MANAGER 已存在（指派项目经理），
     PROJECT_ASSIGN_OWNER 是另一件事（指派归属人，决定谁能改），不要合并。 */
  | 'LEAD_CLAIM'
  | 'LEAD_ASSIGN_OWNER'
  | 'CONTRACT_ASSIGN_OWNER'
  | 'PROJECT_ASSIGN_OWNER'
  | 'EMPLOYEE_VIEW'
  | 'EMPLOYEE_CREATE'
  | 'EMPLOYEE_UPDATE'
  | 'EMPLOYEE_UPDATE_ROLE'
  | 'EMPLOYEE_DISABLE'
  | 'EMPLOYEE_RESET_PASSWORD'
  | 'AUTH_AUDIT_VIEW';

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
export type DataScope = 'ALL' | 'DEPARTMENT' | 'OWN' | 'NONE';

export interface RoleCapability {
  actions: ActionCode[]; // 该角色拥有的动作代码列表
  /**
   * @deprecated 用 readScope / writeScope 替代。保留是为了不破坏旧代码。
   *
   * 单一 dataScope 表达不了真实业务：
   * 「销售可以看全部客户，但只能修改自己的」——读是 ALL、写是 OWN，
   * 一个字段说不清。2026-08-20 业务方确认后拆开。
   */
  dataScope: DataScope;
  /** 能看到哪些数据 */
  readScope: DataScope;
  /** 能修改哪些数据。永远不宽于 readScope——改不了自己看不见的东西 */
  writeScope: DataScope;
  /**
   * 单次操作的金额上限（分）。超过则拒绝。
   * 不设表示不限。用于「销售只能确认 5 万以下回款」这类约束。
   */
  maxAmountFen?: number;
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
