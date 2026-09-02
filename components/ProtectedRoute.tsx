import React from 'react';
import { Navigate } from 'react-router-dom';
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
 */
const ProtectedRoute: React.FC<Props> = ({ permission, action, children }) => {
  const { hasPermission, checkActionPermission } = useApp();
  if (permission && !hasPermission(permission)) return <Navigate to="/dashboard" replace />;
  if (action && !checkActionPermission(action, {}).allowed) return <Navigate to="/dashboard" replace />;
  return children;
};

export default ProtectedRoute;
