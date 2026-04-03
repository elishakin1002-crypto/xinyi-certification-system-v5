
import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import AIChatWidget from './AIChatWidget';
import { MockWeChatPhone } from './MockWeChatPhone';
import { WeChatBindingModal } from './WeChatBindingModal';
import { Menu, Bell, User, Search, ShieldCheck, ChevronDown, Users, Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { SYSTEM_ROLES } from '../constants';
import { DashboardPersona, RoleID } from '../types';
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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isWeChatModalOpen, setIsWeChatModalOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);
  const [isGlobalResultPanelOpen, setIsGlobalResultPanelOpen] = useState(false);
  const {
    currentUser,
    userProfiles,
    switchUser,
    setActiveRole,
    activePersona,
    availablePersonas,
    resolveDashboardPersona,
    visibleReminders,
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
    MANAGER: 'sales',
    CONSULTANT: 'consultant',
    FINANCE: 'finance'
  };
  const personaDisplayName: Record<DashboardPersona, string> = {
    boss: '老板',
    sales: '销售',
    consultant: '咨询顾问',
    finance: '财务'
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return '工作台';
    if (path === '/leads') return '线索管理';
    if (path === '/projects') return '项目管理';
    if (path === '/finance') return '财务回款';
    return '信义系统';
  };

  const unreadReminders = visibleReminders.filter(r => !r.isRead);
  const queryPersona = useMemo(() => new URLSearchParams(location.search).get('persona'), [location.search]);
  const currentViewPersona = resolveDashboardPersona(queryPersona || activePersona);
  const normalizeDisplayLabel = (value: string) => String(value || '').replace(/\s*[（(]\s*示例\s*[)）]\s*/g, '').trim();
  const formatIdentityDisplayName = (value: string) => {
    const normalized = normalizeDisplayLabel(value);
    if (normalized === '交付负责人') return '销售';
    return normalized.replace(/台账指导兼职/g, '台账指导').replace(/兼职/g, '');
  };
  const formatViewDisplayName = (value: string) => {
    const normalized = normalizeDisplayLabel(value);
    if (normalized === '交付负责人') return '销售';
    return normalized;
  };
  const hasLedgerGuideTag = (tags?: string[]) => (tags || []).some(tag => String(tag).includes('台账指导'));
  const currentUserDisplayName = formatIdentityDisplayName(currentUser.name) || currentUser.name;
  const currentRoleDisplayName = personaDisplayName[currentViewPersona] || '老板';
  const availableRoles = SYSTEM_ROLES.filter(r => currentUser.roles.includes(r.id));
  const isFinanceOnlyIdentity = currentUser.roles.length === 1 && currentUser.roles[0] === 'FINANCE';
  const viewOptions = useMemo(() => {
    const base: ViewOption[] = availableRoles.map(role => ({
      key: `role-${role.id}`,
      mode: 'role' as const,
      roleId: role.id,
      persona: roleToPersona[role.id],
      label: formatViewDisplayName(role.name)
    }));
    const hasSales = base.some(item => item.persona === 'sales');
    if (!isFinanceOnlyIdentity && !hasSales && availablePersonas.includes('sales')) {
      base.push({
        key: 'persona-sales',
        mode: 'persona' as const,
        roleId: null,
        persona: 'sales',
        label: '销售'
      });
    }
    return base;
  }, [availableRoles, roleToPersona, isFinanceOnlyIdentity, availablePersonas]);
  const sortedUsers = [...userProfiles].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
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
            <div className="relative">
              <button
                onClick={() => { setIsUserMenuOpen(!isUserMenuOpen); setIsRoleMenuOpen(false); }}
                className="flex items-center px-2 py-1 bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] font-bold shadow-sm hover:bg-gray-50 transition-all active:scale-95 whitespace-nowrap"
              >
                <Users className="w-3 h-3 mr-1 text-gray-500 shrink-0" />
                <span className="max-w-[110px] truncate block text-left">{`身份：${currentUserDisplayName}`}</span>
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform shrink-0 ${isUserMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isUserMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50 animate-in fade-in slide-in-from-top-2 max-h-[60vh] overflow-auto">
                  <div className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">切换当前用户</div>
                  {sortedUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => { switchUser(u.id); setIsUserMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentUser.id === u.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{formatIdentityDisplayName(u.name)}</span>
                        {hasLedgerGuideTag(u.positionTags) && (
                          <span className="ml-2 text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">台账指导</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => { setIsRoleMenuOpen(!isRoleMenuOpen); setIsUserMenuOpen(false); }}
                className="flex items-center px-2 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold shadow-md hover:bg-slate-800 transition-all active:scale-95 whitespace-nowrap"
              >
                <ShieldCheck className="w-3 h-3 mr-1 text-indigo-400 shrink-0" />
                <span className="max-w-[120px] truncate block text-left">{`视角：${currentRoleDisplayName}`}</span>
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform shrink-0 ${isRoleMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isRoleMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">切换身份视角</div>
                  {viewOptions.map(option => (
                    <button
                      key={option.key}
                      onClick={() => handleSelectView(option)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentViewPersona === option.persona ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => navigate('/dashboard')} className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
              <Bell className="w-5 h-5" />
              {unreadReminders.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold">
                  {unreadReminders.length}
                </span>
              )}
            </button>
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
             <div className="relative">
                <button 
                  onClick={() => { setIsUserMenuOpen(!isUserMenuOpen); setIsRoleMenuOpen(false); }}
                  className="flex items-center px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-bold shadow-sm hover:bg-gray-50 transition-all active:scale-95"
                >
                  <Users className="w-3.5 h-3.5 mr-2 text-gray-500" />
                  {`身份：${currentUserDisplayName}`}
                  <ChevronDown className={`w-3 h-3 ml-2 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {isUserMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50 animate-in fade-in slide-in-from-top-2 max-h-[60vh] overflow-auto">
                    <div className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">切换当前用户</div>
                    {sortedUsers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => { switchUser(u.id); setIsUserMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentUser.id === u.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">{formatIdentityDisplayName(u.name)}</span>
                          {hasLedgerGuideTag(u.positionTags) && (
                            <span className="ml-2 text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">台账指导</span>
                          )}
                        </div>
                      </button>
                    ))}
                    <button 
                      onClick={() => { setIsWeChatModalOpen(true); setIsUserMenuOpen(false); }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-50 mt-1"
                    >
                      <Settings size={14} />
                      微信通知绑定
                    </button>
                  </div>
                )}
             </div>
             {/* 核心功能：身份切换器 */}
             <div className="relative">
                <button 
                  onClick={() => { setIsRoleMenuOpen(!isRoleMenuOpen); setIsUserMenuOpen(false); }}
                  className="flex items-center px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold shadow-md hover:bg-slate-800 transition-all active:scale-95"
                >
                  <ShieldCheck className="w-3.5 h-3.5 mr-2 text-indigo-400" />
                  {`视角：${currentRoleDisplayName}`}
                  <ChevronDown className={`w-3 h-3 ml-2 transition-transform ${isRoleMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isRoleMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">切换身份视角</div>
                    {viewOptions.map(option => (
                      <button 
                        key={option.key}
                        onClick={() => handleSelectView(option)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${currentViewPersona === option.persona ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
             </div>

             <button onClick={() => navigate('/dashboard')} className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors group">
                <Bell className="w-5 h-5 group-hover:shake" />
                {unreadReminders.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white font-bold">
                    {unreadReminders.length}
                  </span>
                )}
             </button>

             <div className="flex items-center space-x-3 pl-2 border-l border-gray-100">
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900 leading-none">{currentUserDisplayName}</p>
                  <p className="text-[10px] text-gray-400 mt-1 uppercase">V5.3 Stable</p>
                </div>
                <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 border border-indigo-200">
                  <User className="w-5 h-5" />
                </div>
             </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50/50">
          {children}
        </main>
        <AIChatWidget />
        <MockWeChatPhone />
        <WeChatBindingModal isOpen={isWeChatModalOpen} onClose={() => setIsWeChatModalOpen(false)} />
      </div>
    </div>
  );
};

export default Layout;
