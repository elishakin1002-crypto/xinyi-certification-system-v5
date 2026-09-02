// 资源级服务端授权：Identity + Resource/Scope + Action + Condition
//
// 为什么必须有这个：改之前服务端**没有任何授权边界**。
// 30 个写接口 0 处校验；读接口的归属过滤来自 `req.query.owner`——
// 改一下 URL 参数就能看全部数据。前端那套完整的权限矩阵只是**界面显示逻辑**，
// 不是安全边界。AI Agent 直连 API 会把它整个绕过去。
//
// 规则来源：直接解析 constants.ts 的 ROLE_CAPABILITIES，**不另建一套**。
// 两套规则必然漂移，漂移之后前端显示能做、服务端说不行，或者反过来（更糟）。
const fs = require('fs');
const path = require('path');
const { resolveAiLevel, levelRank } = require('./policy');

// ── 读取前端权限矩阵（单一事实来源）──
let CAPS = null;
const loadCapabilities = () => {
  if (CAPS) return CAPS;
  const src = fs.readFileSync(path.resolve(__dirname, '../../constants.ts'), 'utf8');
  const block = src.match(/export const ROLE_CAPABILITIES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('解析 ROLE_CAPABILITIES 失败——constants.ts 结构变了');

  CAPS = {};
  const roleRe = /\b([A-Z_]+):\s*\{([\s\S]*?)\n\s{2}\}/g;
  let m;
  while ((m = roleRe.exec(block[1]))) {
    const [, role, body] = m;
    const actions = [...(body.match(/actions:\s*\[([\s\S]*?)\]/)?.[1] || '')
      .matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    const pick = (k) => body.match(new RegExp(`${k}:\\s*'(\\w+)'`))?.[1];
    const num = (k) => { const v = body.match(new RegExp(`${k}:\\s*(\\d+)`))?.[1]; return v ? Number(v) : undefined; };
    CAPS[role] = {
      actions: new Set(actions),
      // readScope/writeScope 拆分后，dataScope 只作为兜底
      readScope: pick('readScope') || pick('dataScope') || 'NONE',
      writeScope: pick('writeScope') || pick('dataScope') || 'NONE',
      maxAmountFen: num('maxAmountFen'),
    };
  }
  return CAPS;
};

/** 测试或热更时清缓存 */
const resetCapabilities = () => { CAPS = null; };

const rolesOf = (user) => {
  const raw = Array.isArray(user?.roles) ? user.roles : (user?.activeRole ? [user.activeRole] : []);
  return raw.map((r) => String(r || '').trim().toUpperCase()).filter(Boolean);
};

const SCOPE_RANK = { NONE: 0, OWN: 1, DEPARTMENT: 2, ALL: 3 };
/** 多角色取最宽的范围 */
const widest = (a, b) => (SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b);

/** 该用户在读/写方向上的数据范围 */
const resolveScope = (user, direction = 'read') => {
  const caps = loadCapabilities();
  const key = direction === 'write' ? 'writeScope' : 'readScope';
  let scope = 'NONE';
  for (const r of rolesOf(user)) {
    const c = caps[r];
    if (c) scope = widest(scope, c[key]);
  }
  return scope;
};

/** 用户拥有的全部动作（角色动作 + extraActions − deniedActions） */
const resolveActions = (user) => {
  const caps = loadCapabilities();
  const set = new Set();
  for (const r of rolesOf(user)) for (const a of (caps[r]?.actions || [])) set.add(a);
  for (const a of (user?.extraActions || [])) set.add(a);
  for (const a of (user?.deniedActions || [])) set.delete(a);
  return set;
};

/**
 * 无主数据怎么办。业务方 2026-08-21 定：**线索用认领，合同和项目用指派**。
 *
 *   CLAIMABLE（认领）：无主时谁改谁认领，写入的瞬间归到操作人名下。
 *     线索走这条——455 条无主线索靠人工一条条指派不现实，
 *     让归属在日常跟进中自然长出来，比先做一轮大指派现实得多。
 *
 *   ASSIGNED（指派）：无主时**任何人都不能改**，必须先由管理者显式指定负责人。
 *     合同和项目走这条——牵扯金额和交付责任，认领等于自己给自己派活。
 *
 * customer 归到 CLAIMABLE 是我按「客户由线索转化而来、同属销售侧」推的，
 * 业务方没明确说过。要改就改这一行。
 */
const OWNERSHIP_POLICY = {
  lead: 'CLAIMABLE',
  customer: 'CLAIMABLE',
  contract: 'ASSIGNED',
  project: 'ASSIGNED',
};
/** 没登记的资源类型按 ASSIGNED 处理——默认从严，不能让新类型自动变成谁都能改 */
const ownershipPolicyOf = (type) => OWNERSHIP_POLICY[String(type || '')] || 'ASSIGNED';

/** 认领某类资源需要的动作码。没有对应动作码 = 该类型不支持认领 */
const CLAIM_ACTION = { lead: 'LEAD_CLAIM', customer: 'CUSTOMER_EDIT' };
const claimActionFor = (type) => CLAIM_ACTION[String(type || '')] || '__NO_CLAIM__';

/** 这条记录有没有主 */
const isUnowned = (resource = {}) => !resource.ownerUserId
  && !resource.manager
  && !(Array.isArray(resource.participantUserIds) && resource.participantUserIds.length)
  && !(Array.isArray(resource.participantNames) && resource.participantNames.length);

/**
 * 资源是否落在 scope 内。
 *
 * OWN 的判定刻意用**三条件**（负责人 / 服务项负责人 / 有任务分配），
 * 与前端 `isMineProject` 保持一致——只看 ownerUserId 会漏掉多顾问协作的项目，
 * 这个口径之前踩过坑：咨询师参与了项目却被判定为「不是我的」。
 */
const inScope = (scope, user, resource = {}) => {
  if (scope === 'ALL') return true;
  if (scope === 'NONE') return false;
  const uid = String(user?.id || '');
  const uname = String(user?.name || '');
  if (!uid && !uname) return false;

  if (scope === 'OWN') {
    if (resource.ownerUserId && String(resource.ownerUserId) === uid) return true;
    if (resource.manager && String(resource.manager) === uname) return true;
    if (Array.isArray(resource.participantUserIds) && resource.participantUserIds.map(String).includes(uid)) return true;
    if (Array.isArray(resource.participantNames) && resource.participantNames.map(String).includes(uname)) return true;
    return false;
  }
  // DEPARTMENT 暂按 OWN 处理：组织上还没有部门划分（见待办 P0-20）。
  // 宁可先严——放宽了再收回来，人已经看过不该看的东西了。
  if (scope === 'DEPARTMENT') {
    return inScope('OWN', user, resource);
  }
  return false;
};

/**
 * 读操作白名单。**不在这个表里的一律按写操作处理。**
 *
 * 原来是用后缀正则判方向（/_EDIT|_CREATE|_ASSIGN.../），2026-08-21 发现它漏得很厉害：
 * 后缀不匹配的动作会被静默当成「读」，而所有角色 readScope 都是 ALL，
 * 等于归属限制完全失效。当时漏掉的是这些——
 *   EMPLOYEE_UPDATE_ROLE（改角色）、EMPLOYEE_RESET_PASSWORD（重置密码）、
 *   WORKLOG_DELETE_ANY（删别人日志）、PROJECT_EDIT_INFO、PROJECT_ASSIGN_MANAGER
 * ——恰好是系统里最危险的那几个。
 *
 * 改成白名单后方向判断是**故障安全**的：新加动作码忘了登记，
 * 后果是被当成写操作（更严，顶多拦错），而不是被当成读操作（更松，直接漏权）。
 * 加新的只读动作时才需要动这个表。
 */
const READ_ACTIONS = new Set([
  'PROJECT_VIEW',
  'CONTRACT_VIEW_AMOUNT',
  'SETTLEMENT_VIEW',
  'EMPLOYEE_VIEW',
  'AUTH_AUDIT_VIEW',
  'PROJECT_AI_DIAGNOSE',   // 只跑分析出报告，不改数据
]);
const isWriteAction = (action) => !READ_ACTIONS.has(String(action || ''));

/**
 * 新建类动作：执行时目标资源**还不存在**，因此不适用归属和范围判定。
 *
 * 注意 TASK_CREATE 不在这里——它是在一个**已经存在**的项目里加任务，
 * 那个项目的归属必须管住（否则顾问能往别人的项目里塞任务）。
 * 判断标准是「这个动作的目标资源此刻存不存在」，不是名字里有没有 CREATE。
 */
const CREATE_ACTIONS = new Set([
  'LEAD_CREATE', 'CUSTOMER_CREATE', 'CONTRACT_CREATE', 'PROJECT_CREATE',
  'EMPLOYEE_CREATE', 'KNOWLEDGE_WRITE', 'REMINDER_WRITE',
]);

/**
 * 授权判定。**先拒后允**，任一步拒绝即终止。
 *
 * @returns {{ allow:boolean, policy:string, reason:string, aiLevel?:string, requiresApproval?:boolean }}
 *   policy 一定要写进 Ledger——没有它，账本只能说「做了什么」，说不出「凭什么允许」。
 */
const authorize = ({ user, action, resource = {}, amountFen, viaAiAgent = false, creating = false }) => {
  const deny = (policy, reason) => ({ allow: false, policy, reason });

  // ① 账号状态
  if (!user || !user.id) return deny('identity.anonymous', '未识别身份');
  if (user.status && user.status !== 'active') return deny('identity.inactive', `账号状态为 ${user.status}`);
  if (user.accountExpiresAt && new Date(user.accountExpiresAt) < new Date()) {
    return deny('identity.expired', `账号已于 ${String(user.accountExpiresAt).slice(0, 10)} 到期`);
  }

  // ② 显式拒绝优先级最高
  if (Array.isArray(user.deniedActions) && user.deniedActions.includes(action)) {
    return deny(`denied_actions:${action}`, '该动作已被显式禁止');
  }

  // ③ 动作码
  if (!resolveActions(user).has(action)) {
    return deny(`action:${action}`, `当前身份没有 ${action} 权限`);
  }

  // ④ 数据范围
  const direction = isWriteAction(action) ? 'write' : 'read';
  const scope = resolveScope(user, direction);

  /*
    ── 新建操作不走归属判定 ──────────────────────────────────────
    「建合同」时合同还不存在，没有负责人也没法有负责人。
    2026-08-22 的 enforce 演练里，销售建合同被拦下并提示
    「这条数据还没有指派负责人，请先由管理者指派」——指派一个还没建出来的合同，
    这话本身就不成立。同理新建时也不该走 inScope（无主资源永远不落在 OWN 范围里）。

    判据是**资源是否已存在**，不是动作名：
      CONTRACT_CREATE + 空资源      → 新建合同，跳过归属
      TASK_CREATE   + 已有的项目资源 → 在别人的项目里加任务，归属必须管
    所以 TASK_CREATE 不在新建清单里——它操作的是一个已经存在的项目。

    另一半是**故障安全**：不在新建清单里、却拿不到资源 id，
    说明路由的 resource 解析器没把记录捞出来（batch2/batch3 都犯过这个错），
    这时必须拒绝并明确报出来，不能默默放行——默默放行等于归属判定形同虚设。
  */
  const isCreation = creating || CREATE_ACTIONS.has(action);
  if (!isCreation && !resource.id) {
    return deny(`config.missing_resource:${action}`,
      '服务端配置问题：授权判定拿不到目标记录（路由的 resource 解析器没加载记录）');
  }

  if (!isCreation && scope !== 'ALL' && isUnowned(resource)) {
    const op = ownershipPolicyOf(resource.type);
    if (direction === 'write' && op === 'CLAIMABLE' && resolveActions(user).has(claimActionFor(resource.type))) {
      // 允许写，并告诉调用方这次写入要顺带认领
      return {
        allow: true,
        policy: `ownership.claim:${resource.type}`,
        reason: '无主数据，本次写入将认领到当前用户名下',
        claimsOwnership: true,
      };
    }
    if (direction === 'write') {
      return deny(`ownership.unassigned:${resource.type}`,
        op === 'CLAIMABLE'
          ? '这条数据还没有负责人，你没有认领权限'
          : '这条数据还没有指派负责人，请先由管理者指派');
    }
  }

  if (!isCreation && !inScope(scope, user, resource)) {
    return deny(`scope:${direction}=${scope}`,
      direction === 'write' ? '只能修改自己负责的数据' : '超出可见数据范围');
  }

  // ⑤ 金额上限（角色级）
  const caps = loadCapabilities();
  const fen = amountFen ?? resource.amountFen;
  if (fen != null) {
    for (const r of rolesOf(user)) {
      const cap = caps[r]?.maxAmountFen;
      if (cap != null && Number(fen) > cap) {
        return deny(`amount_cap:${r}=${cap}`,
          `金额 ¥${(Number(fen) / 100).toLocaleString()} 超过该角色上限 ¥${(cap / 100).toLocaleString()}`);
      }
    }
  }

  // ⑥ AI 分级（只对 AI 代理生效；人直接操作不受此限）
  if (viaAiAgent) {
    const ai = resolveAiLevel({ action, resource, amountFen: fen });
    if (ai.level === 'L0') return { allow: false, policy: ai.policy, reason: ai.reason, aiLevel: 'L0' };
    if (ai.level === 'L1' && direction === 'write') {
      return { allow: false, policy: ai.policy, reason: 'AI 对该资源只有只读权限', aiLevel: 'L1' };
    }
    if (ai.level === 'L2') {
      return { allow: false, policy: ai.policy, reason: `${ai.reason || ''}｜AI 仅可给出建议，不执行`.replace(/^｜/, ''), aiLevel: 'L2' };
    }
    // L3：允许但必须先进提案队列等人确认
    if (ai.level === 'L3') {
      return { allow: true, policy: ai.policy, reason: ai.reason || '需人工确认后执行', aiLevel: 'L3', requiresApproval: true };
    }
    // L1 读 / L4 写：允许，但必须留痕。
    // 这里要回填 ai.level 而不是写死 'L4'——写死会把只读操作也标成自主执行，
    // Ledger 里就分不清「AI 只是看了一眼」和「AI 自己改了东西」。
    return { allow: true, policy: ai.policy, reason: ai.reason || 'AI 可执行', aiLevel: ai.level, requiresApproval: false };
  }

  return { allow: true, policy: `allow:${action}@${direction}=${scope}`, reason: '' };
};

module.exports = {
  authorize, resolveScope, resolveActions, inScope,
  loadCapabilities, resetCapabilities, isWriteAction, rolesOf,
  isUnowned, ownershipPolicyOf, claimActionFor, OWNERSHIP_POLICY, READ_ACTIONS, CREATE_ACTIONS,
};
