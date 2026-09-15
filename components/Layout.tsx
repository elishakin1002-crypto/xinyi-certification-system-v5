
import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import AIChatWidget from './AIChatWidget';
import VersionWatcher from './VersionWatcher';
import FeedbackModal from './FeedbackModal';
import MyAiUsage from './MyAiUsage';
import OnboardingTour from './OnboardingTour';
import HelpHub from './HelpHub';
import { Menu, Bell, User, Search, ShieldCheck, ChevronDown, Users, Settings, LogOut, Eye, MessageSquare, Compass, MonitorSmartphone, AlertTriangle, X, HelpCircle, KeyRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { authService } from '../services/authService';
import { stateSyncService } from '../services/stateSyncService';
import { dataService } from '../services/dataService';
import { useLocation, useNavigate } from 'react-router-dom';
import { SYSTEM_ROLES , ROLE_TO_PERSONA} from '../constants';
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
  const [replayTour, setReplayTour] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpStartMode, setHelpStartMode] = useState<'menu' | 'page'>('menu');
  const openHelp = () => { setHelpStartMode('menu'); setHelpOpen(true); };
  const learnCurrentPage = () => { setHelpStartMode('page'); setHelpOpen(true); };
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
    /*
      ── 先落盘，再清 cookie（2026-09-15 修）────────────────────────

      原来是直接 logout。问题出在时序上：
      清了 cookie 之后，队列里那笔防抖写入才发出 → 401 →
      红条「有内容尚未保存到服务器 Login required」弹出 →
      最后的 reload 撞上 stateSyncService 的 beforeunload 守卫 →
      **页面不走了，人停在原来的工作台上退不出去。**

      共用电脑上退不出去 = 下一个人看到上一个人的数据，
      正是这个按钮当初被加进来要防的事故。

      落盘要在清 cookie 之前 —— 那时还有登录态，写得进去。
      写不进去也要告诉人后果，让他选，而不是默默丢掉或默默卡住。
    */
    try {
      const saved = await stateSyncService.prepareSignOut();
      if (!saved) {
        const go = window.confirm(
          '有内容没能保存到服务器。\n\n'
          + '现在退出的话，这部分内容会丢失。\n\n'
          + '点「确定」仍然退出；点「取消」留在页面上，'
          + '可以用红色提示条里的「导出未保存内容」先存一份交给管理员。'
        );
        if (!go) {
          stateSyncService.cancelSignOut();
          setIsLoggingOut(false);
          return;
        }
      }
    } catch (error) {
      // 落盘这一步出错也不能卡住退出 —— 退不出去比丢一次草稿严重得多
      console.warn('[logout] 落盘失败，仍然继续退出', error);
    }
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
    resolveReminders,
    upcomingLaterCount,
    previewPersona,
    setPreviewPersona,
    writeFailure,
    dismissWriteFailure,
    leads,
    customers,
    contracts,
    projects,
    knowledgeDocs,
    userPermissions
  } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  /*
    视角显示名。这里是**看板视角**的名字，不是角色名——
    五个看板（总经理/销售/顾问/财务/系统管理员）和六个角色不是一一对应
    （总助看总经理看板）。所以它不能直接取 SYSTEM_ROLES，是独立的一组标签。
  */
  const personaDisplayName: Record<DashboardPersona, string> = {
    // 键名 boss 保留（写在 URL / localStorage / current_role 里，改了旧值全失效），
    // 只改显示名：公司里这个角色的正式称呼是总经理，不是老板。
    boss: '总经理',
    manager: '总助',
    sales: '销售',
    consultant: '咨询顾问',
    finance: '财务',
    sysadmin: '系统管理员'
  };

  const getPageTitle = () => {
    const path = location.pathname;
    /*
      少一条的后果不是标题错，是**手机上顶栏显示「信义系统」**——
      人不知道自己在哪一页。加页面时最容易漏的就是这里。
    */
    const titles: Record<string, string> = {
      '/dashboard': '工作台',
      '/leads': '线索管理',
      '/customers': '客户管理',
      '/contracts': '合同管理',
      '/my-tasks': '我的任务',
      '/projects': '项目管理',
      '/finance': '财务回款',
      '/finance/settlements': '顾问结算',
      '/audit': '不符合项管理',
      '/knowledge': '知识中心',
      '/intel': '情报雷达',
      '/strategy': '战略管理',
      '/ai-center': 'AI 配置中心',
      '/employees': '员工账号',
      '/auth-audit': '审计日志',
      '/my-devices': '我的登录设备',
      '/change-password': '修改密码',
    };
    return titles[path] || '信义系统';
  };

  const unreadReminders = visibleReminders.filter(r => !r.isRead);
  const queryPersona = useMemo(() => new URLSearchParams(location.search).get('persona'), [location.search]);
  /*
    视角来源优先级：Context 里的预览 > URL 参数（兼容旧链接）> 本人角色。
    Context 排第一，是因为它跨页面不丢 —— 而 URL 参数一点导航就没了。
  */
  const currentViewPersona = resolveDashboardPersona(previewPersona || queryPersona || activePersona);
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
      persona: ROLE_TO_PERSONA[role.id],
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
        /*
          「系统管理员」视角只给系统管理员本人（2026-09-05）。

          它不是一个业务视角，是运维看板：今日错误、AI 花了多少钱、
          谁在线、数据库多大。总经理点进去看到的是一屏他既不需要、
          也无从判断的技术指标 —— 而**看不懂的数字会引起没必要的担心**，
          「今日错误 3 种」在他眼里可能就是「系统是不是要崩了」。

          除了本人，谁都不给，包括总经理。
        */
        if (persona === 'sysadmin'
          && !currentUser.roles.includes('SYS_ADMIN')) return;
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
  }, [availableRoles, isFinanceOnlyIdentity, availablePersonas, canSwitchView, currentUser.roles]);
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
  const BELL_LIMIT = 12;
  /*
    ── 规则 5「分级」（2026-09-14）────────────────────────────

    金恩来：「提醒越挂越多也是个问题。」
    生产实测 228 条、0 条已读、205 条过期 —— 全挤在一个列表里，
    人看一眼就再也不看了，真正要紧的那条跟着一起被埋掉。

    所以分两段：**今天必须做**（已逾期 or 今天到期）和**之后的**。
    「今天必须做」那段要短 —— 短到人愿意一条条看完，这个功能才算活着。
    一个一眼看不完的待办列表，和没有待办列表是一样的。
  */
  const bellBuckets = useMemo(() => {
    const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const today = new Date().toISOString().slice(0, 10);
    const sorted = [...aggregatedReminders].sort((a, b) => {
      const aUnread = a.samples.some(s => !s.isRead) ? 1 : 0;
      const bUnread = b.samples.some(s => !s.isRead) ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      const sev = (rank[b.severity] || 0) - (rank[a.severity] || 0);
      if (sev !== 0) return sev;
      return String(b.latestDate || '').localeCompare(String(a.latestDate || ''));
    });

    /*
      ── 没填日期的单独一档，不冒充「今天要做」（2026-09-15 改）────────

      原来写的是「没有日期的当成今天必须做 —— 宁可多催一条」。
      出发点是对的（不能把它悄悄藏起来），但放错了篮子：

      **「今天要做」是人早上唯一会认真看完的那一屏。**
      一旦混进没有日期、因而永远不会消失的条目，这一屏就再也清不空；
      清不空的清单，人很快就整屏忽略 —— 而真正紧急的那条也在里面。
      这和「一个永远消不掉的红色数字会让人不再信任所有红色」是同一条。

      成熟做法一致（Todoist / Asana / Things）：「今天」只放真到期的，
      没日期的进「收件箱／待安排」。

      而且这样才和系统里另外两处口径一致 ——
      没填截止日的任务不算逾期、没填到期日的应收不算逾期
      （src/modules/glossary.ts）：**没约定就没有迟到**。
      没填日期是资料缺失，该去补，不是今天的活。

      金恩来 2026-09-15 确认按这个来。
    */
    const hasDate = (g: AggregatedReminder) => Boolean(String(g.latestDate || '').trim());
    const now = sorted.filter(g => hasDate(g) && String(g.latestDate) <= today);
    const later = sorted.filter(g => hasDate(g) && String(g.latestDate) > today);
    const undated = sorted.filter(g => !hasDate(g));

    /*
      规则 6「有上限」：两段合起来截到 12 组。
      截掉的条数要**显示出来**，不能悄悄吞掉 ——
      人不知道后面还有多少，就没法判断要不要点进去看全部。
    */
    const shownNow = now.slice(0, BELL_LIMIT);
    const shownLater = later.slice(0, Math.max(0, BELL_LIMIT - shownNow.length));
    // 待安排那档给固定的小额度：它是提醒人去补日期，不是今天的活，不该挤掉前两段
    const shownUndated = undated.slice(0, 3);
    return {
      now: shownNow,
      later: shownLater,
      undated: shownUndated,
      undatedTotal: undated.length,
      hidden: (now.length - shownNow.length) + (later.length - shownLater.length)
        + (undated.length - shownUndated.length),
      total: sorted.length
    };
  }, [aggregatedReminders]);

  const bellGroups = useMemo(
    () => [...bellBuckets.now, ...bellBuckets.later, ...bellBuckets.undated],
    [bellBuckets]
  );

  const severityStyle: Record<string, { dot: string; text: string; label: string }> = {
    high: { dot: 'bg-red-500', text: 'text-red-600', label: '紧急' },
    medium: { dot: 'bg-amber-500', text: 'text-amber-600', label: '关注' },
    low: { dot: 'bg-gray-300', text: 'text-gray-400', label: '一般' }
  };

  /*
    加一种就要在这里加一行，否则那类提醒**点了没反应**（下面 route 为空直接 return）——
    这正是铃铛当初「点了没反应」的老毛病，只是换了个入口。
  */
  const linkTypeRoute: Record<string, string> = {
    lead: '/leads',
    customer: '/customers',
    contract: '/contracts',
    project: '/projects',
    audit: '/audit',
    intel: '/intel',
    employee: '/employees'   // 账号到期提醒：点进去直接改有效期
  };

  const handleOpenReminderGroup = (group: AggregatedReminder) => {
    markRemindersRead(group.samples.map(s => s.id));
    setIsBellOpen(false);
    const route = linkTypeRoute[group.linkType];
    if (!route) return;
    // 带上 id，目标页面可以据此高亮/滚动到那一条
    navigate(`${route}?focus=${encodeURIComponent(group.linkId)}`);
  };

  /**
   * 一段提醒（「今天要做」/「之后」）。
   *
   * 每条右边有个「办完了」—— 这是规则 2 的入口，也是整改里最关键的一个按钮。
   * 原来只有「标为已读」，而标已读既不代表事情做了、也不让它消失，
   * 所以生产上 228 条提醒**一条都没人标**。那不是同事偷懒，是设计没给出口。
   */
  const renderBellSection = (label: string, groups: AggregatedReminder[], urgent: boolean) => {
    if (!groups.length) return null;
    return (
      <div>
        <div className={`px-4 py-1.5 text-[10px] font-black tracking-wider ${urgent ? 'text-red-500 bg-red-50/60' : 'text-gray-400 bg-gray-50/60'}`}>
          {label} · {groups.length}
        </div>
        {groups.map(group => {
          const style = severityStyle[group.severity] || severityStyle.low;
          const unread = group.samples.filter(s => !s.isRead).length;
          return (
            <div
              key={group.id}
              className={`flex items-start gap-1 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors ${unread > 0 ? '' : 'opacity-55'}`}
            >
              <button
                type="button"
                onClick={() => handleOpenReminderGroup(group)}
                className="flex-1 min-w-0 text-left px-4 py-3"
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
              <button
                type="button"
                title="这件事已经处理完了，从待办里去掉（还能在归档里查到）"
                onClick={(e) => { e.stopPropagation(); resolveReminders(group.samples.map(s => s.id)); }}
                className="shrink-0 self-center mr-3 px-2 py-1 rounded-lg text-[11px] font-bold text-emerald-600 hover:bg-emerald-50"
              >
                办完了
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderBellPanel = () => (
    <>
      {/*
        点空白处关闭。没有这层，面板只能靠再点一次铃铛关掉。

        `data-dismiss-layer` 是给别人看的标记，不是样式：
        它铺满整屏、又是 fixed，长得和弹窗遮罩一模一样，
        于是帮助那边把它当成「打开了一个弹窗」，在右下角弹出
        「这个弹窗要我填什么？」—— 点个铃铛而已，没有任何东西要填。
        见 HelpHub 的 visibleModals()。
      */}
      <div data-dismiss-layer="1" className="fixed inset-0 z-40" onClick={() => setIsBellOpen(false)} />
      <div className="absolute top-full right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <div>
            <p className="text-sm font-bold text-gray-900">待办提醒</p>
            {/*
              ── 两个数字要对得上（2026-09-14 金恩来截图指出）────────────

              他看到的是：铃铛角标写「23」，面板里只列出 9 条。
              「其他内容在哪里？」—— 合理的疑问，而且是我的表述有问题：
              角标数的是**提醒条数**，面板列的是**按客户/项目聚合后的件数**。
              同一个客户挂着 3 条提醒，聚合成 1 件。

              两个口径都有用（条数反映工作量，件数反映要决策几次），
              但摆在一起不说清楚，人第一反应一定是「丢了 14 条」。
              所以这里把换算写出来。
            */}
            <p className="text-[11px] text-gray-400 mt-0.5">
              {unreadReminders.length > 0
                ? `${unreadReminders.length} 条未读，归成 ${bellBuckets.total} 件事`
                : '没有未读提醒'}
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
              <p className="text-sm font-bold text-gray-400">近期没有需要你处理的事</p>
              {/*
                空面板 + 角标消失，看着像"提醒功能又没了"。
                生产实测 23 条待办全是两周之后才该响的 ——
                0 是对的，但要说出「更远的还有几件」，人才知道系统在正常工作。
              */}
              <p className="text-[11px] text-gray-300 mt-1">
                {upcomingLaterCount > 0
                  ? `还有 ${upcomingLaterCount} 件排在两周以后，到日子会自动出现`
                  : '有逾期、待验收或风险时会出现在这里'}
              </p>
            </div>
          ) : (
            <>
              {renderBellSection('今天要做', bellBuckets.now, true)}
              {renderBellSection('之后', bellBuckets.later, false)}
              {/*
                「待安排」放最后，标题里带条数 —— 它不是今天的活，
                但也不能悄悄消失：没填日期说明这条提醒建的时候漏了信息，
                点进去补一个日期，它就会自己回到上面两档里。
              */}
              {renderBellSection(`待安排（${bellBuckets.undatedTotal} 条没有日期）`, bellBuckets.undated, false)}
              {bellBuckets.hidden > 0 && (
                /*
                  规则 6：截掉的必须说出来。
                  悄悄吞掉的话，人不知道后面还有多少，也就没法判断要不要点进去看全部。
                */
                <div className="px-4 py-2.5 text-[11px] font-bold text-gray-400 bg-gray-50/60 text-center">
                  还有 {bellBuckets.hidden} 项没显示（共 {bellBuckets.total} 项）
                </div>
              )}
            </>
          )}
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

  /*
    账号菜单（头像）。**桌面端和手机端共用这一份。**

    2026-09-10：金恩来在平板宽度下发现「我的角色头像找不到了」——
    查下来是手机端头部（flex md:hidden）压根没有这一块，
    于是低于 768px 时，切换视角、我的登录设备、AI 用量，
    **连「退出登录」都没有入口** —— 而退出登录是全系统最不该消失的按钮。

    为什么抽成一个函数而不是在两个头部各写一遍：
    这个文件里已经有过一次教训 —— 铃铛在两个头部各写了一份，
    2026-09-02 改桌面端时差点漏掉手机端那份，
    结果会是「电脑上点有反应、手机上没反应」。
    并排放两份长得像的 JSX，迟早只改其中一份。

    data-onboard 两份都留：新手引导的 pick() 只挑**当前可见**的那个
    （见 OnboardingTour.tsx 里的 getBoundingClientRect 过滤），
    所以两份都标反而让引导在手机上也能指到这一步。

    ── 菜单里为什么装这些 ────────────────────────────────────────
    头部原来并排放着「身份」「视角」两个切换 chip，但那是开发和演示用的，
    日常干活的人不需要天天看见 —— 同事第一次上手会以为自己可以随便切身份。
    收进头像里：演示时点开还在，平时不占位置。

    退出登录也在这里。这是所有系统的通用位置，用户不用学；
    而在 2026-08-24 之前，**全应用根本没有退出入口**。
  */
  const renderAccountMenu = (compact = false) => (
         <div className={compact ? 'relative shrink-0' : 'relative pl-2 border-l border-gray-100'}>
            <button
              type="button"
              data-onboard="view-switch"
              onClick={() => { setIsAccountMenuOpen(!isAccountMenuOpen); setIsRoleMenuOpen(false); setIsUserMenuOpen(false); }}
              className={`flex items-center rounded-xl transition-colors hover:bg-gray-50 ${compact ? 'space-x-0 p-0.5' : 'space-x-3 px-2 py-1'}`}
              aria-haspopup="menu"
              aria-expanded={isAccountMenuOpen}
              aria-label={`账号菜单：${currentUserDisplayName}，当前视角 ${currentRoleDisplayName}`}
            >
              {/* 手机端头部只放得下一个头像，姓名和视角在菜单里第一行还会再说一遍 */}
              {!compact && (
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-gray-900 leading-none">{currentUserDisplayName}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{currentRoleDisplayName}</p>
                </div>
              )}
              <div className={`bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 border border-indigo-200 ${compact ? 'w-8 h-8' : 'w-9 h-9'}`}>
                <User className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
              </div>
              {!compact && (
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`} />
              )}
            </button>

            {isAccountMenuOpen && (
              <>
                {/* 点击空白处关闭。data-dismiss-layer 的原因见上面铃铛那一处 */}
                <div data-dismiss-layer="1" className="fixed inset-0 z-40" onClick={() => setIsAccountMenuOpen(false)} />
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

                  {/*
                    自己的 AI 用量。组件内部在低于 70% 时返回 null，
                    所以平时这里什么都不会出现 —— 只有快满了才冒出来。
                    放在账号菜单里而不是常驻头部：常驻会让人觉得自己在被计量。
                  */}
                  <div className="px-1 py-1"><MyAiUsage /></div>

                  {/*
                    重看引导。第一次登录时人最想做的是「赶紧看看这东西长什么样」，
                    引导反而是干扰；等他用了两天遇到问题，才是真正想看的时候 ——
                    那时候找不到入口，这个功能就白做了。
                  */}
                  <button
                    type="button"
                    onClick={() => { openHelp(); setIsAccountMenuOpen(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <Compass className="w-4 h-4 shrink-0" />
                    帮助与新手引导
                  </button>

                  {/*
                    「我在哪几台设备登录着」。

                    勾了「常用电脑」的会话有 14 天，风险不在时间长，
                    在于**人不知道自己还在哪登着**。
                    换了电脑、手机丢了、在客户那儿借电脑登过一次 ——
                    看得见、踢得掉，这件事才算解决。
                  */}
                  <button
                    type="button"
                    onClick={() => { navigate('/my-devices'); setIsAccountMenuOpen(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <MonitorSmartphone className="w-4 h-4 shrink-0" />
                    我的登录设备
                  </button>

                  {/*
                    主动改密码。2026-09-13 金恩来：「关键是我自己要去修改密码
                    也没有这个入口。」—— 首次登录强制改的那一页改完就进不去了，
                    于是全系统没有任何地方能主动换密码。放在退出登录上面，
                    和「我的登录设备」挨着：都是「管我这个账号本身」。
                  */}
                  <button
                    type="button"
                    onClick={() => { navigate('/change-password'); setIsAccountMenuOpen(false); }}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <KeyRound className="w-4 h-4 shrink-0" />
                    修改密码
                  </button>

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
  );

  const handleSelectView = (option: ViewOption) => {
    if (option.mode === 'role' && option.roleId) {
      setActiveRole(option.roleId);
      setPreviewPersona(null);          // 切回真实角色，清掉预览
      updatePersonaQuery(null);
    } else {
      // 预览：写进 Context，这样点到任何页面都还在这个视角
      setPreviewPersona(option.persona);
      if (location.pathname === '/dashboard') updatePersonaQuery(option.persona);
      else navigate(`/dashboard?persona=${option.persona}`);
    }
    setIsRoleMenuOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 flex-col md:flex-row">
      {/* Mobile Sidebar & Header logic remains preserved... */}
      <div className={`fixed inset-0 z-40 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:inset-auto md:block ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
         {/* 侧边栏的遮罩同理：菜单不是「要填的弹窗」，见上面铃铛那一处 */}
         <div data-dismiss-layer="1" className={`fixed inset-0 bg-black/50 transition-opacity md:hidden ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)} />
         <Sidebar className="relative z-50 h-full shadow-xl md:shadow-none" onClose={() => setIsSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/*
          ── 这里**不能有 overflow-hidden**（2026-09-11 血的教训）──────────

          原来这个 header 上挂着 overflow-hidden，用途是防止长标题把布局撑破。
          代价是：**它把所有从头部垂下来的下拉面板整个裁掉了**。

          下拉面板是 `absolute top-full` —— 定位在头部**下边缘之外**。
          头部高 56px、overflow:hidden，于是面板 100% 不可见。
          受害的不止一个：
            · 账号菜单（头像点了没反应 —— 金恩来 2026-09-11 报的就是这个）
            · **铃铛面板**（这个更早，一直就是坏的，只是没人报）

          ── 我的测试为什么没发现 ────────────────────────────────────────

          我当时用 getBoundingClientRect 判「菜单在不在视口内」，
          它回答 true，我就认为过了。

          **但 getBoundingClientRect 报的是布局几何，和祖先有没有把它裁掉无关。**
          被 overflow 裁掉的元素，rect 照样是原来那个位置。

          这和坑 #10（offsetParent 对 fixed 元素恒为 null）是同一类错误：
          **用了一个不表示我以为的含义的测量**，然后拿它当验证通过。

          正确判据是 `el.contains(document.elementFromPoint(x, y))` ——
          问「那个点上实际画着的是不是它」。已写进 scripts/ui-visibility-check.mjs。

          长标题改用 truncate 处理：该省略号的省略号，而不是把整行裁掉。
        */}
        <header className="flex md:hidden h-14 bg-white border-b border-gray-200 items-center justify-between px-4 shrink-0 z-20">
          <div className="flex items-center space-x-2 min-w-0 shrink">
            <button data-onboard="mobile-menu" onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg shrink-0">
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-bold text-gray-800 truncate">{getPageTitle()}</h2>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            {/* 手机上更需要这个入口：屏幕小、说明文字都被折叠了 */}
            <button
              onClick={openHelp}
              data-onboard="help" aria-label="帮助"
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
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

            {/*
              头像。和桌面端共用 renderAccountMenu ——
              2026-09-10 之前这里**什么都没有**，于是低于 768px 时
              切换视角、我的登录设备、AI 用量、连退出登录都没有入口。
              退出登录尤其不能少：共用电脑上换个人用都做不到。
            */}
            {renderAccountMenu(true)}
          </div>
        </header>

        <header className="hidden md:flex h-16 bg-white border-b border-gray-200 items-center justify-between px-6 shrink-0 z-20">
          {/*
            min-w-0 是关键：flex 子项默认 min-width:auto，**不会缩到内容以下**。
            没有它，下面那个搜索框会把整个左半边撑住不让步。
          */}
          <div className="flex items-center space-x-4 min-w-0 flex-1">
             <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap shrink-0">{getPageTitle()}</h2>
             <div className="h-4 w-px bg-gray-200 mx-2 shrink-0"></div>
             <div className="relative group min-w-0 flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索全局数据..."
                  /*
                    2026-09-10：这里原来写死 w-72（288px）。

                    md: 断点是 768px，而侧边栏占掉 256px —— 头部实际只剩 512px，
                    却要塞下 标题 + 288px 搜索框 + 283px 右侧图标组 = 646px。
                    溢出的部分被 justify-between 推到右边裁掉，
                    **头像正好是最右边那个，于是它整个消失了**。
                    金恩来 2026-09-10 在平板宽度下就是这么丢的头像。

                    宽度不再写死：跟着可用空间缩，最宽还是原来的尺寸。
                  */
                  className="w-full bg-gray-50 border-none rounded-lg py-1.5 pl-9 pr-20 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
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

          {/*
            shrink-0：右侧这一组（反馈 / 帮助 / 铃铛 / 头像）**一个都不许被挤掉**。
            要让位的是搜索框，不是账号入口 —— 退出登录就在这后面。
          */}
          <div className="flex items-center space-x-5 shrink-0">
             {/* 核心功能：身份切换器 */}

             {/*
               反馈入口。**系统管理员视角不显示** —— 他就是收反馈的人，
               给自己留一个「向自己反馈」的按钮只会占位置。

               放在铃铛旁边而不是收进菜单里：同事在被卡住的当下才会想反馈，
               那一刻他不会去翻菜单找。看不见的入口等于没有入口。
             */}
             {currentViewPersona !== 'sysadmin' && (
               <button
                 data-onboard="feedback"
                 onClick={() => setIsFeedbackOpen(true)}
                 aria-label="反馈问题"
                 title="反馈问题"
                 className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
               >
                 <MessageSquare className="w-5 h-5" />
               </button>
             )}

             {/*
               帮助入口。**常驻在头部，不收进菜单** ——
               需要帮助的那一刻，人正卡在某个按钮前面，
               他不会先去翻账号菜单找「帮助在哪」。看不见的入口等于没有入口。

               一个问号后面挂三层：走一遍岗位 / 讲这一页 / 点哪讲哪。
               分成三个按钮的话，人得先判断「我这个问题属于第几层」，
               那是让他先学一遍我的分类法。
             */}
             <button
               data-onboard="help"
               onClick={openHelp}
               aria-label="帮助"
               title="新手引导：认识我的工作台 / 了解当前模块 / 解释这一项"
               className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
             >
               <HelpCircle className="w-5 h-5" />
             </button>

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

             {renderAccountMenu()}
          </div>
        </header>

        <main data-onboard="workspace-content" className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50/50">
          {children}
        </main>
        <AIChatWidget />
        <VersionWatcher />

        {/*
          ── 保存失败必须让人看见（2026-09-07）────────────────

          原来写失败只在控制台打一行 warn。同事不会开控制台，
          他看到的是「我点了确认、东西也出现了」，
          刷新之后东西没了 —— 他会以为系统把数据弄丢了。

          红色、居中、要手动关掉：这类消息不能自己消失，
          人可能正低头看键盘，一闪而过等于没提示。
        */}
        {writeFailure && (
          <div className="fixed inset-x-0 top-4 z-[80] flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-lg">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div className="min-w-0">
                <p className="text-sm font-black text-gray-900">
                  「{writeFailure.what}」没有保存成功
                </p>
                <p className="mt-0.5 text-xs font-bold leading-relaxed text-gray-600">
                  {writeFailure.reason}
                </p>
                <p className="mt-1 text-[11px] font-bold text-gray-400">
                  刚才那条已经撤回，界面上看到的就是真实情况 —— 不用担心存了一半。
                </p>
              </div>
              <button
                onClick={dismissWriteFailure}
                className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        <FeedbackModal open={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
        <OnboardingTour forceOpen={replayTour} onClose={() => setReplayTour(false)} onHelp={openHelp} onLearnPage={learnCurrentPage} />
        <HelpHub initialMode={helpStartMode} open={helpOpen} onClose={() => setHelpOpen(false)} onOpen={openHelp} onReplayTour={() => setReplayTour(true)} />
      </div>
    </div>
  );
};

export default Layout;
