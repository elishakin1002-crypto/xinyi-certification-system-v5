
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Briefcase, 
  DollarSign, 
  FileText, 
  BookOpen, 
  Settings, 
  ChevronDown, 
  ChevronRight,
  Target,
  ClipboardCheck,
  X,
  UserCog,
  FileClock
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ROLE_PERMISSIONS } from '../constants';
import { PermissionCode } from '../types';

interface SidebarProps {
  onClose?: () => void;
  className?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ onClose, className = '' }) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'crm': true,
    'delivery': true,
    'finance': true,
    'audit': true
  });
  const { hasPermission, activeRole, currentUser } = useApp();
  const inView = (permission: PermissionCode) => ROLE_PERMISSIONS[activeRole]?.includes(permission);
  const canManageEmployees = currentUser.roles.includes('ADMIN');

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const navClass = ({ isActive }: { isActive: boolean }) => 
    `flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      isActive 
        ? 'bg-blue-600 text-white shadow-sm' 
        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
    }`;
  
  const handleLinkClick = () => {
    if (onClose) onClose();
  };

  return (
    <div className={`flex flex-col w-64 h-full bg-gray-900 border-r border-gray-800 text-white flex-shrink-0 ${className}`}>
      <div className="flex items-center justify-between px-4 h-16 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">X</div>
            <span className="text-lg font-black tracking-tight">信义 V5.0</span>
        </div>
        {/* Mobile Close Button */}
        {onClose && (
            <button onClick={onClose} className="md:hidden text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
            </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1 no-scrollbar">
        {/* Workspace */}
        <NavLink to="/dashboard" className={navClass} onClick={handleLinkClick}>
          <LayoutDashboard className="w-5 h-5 mr-3" />
          工作台
        </NavLink>

        {/* CRM Group */}
        {hasPermission('NAV_CRM') && inView('NAV_CRM') && (
        <div className="pt-2">
          <button 
            onClick={() => toggleGroup('crm')}
            className="flex items-center justify-between w-full px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
          >
            <div className="flex items-center">
              <Users className="w-4 h-4 mr-2" />
              客户经营
            </div>
            {expandedGroups['crm'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          
          {expandedGroups['crm'] && (
            <div className="mt-1 space-y-1 pl-4">
              {hasPermission('NAV_INTEL') && inView('NAV_INTEL') && (
                <NavLink to="/intel" className={navClass} onClick={handleLinkClick}>情报雷达</NavLink>
              )}
              <NavLink to="/leads" className={navClass} onClick={handleLinkClick}>线索管理</NavLink>
              <NavLink to="/customers" className={navClass} onClick={handleLinkClick}>客户管理</NavLink>
              <NavLink to="/contracts" className={navClass} onClick={handleLinkClick}>合同管理</NavLink>
            </div>
          )}
        </div>
        )}

        {/* Delivery Group */}
        {hasPermission('NAV_DELIVERY') && (
        <div className="pt-2">
          <button 
            onClick={() => toggleGroup('delivery')}
            className="flex items-center justify-between w-full px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
          >
            <div className="flex items-center">
              <Briefcase className="w-4 h-4 mr-2" />
              项目交付
            </div>
            {expandedGroups['delivery'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          
          {expandedGroups['delivery'] && (
            <div className="mt-1 space-y-1 pl-4">
              <NavLink to="/projects" className={navClass} onClick={handleLinkClick}>项目管理</NavLink>
            </div>
          )}
        </div>
        )}

        {/* Finance Group */}
        {hasPermission('NAV_FINANCE') && inView('NAV_FINANCE') && (
        <div className="pt-2">
          <button 
            onClick={() => toggleGroup('finance')}
            className="flex items-center justify-between w-full px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
          >
            <div className="flex items-center">
              <DollarSign className="w-4 h-4 mr-2" />
              财务回款
            </div>
            {expandedGroups['finance'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          
          {expandedGroups['finance'] && (
            <div className="mt-1 space-y-1 pl-4">
              <NavLink to="/finance" end className={navClass} onClick={handleLinkClick}>回款概览</NavLink>
              <NavLink to="/finance/settlements" className={navClass} onClick={handleLinkClick}>顾问结算</NavLink>
            </div>
          )}
        </div>
        )}

        {/* Audit Group */}
        {hasPermission('NAV_AUDIT') && inView('NAV_AUDIT') && (
        <div className="pt-2">
          <button 
            onClick={() => toggleGroup('audit')}
            className="flex items-center justify-between w-full px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300"
          >
             <div className="flex items-center">
              <FileText className="w-4 h-4 mr-2" />
              审核与整改
            </div>
            {expandedGroups['audit'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
           {expandedGroups['audit'] && (
            <div className="mt-1 space-y-1 pl-4">
              <NavLink to="/audit" className={navClass} onClick={handleLinkClick}>
                <ClipboardCheck className="w-4 h-4 mr-3" />
                不符合项管理
              </NavLink>
            </div>
          )}
        </div>
        )}

         {/* Knowledge */}
         {hasPermission('NAV_KNOWLEDGE') && inView('NAV_KNOWLEDGE') && (
         <div className="pt-2">
           <NavLink to="/knowledge" className={navClass} onClick={handleLinkClick}>
            <BookOpen className="w-5 h-5 mr-3" />
            知识中心
          </NavLink>
         </div>
         )}
        
         {/* Strategy */}
         {hasPermission('NAV_STRATEGY') && inView('NAV_STRATEGY') && (
         <div className="pt-2">
           <NavLink to="/strategy" className={navClass} onClick={handleLinkClick}>
            <Target className="w-5 h-5 mr-3" />
            战略管理
          </NavLink>
         </div>
         )}

      </nav>

      {/* Settings */}
      <div className="p-4 border-t border-gray-800 flex-shrink-0">
        {canManageEmployees && (
          <>
            <NavLink to="/employees" className={navClass} onClick={handleLinkClick}>
              <UserCog className="w-5 h-5 mr-3" />
              员工账号
            </NavLink>
            <NavLink to="/auth-audit" className={navClass} onClick={handleLinkClick}>
              <FileClock className="w-5 h-5 mr-3" />
              审计日志
            </NavLink>
          </>
        )}
        {hasPermission('NAV_AI_CENTER') && inView('NAV_AI_CENTER') && (
          <NavLink to="/ai-center" className={navClass} onClick={handleLinkClick}>
            <Settings className="w-5 h-5 mr-3" />
            AI 配置中心
          </NavLink>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
