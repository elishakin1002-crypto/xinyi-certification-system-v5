
import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import AIChatWidget from './AIChatWidget';
import FeedbackModal from './FeedbackModal';
import { Menu, Bell, User, Search, ShieldCheck, ChevronDown, Users, Settings, LogOut, Eye, MessageSquare } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { authService } from '../services/authService';
import { dataService } from '../services/dataService';
import { useLocation, useNavigate } from 'react-router-dom';
import { SYSTEM_ROLES } from '../constants';
import { DashboardPersona, RoleID, AggregatedReminder } from '../types';
import {
  buildGlobalSearchGroups,
  buildGlobalSearchHits,
  readGlobalSearchQuery,
  resolveSearchScopesByPermissions,
  resolveGlobalSearchTarget
} from '../src/modules/global_search';

interface LayoutProps {
  children: React.ReactNode;
}

type ViewOption = {
  key: string;
  mode: 'role' | 'persona';
  roleId: RoleID | null;
  persona: DashboardPersona;
  label: string;
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  /*
    退出登录。2026-08-24 之前**全应用没有任何退出入口**——
    services/authService.ts 里 logout() 早就写好了，但没有一处调用。
    同事上机测试时登进去就出不来，共用电脑更换不了账号。

    退出后强制整页刷新，不用 React 路由跳转：
    退出要清掉的不只是会话 cookie，还有内存里的全部业务数据
    （线索、合同、当前用户…）。只跳路由的话，下一个登录的人
    会在页面上短暂看到上一个人的数据——在按角色分权的系统里这是事故。
  */
  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await authService.logout();
    } catch (error) {
      console.warn('[logout] 服务端退出失败，仍然清理本地会话', error);
    } finally {
      /*
        清掉 AI 对话历史。**reload 清不掉它**——它在 localStorage 里，
        重载、关标签页、关浏览器都活着。

        2026-08-31 查出来的漏：老板问完提成和报价的事退出，
        顾问在同一台办公室电脑登录、打开 AI 对话框，
        **老板刚才那整段对话原样还在那里**。
        服务端的鉴权对这个完全无能为力——那些字早就在这台机器上了。
      */
      try {
        dataService.remove('chat_history');
      } catch { /* 清不掉也要继续退出，不能卡在这一步 */ }

      /*
        用 replace 而不是 href=，**不能在历史里留下记录**。

        href= 会往浏览历史里推一条，退出后按浏览器「后退」就回到了 #/dashboard。
        虽然那时 authUser 已经是空、页面会渲染登录页，但历史里躺着一串
        业务页面地址本身就没必要——别人在这台电脑上翻后退，
        至少能看出这个人平时在看哪些模块。

        reload 仍然要：它清掉进程内存里的业务数据（客户、合同、金额）。
        单纯换路由不会清，那些数据还在 React 状态里。
      */
      window.location.replace(`${window.location.pathname}#/login`);
      window.location.reload();
    }
  };
  const [globalQuery, setGlobalQuery] = useState('');
  const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);
  const [isGlobalResultPanelOpen, setIsGlobalResultPanelOpen] = useState(false);
  const {
    currentUser,
    userProfiles,
    isAuthRequired,
    switchUser,
    setActiveRole,
    activePersona,
    availablePersonas,
    resolveDashboardPersona,
    visibleReminders,
    aggregatedReminders,
    markRemindersRead,
    markAllRemindersRead,
    leads,
    customers,
    contracts,
    projects,
    knowledgeDocs,
    userPermissions
  } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const roleToPersona: Record<RoleID, DashboardPersona> = {
    ADMIN: 'boss',
    /*
      2026-09-02：系统管理员不再看总经理工作台。

      原来映射到 'boss'，于是头像下面写着「老板」——
      而这个账号是技术负责人，不是老板；他要看的也不是这个月签了几单，
      是服务健不健康、AI 花了多少钱、有没有异常登录。
    */
    SYS_ADMIN: 'sysadmin',
    /*
      总助看总经理工作台，不看销售工作台。

      改名前 MANAGER 被映射到 'sales'，于是总助打开系统看到的是
      「我的线索 / 我的合同 / 个人转化率」——他不拥有线索，这些数永远是 0。
      他真正要盯的是总经理工作台下半部分的「团队产能与执行」：
      人均在制项目数、项目延误率、本周日志覆盖率。

      总经理工作台上的内容都在总助的读权限内（readScope=ALL，且有 CONTRACT_VIEW_AMOUNT），
      不存在越权显示。他仍然不能确认到账、不能碰结算——那是动作权限管的，与看板无关。
    */
    MANAGER: 'boss',
    SALES: 'sales',
    CONSULTANT: 'consultant',
    FINANCE: 'finance'
  };
  /*
    视角显示名。这里是**看板视角**的名字，不是角色名——
    五个看板（总经理/销售/顾问/财务/系统管理员）和六个角色不是一一对应
    （总助看总经理看板）。所以它不能直接取 SYSTEM_ROLES，是独立的一组标签。
  */
  const personaDisplayName: Record<DashboardPersona, string> = {
    // 键名 boss 保留（写在 URL / localStorage / current_role 里，改了旧值全失效），
    // 只改显示名：公司里这个角色的正式称呼是总经理，不是老板。
    boss: '总经理',
    sales: '销售',
    consultant: '咨询顾问',
    finance: '财务',
    sysadmin: '系统管理员'
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return '工作台';
    if (path === '/leads') return '线索管理';
    if (path === '/projects') return '项目管理';
    if (path === '/finance') return '财务回款';
    if (path === '/employees') return '员工账号';
    if (path === '/auth-audit') return '审计日志';
    return '信义系统';
  };

  const unreadReminders = visibleReminders.filter(r => !r.isRead);
  const queryPersona = useMemo(() => new URLSearchParams(location.search).get('persona'), [location.search]);
  const currentViewPersona = resolveDashboardPersona(queryPersona || activePersona);
  const normalizeDisplayLabel = (value: string) => String(value || '').replace(/\s*[（(]\s*示例\s*[)）]\s*/g, '').trim();
  /*
    2026-08-24 移除了「把 交付负责人 显示成 销售」的改名。

    那个改名让界面上的「销售」实际指向 MANAGER 角色，
    而两者权限差得很远：MANAGER 不能建线索、不能认领线索，
    却能删任务、删别人的工作日志，写范围也是部门级而非仅自己。
    同事按名字选角色，选到的是完全不同的一套权限。

    该角色已在 constants.ts 里正名为「总助」，界面直接用真名，不再翻译。
  */
  const formatIdentityDisplayName = (value: string) =>
    normalizeDisplayLabel(value).replace(/台账指导兼职/g, '台账指导').replace(/兼职/g, '');
  const formatViewDisplayName = (value: string) => normalizeDisplayLabel(value);
  const hasLedgerGuideTag = (tags?: string[]) => (tags || []).some(tag => String(tag).includes('台账指导'));
  const currentUserDisplayName = formatIdentityDisplayName(currentUser.name) || currentUser.name;
  const currentRoleDisplayName = personaDisplayName[currentViewPersona] || '总经理';
  const availableRoles = SYSTEM_ROLES.filter(r => currentUser.roles.includes(r.id));
  const isFinanceOnlyIdentity = currentUser.roles.length === 1 && currentUser.roles[0] === 'FINANCE';

  /*
    视角切换只给总经理和系统管理员。

    ── 为什么不给其他人 ──────────────────────────────────────────
    原来的判断是 viewOptions.length > 1，于是一个只有「咨询顾问」角色的同事
    也会看到这个菜单 —— 因为系统给他补了一项「销售（仅看板）」，凑够了两项。

    问题不是他能看到销售看板（那本来就不改权限），
    问题是**这个控件长得像"切换身份"**：菜单叫「切换视角」，选项前面是眼睛图标，
    选完顶部还写「当前视角：销售」。一个顾问点进去，会以为自己能变成销售，
    或者以为公司给了他更大的权限。等他发现点了没用，第一反应是"系统坏了"。

    ── 为什么总经理和系统管理员留着 ────────────────────────────────
    他们要能看到各个角色分别看到什么、有哪些功能，才好判断权限配得对不对。
    这是**巡检工具**，不是身份切换 —— 权限始终按账号本身的角色判定，
    服务端 enforce 模式下切视角也拿不到多余的数据。
  */
  const VIEW_SWITCH_ROLES = ['ADMIN', 'SYS_ADMIN'];
  const canSwitchView = currentUser.roles.some(role => VIEW_SWITCH_ROLES.includes(role));

  const viewOptions = useMemo(() => {
    const base: ViewOption[] = availableRoles.map(role => ({
      key: `role-${role.id}`,
      mode: 'role' as const,
      roleId: role.id,
      persona: roleToPersona[role.id],
      label: formatViewDisplayName(role.name)
    }));

    if (canSwitchView) {
      /*
        巡检账号要能看**全部工作台**，不只是自己拥有的角色。

        系统管理员账号只有 SYS_ADMIN 一个角色，只按 availableRoles 生成的话
        就只有一项，菜单直接不显示 —— 而这个账号恰恰是最需要
        「总经理看到的是什么样、顾问看到的是什么样」的那个。

        没有对应角色的用 persona 模式，只换工作台不动权限，标注「仅看板」。
        标注很重要：不写的话会以为是"以顾问身份预览"，
        而实际上权限一点没变，看到的数据还是自己那份。
      */
      const covered = new Set(base.map(item => item.persona));
      (Object.keys(personaDisplayName) as DashboardPersona[]).forEach(persona => {
        if (covered.has(persona)) return;
        base.push({
          key: `persona-${persona}`,
          mode: 'persona' as const,
          roleId: null,
          persona,
          label: `${personaDisplayName[persona]}（仅看板）`
        });
      });
      return base;
    }

    const hasSales = base.some(item => item.persona === 'sales');
    if (!isFinanceOnlyIdentity && !hasSales && availablePersonas.includes('sales')) {
      base.push({
        key: 'persona-sales',
        mode: 'persona' as const,
        roleId: null,
        persona: 'sales',
        // 你的账号没有「销售」这个角色，所以这一项只切工作台看板，不改权限。
        // 标注出来避免误以为是"以销售身份预览"。
        label: '销售（仅看板）'
      });
    }
    return base;
  }, [availableRoles, roleToPersona, isFinanceOnlyIdentity, availablePersonas, canSwitchView]);
  const sortedUsers = [...userProfiles].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const canSwitchCurrentUser = !isAuthRequired;
  const searchableScopes = useMemo(() => resolveSearchScopesByPermissions(userPermissions), [userPermissions]);
  const globalHits = useMemo(
    () => buildGlobalSearchHits(globalQuery, { leads, customers, contracts, projects, knowledgeDocs }, { includeScopes: searchableScopes }),
    [globalQuery, leads, customers, contracts, projects, knowledgeDocs, searchableScopes]
  );
  const globalGroups = useMemo(
    () => buildGlobalSearchGroups(globalQuery, { leads, customers, contracts, projects, knowledgeDocs }, { includeScopes: searchableScopes, maxPerScope: 2 }),
    [globalQuery, leads, customers, contracts, projects, knowledgeDocs, searchableScopes]
  );
  const groupedHitScopes = useMemo(() => globalGroups.filter(group => group.count > 0), [globalGroups]);
  const topGlobalHit = globalHits[0];
  const globalHitSummary = useMemo(() => globalHits.filter(item => item.count > 0).slice(0, 3).map(item => `${item.label} ${item.count}`).join(' · '), [globalHits]);
  const shouldShowGlobalResultPanel = Boolean(globalQuery.trim()) && (isGlobalSearchFocused || isGlobalResultPanelOpen);

  useEffect(() => {
    setGlobalQuery(readGlobalSearchQuery(location.search));
    setIsGlobalResultPanelOpen(false);
  }, [location.search]);

  const handleGlobalSearchSubmit = () => {
    const q = globalQuery.trim();
    if (!q) return;
    if (groupedHitScopes.length > 1) {
      setIsGlobalResultPanelOpen(true);
      return;
    }
    const target = resolveGlobalSearchTarget(q, { leads, customers, contracts, projects, knowledgeDocs }, location.pathname, { includeScopes: searchableScopes });
    const params = new URLSearchParams();
    params.set('q', q);
    navigate(`${target.route}?${params.toString()}`);
    setIsGlobalResultPanelOpen(false);
  };

  const handleOpenScopeResult = (route: string) => {
    const q = globalQuery.trim();
    if (!q) return;
    const params = new URLSearchParams();
    params.set('q', q);
    navigate(`${route}?${params.toString()}`);
    setIsGlobalResultPanelOpen(false);
    setIsGlobalSearchFocused(false);
  };

  const updatePersonaQuery = (persona?: DashboardPersona | null) => {
    const params = new URLSearchParams(location.search);
    if (persona) params.set('persona', persona);
    else params.delete('persona');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' });
  };

  /*
    提醒面板。

    ── 为什么是下拉面板，不是跳页面 ──────────────────────────────
    提醒的本质是「打断」：人正在录合同的时候瞄一眼红点。
    跳走会丢掉手上的活，看完还得自己找回来 ——
    结果就是大家索性不点它，红点变成永久装饰。

    ── 为什么按对象聚合，不按条罗列 ──────────────────────────────
    线上现在 226 条提醒。同一个项目可能挂着 5 条（逾期、缺日志、待验收……），
    一条条列出来 24 行刷屏，而人真正要决定的是「先处理哪个项目」。
    aggregatedReminders 已经按 linkType:linkId 聚好了，直接用。

    ── 为什么点进去自动标已读 ────────────────────────────────────
    再要求点一次「标为已读」，等于让人为了消掉红点做一件与业务无关的事。
    人不会做，红点就永远消不掉，然后整个提醒机制失效。
  */
  /*
    面板里显示的分组：未读优先，其次按严重度，最后按时间。
    截到 12 组 —— 再多人也不会往下翻，而且滚动条越长越像"这事我处理不完"，
    反而让人干脆不点。要看全部走底部那个入口。
  */
  const bellGroups = useMemo(() => {
    const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return [...aggregatedReminders]
      .sort((a, b) => {
        const aUnread = a.samples.some(s => !s.isRead) ? 1 : 0;
        const bUnread = b.samples.some(s => !s.isRead) ? 1 : 0;
        if (aUnread !== bUnread) return bUnread - aUnread;
        const sev = (rank[b.severity] || 0) - (rank[a.severity] || 0);
        if (sev !== 0) return sev;
        return String(b.latestDate || '').localeCompare(String(a.latestDate || ''));
      })
      .slice(0, 12);
  }, [aggregatedReminders]);

  const severityStyle: Record<string, { dot: string; text: string; label: string }> = {
    high: { dot: 'bg-red-500', text: 'text-red-600', label: '紧急' },
    medium: { dot: 'bg-amber-500', text: 'text-amber-600', label: '关注' },
    low: { dot: 'bg-gray-300', text: 'text-gray-400', label: '一般' }
  };

  const linkTypeRoute: Record<string, string> = {
    lead: '/leads',
    customer: '/customers',
    contract: '/contracts',
    project: '/projects',
    audit: '/audit',
    intel: '/intel'
  };

  const handleOpenReminderGroup = (group: AggregatedReminder) => {
    markRemindersRead(group.samples.map(s => s.id));
    setIsBellOpen(false);
    const route = linkTypeRoute[group.linkType];
    if (!route) return;
    // 带上 id，目标页面可以据此高亮/滚动到那一条
    navigate(`${route}?focus=${encodeURIComponent(group.linkId)}`);
  };

  const renderBellPanel = () => (
    <>
      {/* 点空白处关闭。没有这层，面板只能靠再点一次铃铛关掉 */}
      <div className="fixed inset-0 z-40" onClick={() => setIsBellOpen(false)} />
      <div className="absolute top-full right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <div>
            <p className="text-sm font-bold text-gray-900">待办提醒</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {unreadReminders.length > 0 ? `${unreadReminders.length} 条未读` : '没有未读提醒'}
            </p>
          </div>
          {unreadReminders.length > 0 && (
            <button
              type="button"
              onClick={() => markAllRemindersRead()}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1"
            >
              全部标为已读
            </button>
          )}
        </div>

        <div className="max-h-[24rem] overflow-y-auto">
          {bellGroups.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-bold text-gray-400">暂时没有需要你处理的事</p>
              <p className="text-[11px] text-gray-300 mt-1">有逾期、待验收或风险时会出现在这里</p>
            </div>
          ) : bellGroups.map(group => {
            const style = severityStyle[group.severity] || severityStyle.low;
            const unread = group.samples.filter(s => !s.isRead).length;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => handleOpenReminderGroup(group)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors ${unread > 0 ? '' : 'opacity-55'}`}
              >
                <div className="flex items-start gap-2.5">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {group.projectName || group.customerName || group.mainScene}
                      </p>
                      <span className="text-[10px] text-gray-400 shrink-0">{group.latestDate}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{group.mainScene}</p>
                    {group.count > 1 && (
                      <p className={`text-[10px] mt-1 font-bold ${style.text}`}>
                        {/* 同一个对象上挂着好几条时才提示条数，否则「共 1 项」是噪音 */}
                        {style.label} · 共 {group.count} 项{unread > 0 ? `，${unread} 条未读` : ''}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => { setIsBellOpen(false); navigate('/dashboard'); }}
          className="w-full px-4 py-2.5 text-xs font-bold text-gray-500 hover:bg-gray-50 border-t border-gray-50"
        >
          回工作台看全部
        </button>
      </div>
    </>
  );

  const handleSelectView = (option: ViewOption) => {
    if (option.mode === 'role' && option.roleId) {
      setActiveRole(option.roleId);
      updatePersonaQuery(null);
    } else {
      if (location.pathname === '/dashboard') updatePersonaQuery(option.persona);
      else navigate(`/dashboard?persona=${option.persona}`);
    }
    setIsRoleMenuOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 flex-col md:flex-row">
      {/* Mobile Sidebar & Header logic remains preserved... */}
      <div className={`fixed inset-0 z-40 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:inset-auto md:block ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
         <div className={`fixed inset-0 bg-black/50 transition-opacity md:hidden ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)} />
         <Sidebar className="relative z-50 h-full shadow-xl md:shadow-none" onClose={() => setIsSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <header className="flex md:hidden h-14 bg-white border-b border-gray-200 items-center justify-between px-4 shrink-0 z-20 overflow-hidden">
          <div className="flex items-center space-x-2 min-w-0 shrink">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg shrink-0">
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-bold text-gray-800 whitespace-nowrap">{getPageTitle()}</h2>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            {/*
              手机端的铃铛。**和桌面端是两个独立的按钮** ——
              2026-09-02 改桌面端时差点漏了这个，
              结果会是「电脑上点铃铛有反应、手机上还是没反应」，
              而同事多半是在手机上看提醒的。
            */}
            <div className="relative">
              <button
                onClick={() => setIsBellOpen(v => !v)}
                aria-label={`提醒${unreadReminders.length > 0 ? `（${unreadReminders.length} 条未读）` : ''}`}
                className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadReminders.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[1rem] h-4 px-1 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold">
                    {unreadReminders.length > 99 ? '99+' : unreadReminders.length}
                  </span>
                )}
              </button>
              {isBellOpen && renderBellPanel()}
            </div>
          </div>
        </header>

        <header className="hidden md:flex h-16 bg-white border-b border-gray-200 items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center space-x-4">
             <h2 className="text-lg font-bold text-gray-800">{getPageTitle()}</h2>
             <div className="h-4 w-px bg-gray-200 mx-2"></div>
             <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索全局数据..."
                  className="bg-gray-50 border-none rounded-lg py-1.5 pl-9 pr-20 text-sm w-72 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  value={globalQuery}
                  onChange={(e) => setGlobalQuery(e.target.value)}
                  onFocus={() => {
                    setIsGlobalSearchFocused(true);
                    setIsGlobalResultPanelOpen(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setIsGlobalSearchFocused(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleGlobalSearchSubmit();
                  }}
                />
                <button
                  type="button"
                  onClick={handleGlobalSearchSubmit}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[11px] font-black text-indigo-600 hover:bg-indigo-50"
                  title={topGlobalHit ? `优先跳转：${topGlobalHit.label}` : '执行全局搜索'}
                >
                  搜索
                </button>
                {globalQuery.trim() && (
                  <div className="absolute left-0 top-full mt-1 text-[10px] font-bold text-gray-400 whitespace-nowrap">
                    {globalHitSummary || '未命中，按当前模块检索'}
                  </div>
                )}
                {shouldShowGlobalResultPanel && (
                  <div className="absolute left-0 top-full mt-6 w-[420px] max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl z-50 p-2 space-y-2">
                    {groupedHitScopes.length > 0 ? groupedHitScopes.map(group => (
                      <div key={group.scope} className="rounded-lg border border-gray-100 p-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-xs font-black text-gray-700">{group.label} · {group.count} 条</div>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleOpenScopeResult(group.route)}
                            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700"
                          >
                            打开
                          </button>
                        </div>
                        <div className="space-y-1">
                          {group.records.map((record, index) => (
                            <div key={`${group.scope}-${index}`} className="text-[11px] text-gray-600 truncate">
                              {record.primary}
                            </div>
                          ))}
                        </div>
                      </div>
                    )) : (
                      <div className="px-2 py-3 text-xs text-gray-500">未命中结果，可尝试更短关键词。</div>
                    )}
                  </div>
                )}
             </div>
          </div>

          <div className="flex items-center space-x-5">
             {/* 核心功能：身份切换器 */}

             {/*
               反馈入口。**系统管理员视角不显示** —— 他就是收反馈的人，
               给自己留一个「向自己反馈」的按钮只会占位置。

               放在铃铛旁边而不是收进菜单里：同事在被卡住的当下才会想反馈，
               那一刻他不会去翻菜单找。看不见的入口等于没有入口。
             */}
             {currentViewPersona !== 'sysadmin' && (
               <button
                 onClick={() => setIsFeedbackOpen(true)}
                 aria-label="反馈问题"
                 title="反馈问题"
                 className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
               >
                 <MessageSquare className="w-5 h-5" />
               </button>
             )}

             {/*
               铃铛。原来点了是 navigate('/dashboard') —— 而人多半就站在工作台上，
               所以表现为「点了没有任何反应」。

               三个设计选择，理由都在下面 renderBellPanel 里：
               ① 下拉面板而不是跳页面   ② 按对象聚合而不是按条罗列   ③ 点进去自动标已读
             */}
             <div className="relative">
               <button
                 onClick={() => setIsBellOpen(v => !v)}
                 aria-label={`提醒${unreadReminders.length > 0 ? `（${unreadReminders.length} 条未读）` : ''}`}
                 className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors group"
               >
                  <Bell className="w-5 h-5 group-hover:shake" />
                  {unreadReminders.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[1rem] h-4 px-1 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold">
                      {/* 上限 99+：三位数会把红点撑变形，而且「到底 127 还是 128 条」对人没有意义 */}
                      {unreadReminders.length > 99 ? '99+' : unreadReminders.length}
                    </span>
                  )}
               </button>
               {isBellOpen && renderBellPanel()}
             </div>

             {/*
               账号菜单。头部原来并排放着「身份」「视角」两个切换 chip，
               但它们是开发和演示用的工具，日常干活的人不需要天天看见——
               同事第一次上手会以为自己可以随便切身份。收进头像里：
               演示时点开还在，平时不占位置。

               退出登录也放这里。这是所有系统的通用位置，用户不用学；
               而在 2026-08-24 之前，**全应用根本没有退出入口**。
             */}
             <div className="relative pl-2 border-l border-gray-100">
                <button
                  type="button"
                  onClick={() => { setIsAccountMenuOpen(!isAccountMenuOpen); setIsRoleMenuOpen(false); setIsUserMenuOpen(false); }}
                  className="flex items-center space-x-3 rounded-xl px-2 py-1 transition-colors hover:bg-gray-50"
                  aria-haspopup="menu"
                  aria-expanded={isAccountMenuOpen}
                >
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-bold text-gray-900 leading-none">{currentUserDisplayName}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{currentRoleDisplayName}</p>
                  </div>
                  <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 border border-indigo-200">
                    <User className="w-5 h-5" />
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isAccountMenuOpen && (
                  <>
                    {/* 点击空白处关闭。没有这层遮罩，菜单只能靠再点一次按钮关掉 */}
                    <div className="fixed inset-0 z-40" onClick={() => setIsAccountMenuOpen(false)} />
                    <div className="absolute top-full right-0 mt-2 w-60 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50" role="menu">
                      <div className="px-3 py-2.5 border-b border-gray-50">
                        <p className="text-sm font-bold text-gray-900">{currentUserDisplayName}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">当前视角：{currentRoleDisplayName}</p>
                      </div>

                      {/* 视角切换：只给老板和系统管理员，理由见上面 canSwitchView 处的注释 */}
                      {canSwitchView && viewOptions.length > 1 && (
                        <div className="py-1 border-b border-gray-50">
                          <div className="px-3 pt-1 pb-1.5 text-[10px] font-black text-gray-400 tracking-widest">
                            切换视角
                            <span className="block mt-0.5 font-normal tracking-normal text-gray-400">
                              带「仅看板」的只换工作台，不改权限
                            </span>
                          </div>
                          {viewOptions.map(option => (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => { handleSelectView(option); setIsAccountMenuOpen(false); }}
                              className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentViewPersona === option.persona ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        className="w-full flex items-center gap-2 text-left px-3 py-2.5 mt-1 rounded-lg text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        <LogOut className="w-4 h-4 shrink-0" />
                        {isLoggingOut ? '正在退出…' : '退出登录'}
                      </button>
                    </div>
                  </>
                )}
             </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50/50">
          {children}
        </main>
        <AIChatWidget />
        <FeedbackModal open={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      </div>
    </div>
  );
};

export default Layout;
