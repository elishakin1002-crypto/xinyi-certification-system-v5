import React from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PermissionCode } from '../types';

type Props = {
  permission: PermissionCode;
  children: React.ReactElement;
};

const ProtectedRoute: React.FC<Props> = ({ permission, children }) => {
  const { hasPermission } = useApp();
  if (!hasPermission(permission)) return <Navigate to="/dashboard" replace />;
  return children;
};

export default ProtectedRoute;

