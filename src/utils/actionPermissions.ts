import { ActionCode, RoleID, UserProfile } from '../../types';
import { ROLE_CAPABILITIES, SYS_ADMIN_MODE, SYS_ADMIN_LIMITED_ACTIONS, roleLabel } from '../../constants';

type PermissionContext = {
  manager?: string;
  owner?: string;
  tasks?: Array<{ owner?: string }>;
};

/** 财务只做财务动作，其余业务动作一律拒绝 */
const FINANCE_ALLOWED: ActionCode[] = ['PROJECT_VIEW', 'CONTRACT_VIEW_AMOUNT', 'PAYMENT_CONFIRM'];

/**
 * 解析某个角色实际拥有的动作。
 * 系统管理员在 limited 模式下收窄为「技术能力 + 业务只读」，full 模式下保持全权。
 */
export const resolveRoleActions = (role: RoleID): ActionCode[] => {
  const capability = ROLE_CAPABILITIES[role];
  if (!capability) return [];
  if (role === 'SYS_ADMIN' && SYS_ADMIN_MODE === 'limited') {
    return capability.actions.filter(action => SYS_ADMIN_LIMITED_ACTIONS.includes(action));
  }
  return capability.actions;
};

/**
 * 解析某个员工最终拥有的动作：角色默认 + 额外授予 - 显式撤销。
 * deniedActions 优先级最高，用于「这个人虽然是顾问，但不许他建合同」这类例外。
 */
export const resolveUserActions = (activeRole: RoleID, user: UserProfile): ActionCode[] => {
  const base = new Set<ActionCode>(resolveRoleActions(activeRole));
  (user.extraActions || []).forEach(action => base.add(action));
  (user.deniedActions || []).forEach(action => base.delete(action));
  return Array.from(base);
};

/** 账号是否已过有效期。accountExpiresAt 留空表示永久有效。 */
export const isAccountExpired = (user: Pick<UserProfile, 'accountExpiresAt'>, today = new Date()): boolean => {
  const expiry = String(user.accountExpiresAt || '').trim();
  if (!expiry) return false;
  return expiry < today.toISOString().slice(0, 10);
};

export const checkRoleActionPermission = (
  activeRole: RoleID,
  currentUser: UserProfile,
  action: ActionCode,
  context?: PermissionContext
): { allowed: boolean; reason?: string } => {
  const capability = ROLE_CAPABILITIES[activeRole];
  if (!capability) {
    return { allowed: false, reason: '未知身份，无法执行此动作，请联系管理员检查账号角色。' };
  }

  if (isAccountExpired(currentUser)) {
    return { allowed: false, reason: '账号已过有效期，请联系管理员续期。' };
  }

  // 显式撤销优先于一切
  if ((currentUser.deniedActions || []).includes(action)) {
    return { allowed: false, reason: '该动作已被管理员单独收回。' };
  }

  const allowedActions = resolveUserActions(activeRole, currentUser);
  if (!allowedActions.includes(action)) {
    return { allowed: false, reason: `当前身份（${roleLabel(activeRole)}）没有执行此动作的权限。` };
  }

  /*
    ── 空 context 不等于「不是我的」（2026-09-07 修）──────────────

    原来只判断 `context` 是不是真值。传 `{}` 进来时它是真值，
    于是去查归属，而空对象里当然没有归属信息 —— 判定「不是你的」，拒绝。

    结果是 **`{}` 和不传，行为完全相反**：
    checkActionPermission('PROJECT_CREATE')      → 放行
    checkActionPermission('PROJECT_CREATE', {})  → 拒绝

    我自己就踩了：项目页用 `{}` 判断要不要显示「新建项目」，
    整个按钮对顾问消失了，而权限表里明明有 PROJECT_CREATE。

    更要紧的是**新建类动作本来就没有「现有归属」**：
    还没建出来的东西，谈不上是谁的。拿归属去卡新建，逻辑上就不成立。

    所以现在只在 context **确实带了归属信息**时才检查。
  */
  const hasOwnershipInfo = Boolean(
    context && (context.manager !== undefined || context.owner !== undefined || context.tasks !== undefined)
  );
  if (capability.dataScope === 'OWN' && hasOwnershipInfo) {
    const isOwner = context!.manager === currentUser.name ||
      (context!.tasks || []).some(task => task.owner === currentUser.name) ||
      context!.owner === currentUser.name;

    if (!isOwner) {
      return { allowed: false, reason: '您只能操作自己负责的项目或任务。' };
    }
  }

  // 财务与销售的越界保护：额外授权也不能突破本岗位边界
  if (activeRole === 'FINANCE' && !FINANCE_ALLOWED.includes(action) && !(currentUser.extraActions || []).includes(action)) {
    return { allowed: false, reason: '财务角色无法执行非财务类操作。' };
  }
  if (activeRole === 'SALES' && /^(PROJECT_(CREATE|EDIT_INFO|ASSIGN_MANAGER)|TASK_)/.test(action)) {
    return { allowed: false, reason: '销售可查看交付进度，但不能修改项目与任务。' };
  }

  return { allowed: true };
};
