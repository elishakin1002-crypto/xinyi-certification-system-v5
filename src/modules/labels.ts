/**
 * 枚举 → 界面文案，全系统只此一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个文件（2026-09-17）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来：「为什么字段的统一这样的致命的问题，你怎么一直没有提出来，
 *   知道我发现来，你才来改，这难道不是一个基础问题吗？」
 *
 * 他是对的。`glossary.ts` 早就在，但它只管**指标口径**（进行中项目、
 * 逾期任务这类"数的是什么"），**没有管枚举值怎么显示**。
 * 于是每个页面、每个断点（桌面/手机）各写一套 switch 或三元表达式，
 * 一份 37 条的排查报告里 12 条「同义异名」几乎全是这么来的。
 *
 * 光靠"约定用同一个词"没用（CLAUDE.md 二点五第 4 条：
 * 要人记住的规矩早晚有人记不住）。要让它**做不到不一致**：
 * 枚举值到文案的映射只有这一份，页面只能调函数，不能自己写字面量。
 *
 * ── 这份文件直接解决的、已经发生过的错 ────────────────────────
 *
 * · 同一份**中风险**合同，桌面显示「中风险」，手机显示「正常」——
 *   手机分支只判 High，其余一律"正常"，风险提示凭空消失（C19）
 * · 不符合项四态（待整改/整改中/待验证/已关闭）在手机上被压成两态，
 *   「待整改」和「待验证」都被显示成「整改中」，含义被改了（A01）
 * · 审计日志手机端直接把 `USER_CREATE` 这种内部代码显示给人看（A10）
 * · 任务的 Pending 和 Skipped 都被显示成「进行中」——
 *   「还没开始」「决定不做」「正在做」是三个完全不同的信号（C08）
 *
 * 共同点：**桌面那份是对的，手机那份是后加的、漏了分支。**
 * 只要还允许两处各写一套，下一个断点、下一个页面照样会漏。
 *
 * ── 用法 ────────────────────────────────────────────────────
 *
 *   import { auditStatusLabel, contractRiskLabel } from '../src/modules/labels';
 *   <span>{auditStatusLabel(issue.status)}</span>
 *
 * 值不认识时一律返回「未知(原值)」而不是静悄悄显示成某个正常状态 ——
 * 显示"未知"会让人去查，显示"正常"会让人走开。
 */

/** 认不出来的值怎么显示。**绝不能回退成某个看起来正常的状态** */
const unknown = (raw: unknown, what = '未知') => {
  const v = String(raw ?? '').trim();
  return v ? `${what}(${v})` : what;
};

const pick = <T extends string>(map: Record<T, string>, value: unknown, what?: string): string => {
  const key = String(value ?? '').trim() as T;
  return map[key] ?? unknown(value, what);
};

/* ══════════════════════════════════════════════════════════════
   不符合项
   ══════════════════════════════════════════════════════════════ */

/**
 * 不符合项状态。四态各有各的意思，**不许在窄屏上合并** ——
 * 「等对方整改」和「整改完了等我方验证」是两个人在等，不是同一件事。
 */
export const AUDIT_STATUS_LABEL = {
  Open: '待整改',
  Rectifying: '整改中',
  Verifying: '待验证',
  Closed: '已关闭'
} as const;
export const auditStatusLabel = (v: unknown) => pick(AUDIT_STATUS_LABEL, v, '未知状态');

/**
 * 不符合项严重程度。
 * Major 只叫「严重」，不另起「重大」—— 两个词会让人以为是两档。
 */
export const AUDIT_SEVERITY_LABEL = {
  Major: '严重',
  Minor: '一般',
  Observation: '观察'
} as const;
/** 表单/详情里用全称，列表窄徽章用上面的短名 */
export const AUDIT_SEVERITY_FULL = {
  Major: '严重不符合项',
  Minor: '一般不符合项',
  Observation: '观察项'
} as const;
export const auditSeverityLabel = (v: unknown) => pick(AUDIT_SEVERITY_LABEL, v, '未知严重度');
export const auditSeverityFull = (v: unknown) => pick(AUDIT_SEVERITY_FULL, v, '未知严重度');

/* ══════════════════════════════════════════════════════════════
   合同风险
   ══════════════════════════════════════════════════════════════ */

/**
 * 合同风险等级。
 *
 * 缺值显示「未评估」而不是「正常」——**这是这组里最重要的一条**。
 * 手机端原来只判 High，Medium 和缺值都落到「正常」，
 * 于是一份中风险合同在手机上看起来完全没问题。
 */
export const CONTRACT_RISK_LABEL = {
  High: '高风险',
  Medium: '中风险',
  Low: '低风险'
} as const;
export const contractRiskLabel = (v: unknown) => {
  const key = String(v ?? '').trim();
  if (!key) return '未评估';
  return (CONTRACT_RISK_LABEL as Record<string, string>)[key] ?? unknown(v, '未知风险');
};
/** 徽章配色跟着等级走，未评估用中性灰 —— 不给它绿色 */
export const contractRiskTone = (v: unknown): 'red' | 'amber' | 'emerald' | 'gray' => {
  const key = String(v ?? '').trim();
  if (key === 'High') return 'red';
  if (key === 'Medium') return 'amber';
  if (key === 'Low') return 'emerald';
  return 'gray';
};

/* ══════════════════════════════════════════════════════════════
   任务
   ══════════════════════════════════════════════════════════════ */

/**
 * 任务四态。
 * 「待开始」「进行中」「已跳过」被合并成「进行中」过 ——
 * 准备做、正在做、决定不做，是三种完全不同的进度信号。
 */
export const TASK_STATUS_LABEL = {
  Pending: '待开始',
  InProgress: '进行中',
  Completed: '已完成',
  Skipped: '已跳过'
} as const;
export const taskStatusLabel = (v: unknown) => pick(TASK_STATUS_LABEL, v, '未知状态');

/* ══════════════════════════════════════════════════════════════
   知识中心
   ══════════════════════════════════════════════════════════════ */

/**
 * 知识分类。上传时选的名字和查看时看到的名字必须是同一个 ——
 * 原来上传叫「产品手册」，存进去再看叫「产品资料」，人会以为存错了地方。
 */
export const KNOWLEDGE_CATEGORY_LABEL = {
  'Customer Review': '客户复盘 (PDCA)',
  'Company Profile': '公司资料/制度',
  'Product Service': '产品资料',
  Standard: '标准法规',
  Template: '文档模板',
  Training: '培训资料',
  'AI Generated': 'AI交付'
} as const;
export const knowledgeCategoryLabel = (v: unknown) => pick(KNOWLEDGE_CATEGORY_LABEL, v, '未分类');

/* ══════════════════════════════════════════════════════════════
   提醒 / 反馈 / 情报
   ══════════════════════════════════════════════════════════════ */

/**
 * 提醒严重程度。
 * 原来一处是「紧急/关注/一般」，另一处把 medium 显示成「高」——
 * **同一个值在两页分别是"关注"和"高"**，人无法判断哪个更急。
 */
export const REMINDER_SEVERITY_LABEL = {
  high: '紧急',
  medium: '关注',
  low: '一般'
} as const;
export const reminderSeverityLabel = (v: unknown) => pick(REMINDER_SEVERITY_LABEL, v, '未知');

/** 用户反馈的类别。提交端和管理端必须是同一句话 —— 管理员看到的应当是用户选中的含义 */
export const FEEDBACK_KIND_LABEL = {
  bug: '系统出错',
  confused: '操作不清楚',
  wrong: '结果不对',
  improve: '改进建议'
} as const;
export const feedbackKindLabel = (v: unknown) => pick(FEEDBACK_KIND_LABEL, v, '其他');

/**
 * 反馈紧急程度。
 * 用户选的是「能绕过去，但烦」，管理端原来显示成「有点烦」——
 * 弱化了影响，管理员会因此排低优先级。
 */
export const FEEDBACK_SEVERITY_LABEL = {
  blocking: '挡住干活',
  annoying: '能绕过但影响使用',
  minor: '不急'
} as const;
export const feedbackSeverityLabel = (v: unknown) => pick(FEEDBACK_SEVERITY_LABEL, v, '未填');

/** 情报紧急度。列表中文、详情英文的问题出在这里 */
export const INTEL_URGENCY_LABEL = {
  high: '高',
  medium: '中',
  low: '低'
} as const;
export const intelUrgencyLabel = (v: unknown) => pick(INTEL_URGENCY_LABEL, v, '未定');

/* ══════════════════════════════════════════════════════════════
   字段名（不是枚举，是同一个字段在不同页面的叫法）
   ══════════════════════════════════════════════════════════════ */

export const FIELD = {
  /** 企业唯一标识，用于查重。用全称才能和普通内部编号区分开 */
  unifiedSocialCreditCode: '统一社会信用代码',
  /** 编辑页本来就允许座机，字段名叫 mobile 不代表业务只收手机 */
  contactPhone: '联系电话（手机或座机）',
  /** 整改约定日期。不用「死线」这种额外语气 */
  auditDeadline: '整改截止日期',
  auditDeadlineShort: '整改截止',
  /** 项目层面的负责人 */
  projectManager: '项目负责人',
  /** 任务层面的执行人 —— 和项目负责人可以不是同一个人 */
  taskOwner: '任务执行人',
  /** 任务没指定执行人时回退到项目负责人，要说明白 */
  taskOwnerFallback: '由项目负责人承接',
  /** 公司要收的钱，和财务的对外支出结算分清 */
  receivableNode: '回款节点',
  receivablePlan: '回款计划',
  receivableAmount: '本期应收金额',
  /** 任务交给谁执行。「合作」在服务交付方式里另有含义，不复用 */
  thirdPartyTask: '第三方'
} as const;

/* ══════════════════════════════════════════════════════════════
   「没有下一步了」到底是哪一种
   ══════════════════════════════════════════════════════════════ */

/**
 * 项目没有下一条待办任务时，该说哪句话。
 *
 * **「没排任务」「都跳过了」「真做完了」是三件完全不同的事**，
 * 混成一句「任务已全部完成」会让人以为这个项目可以结项了。
 *
 * 2026-09-17 字段排查 C07：项目详情只要 getNextTask 为空就显示
 * 「任务已全部完成」—— 零任务的项目（正是「待补信息」那张卡要抓的那类）
 * 在详情里看起来像是干完了。而同一个页面的列表那一栏早就分了三态，
 * 两处各写各的，详情那处是错的。
 *
 * 所以抽到这里：两边调同一个函数，想改口径只能改这里。
 */
export const noNextTaskReason = (tasks?: ReadonlyArray<{ status?: string }> | null): string => {
  const list = tasks || [];
  if (!list.length) return '尚未安排任务';
  if (list.some(t => String(t?.status || '') === 'Skipped')) return '无待办任务（含已跳过）';
  return '所有任务已完成';
};
