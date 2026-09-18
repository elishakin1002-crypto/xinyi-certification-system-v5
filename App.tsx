
import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import StateSyncNotice from './components/StateSyncNotice';
import CrashBoundary from './components/CrashBoundary';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Customers from './pages/Customers';
import Contracts from './pages/Contracts';
import Projects from './pages/Projects';
import MyTasks from './pages/MyTasks';
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
import Glossary from './pages/Glossary';
import LoginSessions from './components/LoginSessions';
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

/** 账号菜单点进来的「修改密码」。和首次登录强制改用的是同一个表单，只是壳不同 */
const SelfChangePassword: React.FC<{ user: AuthUser; onChanged: (u: AuthUser) => void }> = ({ user, onChanged }) => {
  const navigate = useNavigate();
  return (
    <ChangePassword
      user={user}
      onChanged={onChanged}
      variant="self"
      onDone={() => navigate('/dashboard')}
    />
  );
};

/*
  页面级崩溃边界。

  放在 Layout **里面**、Routes **外面**，位置是有讲究的：
  这样某一页塌了，左边导航和顶部还在，人可以直接点去别的模块，
  而不是整屏白掉只能刷新。

  key 用当前路由：不加的话，一页崩过之后边界会一直停在错误态，
  点到别的页面还是那张错误卡片，看起来像整个系统都坏了。
  换路由就换 key，等于换一个新的边界重新开始。
*/
const PageBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  return (
    <CrashBoundary key={location.pathname} area={location.pathname}>
      {children}
    </CrashBoundary>
  );
};

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
            <StateSyncNotice />
            <PageBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/login" element={<Navigate to="/dashboard" replace />} />
              {/*
                主动改密码。以前这里是 Navigate 到工作台 ——
                首次登录强制改完之后，这一页就再也进不去了，
                「我想自己换个密码」在全系统没有入口（2026-09-13 金恩来指出）。
                入口在右上角账号菜单里。
              */}
              <Route
                path="/change-password"
                element={authUser
                  ? <SelfChangePassword user={authUser} onChanged={setAuthUser} />
                  : <Navigate to="/dashboard" replace />}
              />
              <Route path="/dashboard" element={<Dashboard />} />
              {/* 每个模块都必须有路由守卫：侧边栏隐藏入口挡不住直接输网址 */}
              <Route path="/leads" element={<ProtectedRoute permission="NAV_CRM"><Leads /></ProtectedRoute>} />
              <Route path="/customers" element={<ProtectedRoute permission="NAV_CRM"><Customers /></ProtectedRoute>} />
              <Route path="/contracts" element={<ProtectedRoute permission="NAV_CRM"><Contracts /></ProtectedRoute>} />
              <Route path="/my-tasks" element={<ProtectedRoute permission="NAV_DELIVERY"><MyTasks /></ProtectedRoute>} />
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
              {/* 自己的登录设备，人人可看，不需要任何额外权限 —— 看的是自己 */}
              <Route path="/my-devices" element={<div className="p-4 md:p-6 max-w-3xl mx-auto"><LoginSessions /></div>} />
              {/*
                字段档案对六个角色**全部开放** —— 每个人都该能查"这个数字数的是什么"。
                它不含任何业务数据，只有口径说明（内容从代码常量生成，
                见 src/modules/help/fieldDictionary.ts）。

                但「谁都能看」要**显式写出来**，不能靠不写守卫来表达：
                没有守卫的路由，和「忘了加守卫」长得一模一样，
                下一个人无法分辨哪个是故意的（CLAUDE.md 二点五之一）。
                2026-09-18 权限体检就是这么报的：「/glossary 直接输网址即可进入」。

                NAV_KNOWLEDGE 六个角色都有，语义也对得上（同属参考资料）。
                顺带把「必须先登录」也补上了 —— 原来没守卫时，
                没登录的人也能打开这一页。
              */}
              <Route path="/glossary" element={<ProtectedRoute permission="NAV_KNOWLEDGE"><Glossary /></ProtectedRoute>} />
            </Routes>
            </PageBoundary>
          </Layout>
        )}
      </Router>
    </AppProvider>
  );
};

export default App;
