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

  if (capability.dataScope === 'OWN' && context) {
    const isOwner = context.manager === currentUser.name ||
      (context.tasks || []).some(task => task.owner === currentUser.name) ||
      context.owner === currentUser.name;

    if (!isOwner) {
      return { allowed: false, reason: '您只能操作自己负责的项目或任务。' };
    }
  }

  // 财务与销售的越界保护：额外授权也不能突破本岗位边界
  if (activeRole === 'FINANCE' && !FINANCE_ALLOWED.includes(action) && !(currentUser.extraActions || []).includes(action)) {
    return { allowed: false, reason: '财务角色无法执行非财务类操作。' };
  }
  if (activeRole === 'SALES' && /^(PROJECT_(CREATE|EDIT_INFO|ASSIGN_MANAGER|PAUSE)|TASK_)/.test(action)) {
    return { allowed: false, reason: '销售可查看交付进度，但不能修改项目与任务。' };
  }

  return { allowed: true };
};
