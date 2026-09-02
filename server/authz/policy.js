// 授权策略配置：AI 分级（L0–L4）与金额门槛。
//
// 口径由业务方 2026-08-20 确认，改这里等于改公司规矩，不要随手动。
//
// 设计约束：**只允许降级，不允许升级**。
// 配置写错最多是变得更严（拦住了本该放行的），不会意外放开权限。
// 反过来的设计（允许升级）一旦写错就是安全事故。

/** AI 能力分级 */
const AI_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];
const levelRank = (l) => AI_LEVELS.indexOf(l);
/** 取更严的那个（rank 小 = 更严） */
const stricter = (a, b) => (levelRank(a) <= levelRank(b) ? a : b);

/**
 * L0 清单：AI 完全不可见、不可调用。
 * 业务方原话：「凭证、工资提成、身份信息、权限变更和硬删除」。
 *
 * 注意客户经营数据**不在**这里——它按 AI 当前代表谁来定（最高 L1 只读），
 * 而不是一刀切禁止。AI 代表财务时能读，代表兼职时读不到。
 */
const L0_ACTIONS = new Set([
  'EMPLOYEE_UPDATE_ROLE', 'EMPLOYEE_DISABLE', 'EMPLOYEE_RESET_PASSWORD',
  'TASK_DELETE', 'PROJECT_DELETE', 'CONTRACT_DELETE',   // 硬删除
  'SETTLEMENT_MANAGE',                                   // 提成明细
]);

const L0_RESOURCE_TYPES = new Set([
  'voucher',      // 凭证：发票、付款凭证
  'payroll',      // 工资
  'identity',     // 身份证、银行卡
  'permission',   // 权限变更
]);

/**
 * 金额门槛（分）。业务方确认的三档：
 *   ≤ 1 万元      → L4 自主（以当前对话中的明确指令作为批准）
 *   1 万 – 5 万元 → L3 待确认
 *   > 5 万元      → L2 仅建议，不执行
 */
const AMOUNT_TIERS = [
  { maxFen: 1_000_000, level: 'L4', label: '1万元以内' },
  { maxFen: 5_000_000, level: 'L3', label: '1万至5万元' },
  { maxFen: Infinity, level: 'L2', label: '5万元以上' },
];

const amountLevel = (fen) => {
  const n = Number(fen || 0);
  return AMOUNT_TIERS.find((t) => n <= t.maxFen) || AMOUNT_TIERS[AMOUNT_TIERS.length - 1];
};

/** 动作的基线级别。没列出的按 L3（待确认）处理——**默认从严**。 */
const ACTION_BASE_LEVEL = {
  // 只读类
  PROJECT_VIEW: 'L1',
  CONTRACT_VIEW_AMOUNT: 'L1',
  SETTLEMENT_VIEW: 'L1',
  EMPLOYEE_VIEW: 'L1',
  AUTH_AUDIT_VIEW: 'L1',

  // 低风险写入，可自主
  KNOWLEDGE_WRITE: 'L4',
  REMINDER_WRITE: 'L4',
  LEAD_CREATE: 'L4',

  // 需要确认
  TASK_CREATE: 'L3',
  TASK_COMPLETE: 'L3',
  PROJECT_CREATE: 'L3',
  PROJECT_EDIT_INFO: 'L3',
  PROJECT_ASSIGN_MANAGER: 'L3',
  PROJECT_PAUSE: 'L3',
  CONTRACT_CREATE: 'L3',
  CUSTOMER_CREATE: 'L3',
  LEAD_CONVERT: 'L3',

  /*
    金额动作基线设 L4，由金额门槛往严收——不是反过来。
    业务方口径：1 万以内以对话中的明确指令为批准（=L4），1-5 万需确认（=L3），
    5 万以上只建议（=L2）。如果基线写 L3，「只降级」规则会把 1 万以内那档也压成 L3，
    等于把业务方明确说可以自主的那档也拦了。
  */
  PAYMENT_CONFIRM: 'L4',
};

/**
 * 判定一次 AI 操作的级别。
 * @returns { level, policy, reason }  policy 会写进 Ledger，回答「凭什么」
 */
const resolveAiLevel = ({ action, resource = {}, amountFen }) => {
  if (L0_ACTIONS.has(action)) {
    return { level: 'L0', policy: `ai.L0:action:${action}`, reason: 'AI 不得执行该动作（L0 清单）' };
  }
  if (L0_RESOURCE_TYPES.has(resource.type)) {
    return { level: 'L0', policy: `ai.L0:resource:${resource.type}`, reason: `AI 不得访问 ${resource.type} 类数据（L0 清单）` };
  }

  let level = ACTION_BASE_LEVEL[action] || 'L3';
  let policy = `ai.base:${action}=${level}`;
  let reason = '';

  // 金额门槛只会让级别更严
  const fen = amountFen ?? resource.amountFen;
  if (fen != null) {
    const tier = amountLevel(fen);
    const next = stricter(level, tier.level);
    if (next !== level) {
      level = next;
      policy = `ai.amount:${tier.label}=${tier.level}`;
      reason = `金额 ¥${(Number(fen) / 100).toLocaleString()}（${tier.label}）`;
    }
  }

  // 敏感资源最高只读
  if (resource.sensitivity === 'confidential') {
    const next = stricter(level, 'L1');
    if (next !== level) {
      level = next;
      policy = 'ai.sensitivity:confidential=L1';
      reason = '敏感数据，AI 最高只读';
    }
  }

  return { level, policy, reason };
};

module.exports = {
  AI_LEVELS, levelRank, stricter,
  L0_ACTIONS, L0_RESOURCE_TYPES, AMOUNT_TIERS,
  amountLevel, resolveAiLevel, ACTION_BASE_LEVEL,
};
