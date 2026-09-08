import type { RoleID } from '../../../types';
import type { GuideEntry } from './pageGuide';

export type RolePageGuide = GuideEntry & { result?: string; empty?: string };
const dashboard: Record<RoleID, {what: string; order: string[]}> = {
  SALES: {what: '销售工作台汇总客户跟进和个人待办，帮助你决定今天先联系谁。', order: ['先看今天要跟进的线索与个人待办', '进入线索详情，了解上次联系结果', '实际联系后补记录，回到线索核对后续安排']},
  CONSULTANT: {what: '顾问工作台汇总与你相关的交付和任务。每天先确认期限，再处理具体工作。', order: ['先看近期到期与超期工作', '进入「我的任务」，找到自己的任务', '到所属项目了解要求，实际完成后更新记录']},
  FINANCE: {what: '财务工作台汇总应收、回款与待处理事项，帮助你找到需要核对的款项。', order: ['先看应收、逾期及待处理事项', '进入回款概览，查客户和合同', '核实实际收款后处理，再回列表核对结果']},
  MANAGER: {what: '总助工作台帮助你看团队安排和需要协调的工作，找到谁需要支持。', order: ['先看团队工作分布和待协调事项', '进入具体项目，核对负责人和任务期限', '与负责同事确认安排，再跟踪项目中的实际进展']},
  ADMIN: {what: '总经理工作台汇总经营与交付风险。先找需要关注的事项，再看业务明细。', order: ['先看业务、回款风险与交付情况', '进入相应模块，核对具体客户、合同或项目', '明确跟进同事，之后回到业务记录检查结果']},
  SYS_ADMIN: {what: '管理员工作台集中查看系统错误、反馈和运行情况，帮助你判断是否影响同事工作。', order: ['先查看错误与同事反馈，确认影响范围', '按页面、账号和时间核查问题', '确认处理结果后，回到原反馈更新进展']},
};
const outcomes: Record<string, {result: string; empty: string}> = {
  '/dashboard': {result: '具体结果在来源模块里核对：任务看项目或「我的任务」，款项看回款概览，系统问题看对应反馈。', empty: '没有待办时，可进入日常模块查看实际列表；没有记录并不需要新建练习数据。'},
  '/leads': {result: '保存后在当前线索列表和详情中确认联系人、跟进记录及后续安排。', empty: '先检查搜索和筛选；没有分配线索时联系负责同事，有真实新机会再录入。'},
  '/customers': {result: '回到客户列表搜索企业名称，打开档案核对联系人及关联业务。', empty: '先确认企业是否已有档案，避免因为筛选或名称差异重复建立。'},
  '/projects': {result: '在项目列表确认项目，再打开详情核对服务、负责人、任务和工作日志。', empty: '先检查筛选范围和实际安排；「样例」只用于说明界面，不是待办。'},
  '/my-tasks': {result: '在「我的任务」检查状态，再打开所属项目核对同一项任务与记录。', empty: '先确认查看范围和负责人安排；没有分配任务时联系项目负责人。'},
  '/contracts': {result: '回到合同列表查看客户、金额、付款安排和关联信息，核对是否与真实合同一致。', empty: '先查搜索及筛选，再确认合同是否已录入；历史补录与新签合同使用不同入口。'},
  '/finance': {result: '回到回款列表核对这笔款的状态、客户和合同；实际收款依据仍需核实。', empty: '先核对合同与付款安排是否录入，不要用确认样例的方式练习。'},
  '/employees': {result: '回到员工列表核对账号状态和岗位。让本人验证实际可用范围，预览不改变权限。', empty: '核对人员信息与职责后再建立真实账号，不为熟悉界面重复开账号。'},
  '/knowledge': {result: '在列表或搜索结果中重新找到资料，打开确认内容与适用范围。', empty: '换用企业行业、服务或资料关键词查询；仍没有时向负责同事确认现有模板。'},
  '/audit': {result: '回到对应不符合项，核对整改进展、期限与证据。', empty: '只有真实审核发现才需要记录，不根据样例制造整改事项。'},
};

export function adaptPageGuide(path: string, base: GuideEntry | null, role: RoleID): RolePageGuide | null {
  if (!base) return null;
  if (path === '/finance/settlements' || path.startsWith('/finance/settlements/')) return {
    title: '顾问结算', what: '核对顾问结算对象、项目与明细；它和客户回款是两项工作。',
    order: ['先找到待核对记录，确认顾问和所属项目', '查看明细与来源，有差异先核实', '符合实际情况后按权限处理，再回列表检查状态'],
    areas: [{name: '结算列表', role: '查找对象与当前处理状态。'}, {name: '结算明细', role: '核对具体项目和依据，不能只看合计金额。'}],
    result: '处理后回到结算列表核对记录状态及说明。', empty: '先确认筛选与来源业务是否具备结算记录，不手工补造练习款项。',
  };
  const key = Object.keys(outcomes).find(key => path === key || path.startsWith(key + '/'));
  const guide: RolePageGuide = {...base, ...(key ? outcomes[key] : {})};
  if (path === '/dashboard') return {...guide, ...dashboard[role], areas: [{name: '岗位概况', role: '这里的内容随岗位变化，反映当前职责关心的情况。'}, {name: '待办与明细入口', role: '从概况进入对应业务；最终结果仍在来源模块核对。'}], misread: '角色视角只帮助理解界面，实际操作范围仍由账号权限决定。'};
  if (path === '/leads') guide.order = ['先搜索企业，查看已有线索及跟进记录，避免重复录入', '确有新线索时点「新增线索」，填写真实资料后点「保存线索」', '实际联系后更新跟进记录和后续安排，回到详情核对'];
  if (path === '/projects') {
    if (role === 'SALES' || role === 'FINANCE') guide.order = ['找到与客户或合同关联的项目', '打开项目查看服务、负责人和进度', '需要调整时联系负责同事，再查看实际更新结果'];
    else if (role === 'CONSULTANT') guide.order = ['找到你负责的项目，查看服务要求与任务', '实际工作后更新任务，并核对项目中的工作日志', '回到项目详情确认进展与记录，不重复补已存在的日志'];
    else guide.order = ['先查已有项目，确认客户、服务与负责人', '确有新工作时用「新建项目」，按窗口说明立项', '在项目详情安排任务、核对期限，之后跟踪实际进度'];
  }
  if (path === '/my-tasks' && (role === 'MANAGER' || role === 'ADMIN')) guide.order = ['先看自己的任务，再按需要切到「我派出去的」', '从任务打开所属项目，核对负责人、期限与要求', '根据实际情况跟进，回到任务或项目查看更新'];
  return guide;
}
