
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
  FileClock, ListTodo } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ROLE_PERMISSIONS, ROLE_CAPABILITIES, PERSONA_TO_ROLE } from '../constants';
import { ActionCode, PermissionCode, RoleID } from '../types';

interface SidebarProps {
  onClose?: () => void;
  className?: string;
}

/*
  看板视角 → 角色。和 AppContext 里那份保持同一套映射。
  没有从 AppContext 导出复用，是因为那边是内部常量；
  这里只读不写，重复一份比为它开一个导出面更省事。
  两边不一致的后果只是预览显示不准，不影响权限。
*/
const Sidebar: React.FC<SidebarProps> = ({ onClose, className = '' }) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'crm': true,
    'delivery': true,
    'finance': true,
    'audit': true
  });
  const { hasPermission, activeRole, currentUser, previewPersona, checkActionPermission } = useApp();

  /*
    ── 预览视角时，侧边栏也要跟着变（2026-09-04 修）────────────

    问题：巡检账号（总经理 / 系统管理员）切到「咨询顾问（仅看板）」，
    **只有工作台变了，左边导航一动不动** ——
    财务回款、战略管理、AI 配置中心照样列在那里。

    于是这个「巡检」功能就废了一半：它本来是用来确认
    「顾问打开系统到底看到什么」的，而看到的却不是顾问看到的那一套。

    原因：切「仅看板」的视角只写了 URL 上的 ?persona=，没有动 activeRole，
    而侧边栏是按 activeRole 过滤的。

    ── 这不会放大任何权限 ────────────────────────────────────
    下面每一项都是 hasPermission(真实权限) && inView(视角) 双重判断。
    预览只会让菜单**变少**，不会变多 ——
    切到「总经理视角」的顾问，仍然看不到财务，因为第一道闸拦着。
  */
  const viewRole: RoleID = (previewPersona && PERSONA_TO_ROLE[previewPersona])
    ? PERSONA_TO_ROLE[previewPersona]
    : activeRole;

  const inView = (permission: PermissionCode) => ROLE_PERMISSIONS[viewRole]?.includes(permission);
  /** 动作版的 inView：这个视角的角色有没有这个动作 */
  const actionInView = (action: ActionCode) =>
    Boolean(ROLE_CAPABILITIES[viewRole]?.actions?.includes(action));

  /*
    ── 账号管理 / 审计日志入口（2026-09-04 改）──────────────────

    原来写的是 currentUser.roles.some(r => r === 'ADMIN' || r === 'SYS_ADMIN')，
    有两个毛病：

    1）**绕过了视角预览。**其他每一项都是 hasPermission && inView 双闸，
       只有这两项直接读真实角色。结果是切到「顾问视角」时，
       导航里照样挂着「员工账号」「审计日志」——
       看上去像是所有人都能看到，其实同事那边是看不到的，
       但巡检功能本来就是用来确认「同事看到什么」的，它骗了人。

    2）**又写死了一份角色名单。**权限矩阵里已经有 EMPLOYEE_VIEW /
       AUTH_AUDIT_VIEW 了，这里再列一遍角色，两份必然漂移 ——
       这个月给总助加账号管理权限，就得记得回来改这里，没人会记得。

    现在两项都按动作判断：真实权限一闸，预览视角一闸。
  */
  const canManageEmployees =
    checkActionPermission('EMPLOYEE_VIEW').allowed && actionInView('EMPLOYEE_VIEW');
  const canViewAuthAudit =
    checkActionPermission('AUTH_AUDIT_VIEW').allowed && actionInView('AUTH_AUDIT_VIEW');

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
        {/*
          ── 个人视角的两项放最上面，不进任何分组（2026-09-08 调整）──

          金恩来：「导航栏也会显得干净简单一些」—— 目标是对的，
          但他的方案（把我的任务并进项目管理当开关）会把最高频的入口藏起来。

          换了一刀：**工作台和我的任务是「个人视角」，不是业务模块**，
          所以它们不该待在业务分组里。提到最上面并列，
          原来的「项目交付」组就只剩项目管理一个孩子，正好打平。

          成熟工具都是这么摆的：Asana 的 My Tasks、Linear 的 My Issues、
          Jira 的 Your work，全是侧边栏顶级项 —— 没有一个藏进项目列表。
        */}
        <NavLink data-onboard="nav-dashboard" to="/dashboard" className={navClass} onClick={handleLinkClick}>
          <LayoutDashboard className="w-5 h-5 mr-3" />
          工作台
        </NavLink>
        {hasPermission('NAV_DELIVERY') && inView('NAV_DELIVERY') && (
          <NavLink data-onboard="nav-my-tasks" to="/my-tasks" className={navClass} onClick={handleLinkClick}>
            <ListTodo className="w-5 h-5 mr-3" />
            我的任务
          </NavLink>
        )}

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
                <NavLink data-onboard="nav-intel" to="/intel" className={navClass} onClick={handleLinkClick}>情报雷达</NavLink>
              )}
              <NavLink data-onboard="nav-leads" to="/leads" className={navClass} onClick={handleLinkClick}>线索管理</NavLink>
              <NavLink data-onboard="nav-customers" to="/customers" className={navClass} onClick={handleLinkClick}>客户管理</NavLink>
              <NavLink data-onboard="nav-contracts" to="/contracts" className={navClass} onClick={handleLinkClick}>合同管理</NavLink>
            </div>
          )}
        </div>
        )}

        {/* 项目管理：原来是「项目交付」分组，组里只剩它一个孩子，打平（2026-09-08）*/}
        {hasPermission('NAV_DELIVERY') && inView('NAV_DELIVERY') && (
        <div className="pt-2">
          <NavLink data-onboard="nav-projects" to="/projects" className={navClass} onClick={handleLinkClick}>
            <Briefcase className="w-5 h-5 mr-3" />
            项目管理
          </NavLink>
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
              <NavLink data-onboard="nav-finance" to="/finance" end className={navClass} onClick={handleLinkClick}>回款概览</NavLink>
              <NavLink data-onboard="nav-settlements" to="/finance/settlements" className={navClass} onClick={handleLinkClick}>顾问结算</NavLink>
            </div>
          )}
        </div>
        )}

        {/* 不符合项管理：原来是「审核与整改」分组，只有一个孩子，打平（2026-09-08）*/}
        {hasPermission('NAV_AUDIT') && inView('NAV_AUDIT') && (
        <div className="pt-2">
          <NavLink data-onboard="nav-audit" to="/audit" className={navClass} onClick={handleLinkClick}>
            <ClipboardCheck className="w-5 h-5 mr-3" />
            不符合项管理
          </NavLink>
        </div>
        )}

         {/* Knowledge */}
         {hasPermission('NAV_KNOWLEDGE') && inView('NAV_KNOWLEDGE') && (
         <div className="pt-2">
           <NavLink data-onboard="nav-knowledge" to="/knowledge" className={navClass} onClick={handleLinkClick}>
            <BookOpen className="w-5 h-5 mr-3" />
            知识中心
          </NavLink>
         </div>
         )}
        
         {/* Strategy */}
         {hasPermission('NAV_STRATEGY') && inView('NAV_STRATEGY') && (
         <div className="pt-2">
           <NavLink data-onboard="nav-strategy" to="/strategy" className={navClass} onClick={handleLinkClick}>
            <Target className="w-5 h-5 mr-3" />
            战略管理
          </NavLink>
         </div>
         )}

      </nav>

      {/* Settings */}
      <div className="p-4 border-t border-gray-800 flex-shrink-0">
        {canManageEmployees && (
          <NavLink data-onboard="nav-employees" to="/employees" className={navClass} onClick={handleLinkClick}>
            <UserCog className="w-5 h-5 mr-3" />
            员工账号
          </NavLink>
        )}
        {canViewAuthAudit && (
          <NavLink data-onboard="nav-auth-audit" to="/auth-audit" className={navClass} onClick={handleLinkClick}>
            <FileClock className="w-5 h-5 mr-3" />
            审计日志
          </NavLink>
        )}
        {hasPermission('NAV_AI_CENTER') && inView('NAV_AI_CENTER') && (
          <NavLink data-onboard="nav-ai-center" to="/ai-center" className={navClass} onClick={handleLinkClick}>
            <Settings className="w-5 h-5 mr-3" />
            AI 配置中心
          </NavLink>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
