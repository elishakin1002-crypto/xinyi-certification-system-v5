
import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Customers from './pages/Customers';
import Contracts from './pages/Contracts';
import Projects from './pages/Projects';
import Finance from './pages/Finance';
import Knowledge from './pages/Knowledge';
import IntelRadar from './pages/IntelRadar';
import AICenter from './pages/AICenter';
import Strategy from './pages/Strategy';
import Audit from './pages/Audit';
import Login from './pages/Login';
import Employees from './pages/Employees';
import ChangePassword from './pages/ChangePassword';
import AuthAuditLogs from './pages/AuthAuditLogs';
import { AppProvider } from './context/AppContext';
import ProtectedRoute from './components/ProtectedRoute';
import { authService, AuthUser } from './services/authService';

const isEnabled = (raw: unknown) => ['1', 'true', 'yes', 'on'].includes(String(raw || '').trim().toLowerCase());
const envAuthRequired = isEnabled(import.meta.env.VITE_AUTH_REQUIRED);

const readDevAuthOverride = () => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return window.localStorage.getItem('xinyi_auth_required') === '1';
};

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white text-sm font-bold">
    正在校验登录状态...
  </div>
);

const App = () => {
  const [authRequired] = useState(() => envAuthRequired || readDevAuthOverride());
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(!authRequired);

  useEffect(() => {
    if (!authRequired) return;
    let cancelled = false;
    authService.me()
      .then(result => {
        if (!cancelled) setAuthUser(result?.user || null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => { cancelled = true; };
  }, []);

  /*
    从「前进/后退缓存」（bfcache）恢复时强制重新加载。

    这是退出登录之后最容易漏的一个口子：浏览器可能把整个页面
    **连同 React 内存状态一起**冻存起来，按后退键时原样恢复。
    那一刻不会发任何网络请求——服务端的 401 拦不住，
    上一个人的客户名单和合同金额直接还在屏幕上。

    办公室共用电脑的场景下这是真会发生的。event.persisted 为真
    就说明是从缓存恢复的，直接重载让整套鉴权重新跑一遍。
  */
  useEffect(() => {
    if (!authRequired) return;
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [authRequired]);

  if (!authChecked) return <LoadingScreen />;

  return (
    <AppProvider authenticatedUser={authUser} authRequired={authRequired}>
      <Router>
        {authRequired && !authUser ? (
          <Routes>
            <Route path="/login" element={<Login onLogin={setAuthUser} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        ) : authRequired && authUser?.mustChangePassword ? (
          <Routes>
            <Route path="/change-password" element={<ChangePassword user={authUser} onChanged={setAuthUser} />} />
            <Route path="*" element={<Navigate to="/change-password" replace />} />
          </Routes>
        ) : (
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/login" element={<Navigate to="/dashboard" replace />} />
              <Route path="/change-password" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              {/* 每个模块都必须有路由守卫：侧边栏隐藏入口挡不住直接输网址 */}
              <Route path="/leads" element={<ProtectedRoute permission="NAV_CRM"><Leads /></ProtectedRoute>} />
              <Route path="/customers" element={<ProtectedRoute permission="NAV_CRM"><Customers /></ProtectedRoute>} />
              <Route path="/contracts" element={<ProtectedRoute permission="NAV_CRM"><Contracts /></ProtectedRoute>} />
              <Route path="/projects" element={<ProtectedRoute permission="NAV_DELIVERY"><Projects /></ProtectedRoute>} />
              <Route path="/finance" element={<ProtectedRoute permission="NAV_FINANCE"><Finance /></ProtectedRoute>} />
              <Route path="/finance/settlements" element={<ProtectedRoute permission="NAV_FINANCE"><Finance /></ProtectedRoute>} />
              <Route path="/audit" element={<ProtectedRoute permission="NAV_AUDIT"><Audit /></ProtectedRoute>} />
              <Route path="/knowledge" element={<ProtectedRoute permission="NAV_KNOWLEDGE"><Knowledge /></ProtectedRoute>} />
              <Route path="/intel" element={<ProtectedRoute permission="NAV_INTEL"><IntelRadar /></ProtectedRoute>} />
              <Route path="/strategy" element={<ProtectedRoute permission="NAV_STRATEGY"><Strategy /></ProtectedRoute>} />
              <Route path="/ai-center" element={<ProtectedRoute permission="NAV_AI_CENTER"><AICenter /></ProtectedRoute>} />
              <Route path="/employees" element={<ProtectedRoute action="EMPLOYEE_VIEW"><Employees /></ProtectedRoute>} />
              <Route path="/auth-audit" element={<ProtectedRoute action="AUTH_AUDIT_VIEW"><AuthAuditLogs /></ProtectedRoute>} />
            </Routes>
          </Layout>
        )}
      </Router>
    </AppProvider>
  );
};

export default App;
