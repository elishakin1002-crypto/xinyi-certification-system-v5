
import React, { useState } from 'react';
import Sidebar from './Sidebar';
import AIChatWidget from './AIChatWidget';
import { MockWeChatPhone } from './MockWeChatPhone';
import { WeChatBindingModal } from './WeChatBindingModal';
import { Menu, Bell, User, Search, ShieldCheck, ChevronDown, Users, Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { SYSTEM_ROLES } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isWeChatModalOpen, setIsWeChatModalOpen] = useState(false);
  const { currentUser, userProfiles, switchUser, activeRole, setActiveRole, visibleReminders } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return '工作台';
    if (path === '/leads') return '线索管理';
    if (path === '/projects') return '项目管理';
    if (path === '/finance') return '财务回款';
    return '信义系统';
  };

  const unreadReminders = visibleReminders.filter(r => !r.isRead);
  const currentRoleName = SYSTEM_ROLES.find(r => r.id === activeRole)?.name || '未知角色';
  const availableRoles = SYSTEM_ROLES.filter(r => currentUser.roles.includes(r.id));
  const sortedUsers = [...userProfiles].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

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
                <span className="max-w-[80px] truncate block text-left">{currentUser.name}</span>
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
                        <span className="truncate">{u.name}</span>
                        {u.positionTags?.includes('台账指导兼职') && (
                          <span className="ml-2 text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">台账兼职</span>
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
                <span className="max-w-[60px] truncate block text-left">{currentRoleName}</span>
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform shrink-0 ${isRoleMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isRoleMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">切换身份视角</div>
                  {availableRoles.map(role => (
                    <button
                      key={role.id}
                      onClick={() => { setActiveRole(role.id); setIsRoleMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeRole === role.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {role.name}
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
                <input type="text" placeholder="搜索全局数据..." className="bg-gray-50 border-none rounded-lg py-1.5 pl-9 pr-4 text-sm w-64 focus:ring-2 focus:ring-indigo-500/20 outline-none" />
             </div>
          </div>

          <div className="flex items-center space-x-5">
             <div className="relative">
                <button 
                  onClick={() => { setIsUserMenuOpen(!isUserMenuOpen); setIsRoleMenuOpen(false); }}
                  className="flex items-center px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-bold shadow-sm hover:bg-gray-50 transition-all active:scale-95"
                >
                  <Users className="w-3.5 h-3.5 mr-2 text-gray-500" />
                  当前用户：{currentUser.name}
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
                          <span className="truncate">{u.name}</span>
                          {u.positionTags?.includes('台账指导兼职') && (
                            <span className="ml-2 text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">台账兼职</span>
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
                  当前视角：{currentRoleName}
                  <ChevronDown className={`w-3 h-3 ml-2 transition-transform ${isRoleMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isRoleMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 p-1 z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="px-3 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50 mb-1">切换身份视角</div>
                    {availableRoles.map(role => (
                      <button 
                        key={role.id}
                        onClick={() => { setActiveRole(role.id); setIsRoleMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeRole === role.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        {role.name}
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
                  <p className="text-sm font-bold text-gray-900 leading-none">{currentUser.name}</p>
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
