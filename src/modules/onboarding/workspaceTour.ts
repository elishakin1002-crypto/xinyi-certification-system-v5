import { RoleID } from '../../../types';
import { OnboardTour } from './steps';

// 第一层只建立全貌；填单步骤留在模块帮助，避免同一件事讲三遍。
const roles: Record<RoleID, [string, string]> = {
  SYS_ADMIN: ['系统管理员', '你关注系统运行、账号权限和使用情况。业务页面帮助你了解同事的工作环境。'],
  ADMIN: ['总经理', '你关注客户、交付和经营结果，通过各模块了解进展与需要协调的事项。'],
  MANAGER: ['总助', '你关注客户衔接、项目安排和团队协作，帮助各岗位把工作交接清楚。'],
  SALES: ['销售', '你关注线索与客户跟进，也可以查看交付进展，及时回应客户。'],
  CONSULTANT: ['咨询顾问', '你关注服务交付、自己的任务与审核进展，客户和合同提供业务背景。'],
  FINANCE: ['财务', '你关注合同金额、收付款和开票，客户与项目帮助你核对款项对应的业务。'],
};
const tours = Object.fromEntries(Object.entries(roles).map(([role, [name, description]]) => [role, {
  version: 10,
  intro: `先认识你的工作台，再按需要了解具体模块。\n\n你当前的岗位是**${name}**。${description}`,
  steps: [
    { route: '/dashboard', target: 'nav-dashboard', title: '工作台：每天从这里了解进展', body: `${description}\n\n工作台汇总与你岗位相关的待办和进展，具体业务记录放在对应模块里。不同岗位看到的内容会有所不同。` },
    { target: 'nav-leads', title: '左侧导航：按业务找到入口', body: '导航是系统的目录，只显示当前视角可见的模块。客户业务关注线索、客户和合同；项目交付关注项目、任务与服务进度。\n\n电脑从左侧进入，手机从左上角菜单进入。切换页面不会改变账号权限。' },
    { target: 'nav-projects', title: '各模块怎样衔接', body: '线索记录合作机会，客户档案汇集往来信息，合同记录合作约定。项目组织服务交付，任务落实到具体人员；财务记录款项与开票。\n\n这些模块通过关联信息衔接，查看范围和可执行操作由岗位权限决定。' },
    { route: '/dashboard', target: 'workspace-content', title: '中间工作区：当前模块的内容', body: '选中模块后，内容在这里展开。顶部通常是概况和筛选，中间是列表或看板，详情窗口展示某一笔业务。\n\n想知道当前页面的使用顺序，打开帮助，选择「了解当前模块」。' },
    { target: role === 'SYS_ADMIN' ? 'nav-employees' : role === 'FINANCE' ? 'nav-finance' : 'nav-my-tasks', title: role === 'SYS_ADMIN' ? '账号与权限：维护同事的工作入口' : role === 'FINANCE' ? '财务管理：核对业务与款项' : '我的任务：找到自己负责的工作', body: role === 'SYS_ADMIN' ? '员工账号用于维护人员和职责。账号权限决定能看哪些内容、能执行哪些操作；预览其他岗位只是查看对应视角。' : role === 'FINANCE' ? '财务页面集中查看收付款和开票情况，并关联客户、合同等业务信息。合同金额、已收款和已开票各有含义，不能互相代替。' : '我的任务集中显示分配给你的工作，项目管理展示整项服务的全貌。两处关联同一批任务，方便从个人工作回到项目背景。' },
    { target: 'help', title: '需要帮助时，随时回来', body: '「认识我的工作台」看系统全貌。\n\n「了解当前模块」看用途、工作顺序和区域分工。\n\n「解释这一项」点选具体按钮、字段或数据，只解释你选中的内容。' },
  ],
}])) as Record<RoleID, OnboardTour>;

export function getWorkspaceTour(userRoles: RoleID[] | undefined): OnboardTour | null {
  const role = (['SYS_ADMIN', 'ADMIN', 'MANAGER', 'FINANCE', 'CONSULTANT', 'SALES'] as RoleID[])
    .find(item => userRoles?.includes(item));
  return role ? tours[role] : null;
}
