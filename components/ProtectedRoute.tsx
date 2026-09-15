import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ActionCode, PermissionCode } from '../types';

type Props = {
  /** 导航级权限（NAV_*），控制"能不能进这个模块" */
  permission?: PermissionCode;
  /** 动作级权限，用于员工账号、审计日志这类不按导航分组的页面 */
  action?: ActionCode;
  children: React.ReactElement;
};

/**
 * 路由守卫。
 * 侧边栏按权限隐藏入口只是"看不见"，直接输网址仍能进——必须在路由上再拦一次。
 *
 * ── 拦住之后要说一句话（2026-09-15 加）──────────────────────────
 *
 * Codex 巡检：顾问依次输入 `#/finance`、`#/intel`、`#/strategy`、
 * `#/ai-center`，每次都**静悄悄地回到工作台**，屏幕上一个字都没有。
 *
 * 拦是对的（权限没漏），但人完全判断不了发生了什么：
 * 是我地址打错了？是这个页面被删了？还是我没权限？
 * 三种情况对应三种完全不同的下一步，而系统一句都不说。
 *
 * 项目规矩：给用户的文案要说清后果和下一步。
 * 所以带上「被拦的是哪一页、为什么」，由 Layout 在落地页上显示一行。
 * 用 state 传而不是 query 参数：这条信息只对这一次跳转有意义，
 * 不该留在地址栏里，更不该被收藏或分享出去。
 */
const ProtectedRoute: React.FC<Props> = ({ permission, action, children }) => {
  const { hasPermission, checkActionPermission } = useApp();
  const location = useLocation();

  const deny = (reason: string) => (
    <Navigate
      to="/dashboard"
      replace
      state={{ accessDenied: { path: location.pathname, reason } }}
    />
  );

  if (permission && !hasPermission(permission)) {
    return deny('这个模块没有对你开放。如果工作需要，找系统管理员调整权限。');
  }
  if (action) {
    // 新建/查看类动作不带归属 context —— 空对象谁都不属于，会误判成"不是我的"
    const result = checkActionPermission(action, {});
    if (!result.allowed) {
      return deny(result.reason || '这个页面需要额外的权限。如果工作需要，找系统管理员开通。');
    }
  }
  return children;
};

export default ProtectedRoute;
