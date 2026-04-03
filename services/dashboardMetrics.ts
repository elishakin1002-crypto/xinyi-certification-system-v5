import { Contract, Customer, Lead, Project, ProjectTask, ProjectWorkLog, RoleID, Settlement, Status, UserProfile } from '../types';
import { APP_ROUTES } from '../src/routes';
import { inferProjectMeta } from '../src/utils/projectCapabilities';

export type DashboardRoleView = 'boss' | 'sales' | 'consultant' | 'finance';

export interface DashboardCard {
  id: string;
  title: string;
  value: string;
  hint?: string;
  route: string;
}

export interface DashboardListItem {
  id: string;
  title: string;
  subtitle?: string;
  route: string;
}

export interface RoleDashboardMetrics {
  topCards: DashboardCard[];
  middleCards: DashboardCard[];
  bottomCards: DashboardCard[];
  listItems: DashboardListItem[];
}

export interface DashboardMetricsBundle {
  roleView: DashboardRoleView;
  monthKey: string;
  boss: RoleDashboardMetrics;
  sales: RoleDashboardMetrics;
  consultant: RoleDashboardMetrics;
  finance: RoleDashboardMetrics;
}

type Inputs = {
  leads: Lead[];
  customers: Customer[];
  contracts: Contract[];
  projects: Project[];
  projectWorkLogs: ProjectWorkLog[];
  settlements: Settlement[];
  currentUser: UserProfile;
  activeRole: RoleID;
};

const nowDate = () => new Date();
const currentMonthKey = (date = nowDate()) => date.toISOString().slice(0, 7);
const parseDate = (value?: string) => {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : NaN;
};
const diffDays = (dateText?: string, base = nowDate()) => {
  const ts = parseDate(dateText);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.floor((ts - base.getTime()) / (24 * 3600 * 1000));
};
const inMonth = (dateText: string | undefined, monthKey: string) => String(dateText || '').startsWith(monthKey);
const money = (n: number) => `¥${(Number(n || 0)).toFixed(2)}`;
const pct = (n: number) => `${(Number(n || 0) * 100).toFixed(1)}%`;

const normalizeName = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
const taskOwner = (task: ProjectTask, userName: string) => String(task?.owner || '') === userName;
const projectIsMine = (project: Project, userName: string) =>
  String(project.manager || '') === userName || (project.tasks || []).some(task => taskOwner(task, userName));

const contractPaidAmount = (contract: Contract) =>
  (contract.receivables || [])
    .filter(r => r.status === 'paid')
    .reduce((acc, r) => acc + Number(r.amount || 0), 0);

const contractUnpaidOverdueAmount = (contract: Contract, base = nowDate()) =>
  (contract.receivables || [])
    .filter(r => r.status !== 'paid' && diffDays(r.dueDate, base) < 0)
    .reduce((acc, r) => acc + Number(r.amount || 0), 0);

const isRevenueProject = (project: Project): boolean => {
  const meta = inferProjectMeta(project);
  if (meta.projectMode !== 'delivery') return false;
  if (project.status !== Status.Completed) return false;
  if ((project as any).isRevenueProject === false) return false;
  return true;
};

const isLeadSourcedRevenueProject = (project: Project): boolean => {
  if (!isRevenueProject(project)) return false;
  const meta = inferProjectMeta(project);
  return meta.sourceType === 'lead';
};

const projectCompleteMonthKey = (project: Project): string => {
  const actualEndDate = String(project.completionRecord?.actualEndDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(actualEndDate)) return actualEndDate.slice(0, 7);
  const completedAt = String(project.completionRecord?.completedAt || '').trim();
  const completedAtTs = Date.parse(completedAt);
  if (Number.isFinite(completedAtTs)) return new Date(completedAtTs).toISOString().slice(0, 7);
  return '';
};

const resolveLeadIdFromProject = (project: Project): string => {
  const meta = inferProjectMeta(project);
  if (meta.sourceType !== 'lead') return '';
  return String(meta.sourceRef || '').trim();
};

const isLeadInMonth = (lead: Lead, monthKey: string): boolean => {
  const idRaw = String(lead.id || '');
  const idTs = Number(idRaw.split('-')[1]);
  if (Number.isFinite(idTs) && idTs > 0) {
    return new Date(idTs).toISOString().slice(0, 7) === monthKey;
  }
  return inMonth(lead.lastContact, monthKey);
};

const resolveDashboardRoleView = (currentUser: UserProfile, activeRole: RoleID): DashboardRoleView => {
  if (activeRole === 'FINANCE') return 'finance';
  if (activeRole === 'CONSULTANT') return 'consultant';
  if (activeRole === 'MANAGER') return 'sales';
  const tags = (currentUser.positionTags || []).join(' ');
  if (/销售/i.test(tags) && !/负责人|老板|总经理/i.test(tags)) return 'sales';
  return 'boss';
};

const buildBossMetrics = (inputs: Inputs, monthKey: string): RoleDashboardMetrics => {
  const now = nowDate();
  const activeProjects = inputs.projects.filter(p => p.status === Status.Active);
  const monthContracts = inputs.contracts.filter(c => inMonth(c.signDate, monthKey));
  const monthContractAmount = monthContracts.reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const monthPaid = inputs.contracts.reduce((acc, c) => {
    const paidThisMonth = (c.receivables || [])
      .filter(r => r.status === 'paid' && inMonth(r.dueDate, monthKey))
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
    return acc + paidThisMonth;
  }, 0);
  const overdueAmount = inputs.contracts.reduce((acc, c) => acc + contractUnpaidOverdueAmount(c, now), 0);
  const monthLeads = inputs.leads.filter(l => isLeadInMonth(l, monthKey));
  const monthLeadRevenueProjects = inputs.projects.filter(p =>
    isLeadSourcedRevenueProject(p) && projectCompleteMonthKey(p) === monthKey
  );
  const conversionRate = monthLeads.length > 0 ? (monthLeadRevenueProjects.length / monthLeads.length) : 0;

  const nearOverdueContracts = inputs.contracts.filter(c =>
    (c.receivables || []).some(r => r.status !== 'paid' && diffDays(r.dueDate, now) >= 0 && diffDays(r.dueDate, now) <= 7)
  ).length;
  const highRiskProjects = activeProjects.filter(p => p.aiInsight?.riskLevel === 'High' || p.status === Status.Risk).length;
  const overdueReceivableCount = inputs.contracts.reduce((acc, c) =>
    acc + (c.receivables || []).filter(r => r.status !== 'paid' && diffDays(r.dueDate, now) < 0).length, 0
  );
  const churnCustomers = inputs.customers.filter(c => {
    const dates = (c.followUpRecords || []).map(f => parseDate(f.date)).filter(Number.isFinite);
    if (dates.length === 0) return true;
    const latest = Math.max(...dates);
    return (now.getTime() - latest) / (24 * 3600 * 1000) > 45;
  }).length;

  const owners = Array.from(new Set(activeProjects.map(p => String(p.manager || '').trim()).filter(Boolean)));
  const avgInProgress = owners.length > 0 ? activeProjects.length / owners.length : 0;
  const openTasks = inputs.projects.flatMap(p => p.tasks || []).filter(t => t.status !== 'Completed');
  const delayedTasks = openTasks.filter(t => diffDays(t.deadline, now) < 0);
  const delayedRate = openTasks.length > 0 ? delayedTasks.length / openTasks.length : 0;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  const weekLogProjects = new Set(
    inputs.projectWorkLogs
      .filter(log => parseDate(log.logDate) >= weekStart.getTime())
      .map(log => log.projectId)
  );
  const logCoverage = activeProjects.length > 0 ? weekLogProjects.size / activeProjects.length : 0;

  const topRiskList: DashboardListItem[] = [
    ...inputs.contracts
      .filter(c => contractUnpaidOverdueAmount(c, now) > 0)
      .slice(0, 3)
      .map(c => ({
        id: `risk-contract-${c.id}`,
        title: `${c.customerName} 回款超期`,
        subtitle: `${money(contractUnpaidOverdueAmount(c, now))} · 合同 ${c.contractNo || c.title}`,
        route: `${APP_ROUTES.FINANCE}?status=overdue&contractId=${encodeURIComponent(c.id)}`
      })),
    ...activeProjects
      .filter(p => p.aiInsight?.riskLevel === 'High' || p.status === Status.Risk)
      .slice(0, 3)
      .map(p => ({
        id: `risk-project-${p.id}`,
        title: `高风险项目：${p.name}`,
        subtitle: `负责人：${p.manager}`,
        route: `${APP_ROUTES.PROJECTS}?risk=high&projectId=${encodeURIComponent(p.id)}`
      }))
  ].slice(0, 6);

  return {
    topCards: [
      { id: 'boss-month-contract', title: '本月新增合同金额', value: money(monthContractAmount), route: `${APP_ROUTES.CONTRACTS}?month=this` },
      { id: 'boss-month-paid', title: '本月已回款金额', value: money(monthPaid), route: `${APP_ROUTES.FINANCE}?month=this&view=paid` },
      { id: 'boss-overdue-amt', title: '回款风险金额（超期）', value: money(overdueAmount), route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: 'boss-conv', title: '销售转化率（线索→营收项目）', value: pct(conversionRate), route: `${APP_ROUTES.LEADS}?filter=conversion` }
    ],
    middleCards: [
      { id: 'boss-near-overdue', title: '即将逾期合同', value: String(nearOverdueContracts), route: `${APP_ROUTES.CONTRACTS}?due=7d` },
      { id: 'boss-high-risk-project', title: '高风险项目', value: String(highRiskProjects), route: `${APP_ROUTES.PROJECTS}?risk=high` },
      { id: 'boss-overdue-receivable', title: '应收超期清单', value: String(overdueReceivableCount), route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: 'boss-customer-churn', title: '客户流失预警', value: String(churnCustomers), route: `${APP_ROUTES.CUSTOMERS}?filter=churn` }
    ],
    bottomCards: [
      { id: 'boss-capacity', title: '人均在制项目数', value: avgInProgress.toFixed(2), route: `${APP_ROUTES.PROJECTS}?view=team` },
      { id: 'boss-delay-rate', title: '项目延误率', value: pct(delayedRate), route: `${APP_ROUTES.PROJECTS}?filter=delay` },
      { id: 'boss-log-coverage', title: '本周日志覆盖率', value: pct(logCoverage), route: `${APP_ROUTES.PROJECTS}?tab=logs` }
    ],
    listItems: topRiskList
  };
};

const buildSalesMetrics = (inputs: Inputs, monthKey: string): RoleDashboardMetrics => {
  const now = nowDate();
  const me = String(inputs.currentUser.name || '');
  const myLeadSet = inputs.leads.filter(lead =>
    (lead.followUpRecords || []).some(r => String(r.operator || '') === me) || String(lead.name || '') === me
  );
  const myLeadIds = new Set(myLeadSet.map(l => l.id));
  const myMonthLeads = myLeadSet.filter(l => isLeadInMonth(l, monthKey)).length;
  const myFollowups = [
    ...inputs.leads.flatMap(l => l.followUpRecords || []),
    ...inputs.customers.flatMap(c => c.followUpRecords || [])
  ].filter(f => String(f.operator || '') === me && inMonth(f.date, monthKey)).length;

  const myContracts = inputs.contracts.filter(c => {
    const owner = String((c as any).owner || '').trim();
    if (owner) return owner === me;
    const linked = inputs.projects.find(p => p.contractRef === c.id || p.contractRef === c.contractNo);
    return linked ? String(linked.manager || '') === me : false;
  });
  const myMonthSignedAmount = myContracts
    .filter(c => inMonth(c.signDate, monthKey))
    .reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const myMonthLeadRevenueProjects = inputs.projects.filter(p => {
    if (!isLeadSourcedRevenueProject(p)) return false;
    if (projectCompleteMonthKey(p) !== monthKey) return false;
    const leadId = resolveLeadIdFromProject(p);
    if (leadId && myLeadIds.has(leadId)) return true;
    return String(p.manager || '') === me;
  });
  const personalConversionRate = myMonthLeads > 0 ? myMonthLeadRevenueProjects.length / myMonthLeads : 0;

  const staleLeads = myLeadSet.filter(l => diffDays(l.lastContact, now) < -7);
  const hotLeads = myLeadSet.filter(l => l.intent === 'High' && l.status !== Status.Converted).slice(0, 5);
  const sleepingCustomers = inputs.customers.filter(c => {
    const last = (c.followUpRecords || []).filter(r => String(r.operator || '') === me).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!last) return false;
    return diffDays(last.date, now) < -30;
  });
  const repurchaseCustomers = inputs.customers.filter(c => Number(c.serviceCount || 0) >= 2 || Number(c.cooperationCount || 0) >= 2);
  const expiringContracts = myContracts.filter(c =>
    (c.receivables || []).some(r => r.status !== 'paid' && diffDays(r.dueDate, now) >= 0 && diffDays(r.dueDate, now) <= 15)
  );

  const todayActionList: DashboardListItem[] = [
    ...hotLeads.slice(0, 3).map(l => ({
      id: `sales-hot-${l.id}`,
      title: `今日优先联系：${l.company}`,
      subtitle: `意向${l.intent} · 最近联系 ${l.lastContact || '未知'}`,
      route: `${APP_ROUTES.LEADS}?owner=me&leadId=${encodeURIComponent(l.id)}`
    })),
    ...staleLeads.slice(0, 2).map(l => ({
      id: `sales-stale-${l.id}`,
      title: `超过7天未跟进：${l.company}`,
      subtitle: `最后联系 ${l.lastContact || '未知'}`,
      route: `${APP_ROUTES.LEADS}?owner=me&stale=7d&leadId=${encodeURIComponent(l.id)}`
    })),
    ...myContracts
      .filter(c => c.status === Status.Pending || (c.receivables || []).every(r => r.status !== 'paid'))
      .slice(0, 2)
      .map(c => ({
        id: `sales-contract-${c.id}`,
        title: `待签/待推进合同：${c.customerName}`,
        subtitle: `${money(Number(c.amount || 0))} · ${c.contractNo || c.title}`,
        route: `${APP_ROUTES.CONTRACTS}?owner=me&contractId=${encodeURIComponent(c.id)}`
      }))
  ].slice(0, 8);

  return {
    topCards: [
      { id: 'sales-new-leads', title: '本月新增线索', value: String(myMonthLeads), route: `${APP_ROUTES.LEADS}?owner=me&month=this` },
      { id: 'sales-followups', title: '本月有效跟进次数', value: String(myFollowups), route: `${APP_ROUTES.CUSTOMERS}?owner=me&tab=followups` },
      { id: 'sales-sign-amt', title: '本月签约金额', value: money(myMonthSignedAmount), route: `${APP_ROUTES.CONTRACTS}?owner=me&month=this` },
      { id: 'sales-conversion', title: '个人转化率（线索→营收项目）', value: pct(personalConversionRate), route: `${APP_ROUTES.LEADS}?owner=me&filter=conversion` }
    ],
    middleCards: [
      { id: 'sales-hot', title: '即将成交客户', value: String(hotLeads.length), route: `${APP_ROUTES.LEADS}?owner=me&intent=high` },
      { id: 'sales-stale', title: '超过7天未跟进', value: String(staleLeads.length), route: `${APP_ROUTES.LEADS}?owner=me&stale=7d` },
      { id: 'sales-sleeping', title: '沉睡客户（30天）', value: String(sleepingCustomers.length), route: `${APP_ROUTES.CUSTOMERS}?owner=me&filter=sleeping30` },
      { id: 'sales-repeat', title: '可复购客户', value: String(repurchaseCustomers.length), route: `${APP_ROUTES.CUSTOMERS}?owner=me&filter=repurchase` },
      { id: 'sales-expiring', title: '合同即将到期', value: String(expiringContracts.length), route: `${APP_ROUTES.CONTRACTS}?owner=me&due=15d` }
    ],
    bottomCards: [
      { id: 'sales-today-contact', title: '今日必须联系客户', value: String(hotLeads.length), route: `${APP_ROUTES.LEADS}?owner=me&today=contact` },
      { id: 'sales-pending-quote', title: '待报价客户', value: String(myLeadSet.filter(l => l.status === Status.Pending).length), route: `${APP_ROUTES.LEADS}?owner=me&status=pending` },
      { id: 'sales-pending-sign', title: '待签合同', value: String(myContracts.filter(c => c.status === Status.Pending).length), route: `${APP_ROUTES.CONTRACTS}?owner=me&status=pending` }
    ],
    listItems: todayActionList
  };
};

const buildConsultantMetrics = (inputs: Inputs): RoleDashboardMetrics => {
  const now = nowDate();
  const me = String(inputs.currentUser.name || '');
  const myProjects = inputs.projects.filter(p => projectIsMine(p, me));
  const myActiveProjects = myProjects.filter(p => p.status === Status.Active);
  const myTaskPairs = myProjects.flatMap(project => (project.tasks || []).map(task => ({ project, task })))
    .filter(({ task }) => taskOwner(task, me));
  const myOpenTasks = myTaskPairs.filter(({ task }) => task.status !== 'Completed');
  const myOverdueTasks = myOpenTasks.filter(({ task }) => diffDays(task.deadline, now) < 0);
  const myDueSoonTasks = myOpenTasks.filter(({ task }) => diffDays(task.deadline, now) >= 0 && diffDays(task.deadline, now) <= 7);
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 6);
  const myWeekLogs = inputs.projectWorkLogs.filter(log => String(log.operatorName || '') === me && parseDate(log.logDate) >= thisWeekStart.getTime());
  const weekCompletedTasks = myWeekLogs.filter(log => log.source === 'task_transition').length;
  const weekHours = myWeekLogs.reduce((acc, log) => acc + Number(log.actualHours || 0), 0);
  const pendingCustomerConfirm = myOpenTasks.filter(({ task }) => /确认|回传|审核|签字|盖章/.test(String(task.title || ''))).length;
  const belowHalfProjects = myActiveProjects.filter(p => Number(p.progress || 0) < 50);

  const projectTaskBucket: Record<string, number> = {};
  myOpenTasks.forEach(({ project }) => {
    projectTaskBucket[project.id] = (projectTaskBucket[project.id] || 0) + 1;
  });
  const mostStacked = Object.entries(projectTaskBucket).sort((a, b) => b[1] - a[1])[0];
  const mostStackedProject = mostStacked ? myProjects.find(p => p.id === mostStacked[0]) : null;

  const listItems: DashboardListItem[] = myOverdueTasks.slice(0, 8).map(({ project, task }) => ({
    id: `consultant-overdue-${task.id}`,
    title: `逾期任务：${task.title}`,
    subtitle: `${project.name} · 截止 ${task.deadline}`,
    route: `${APP_ROUTES.PROJECTS}?owner=me&task=overdue&projectId=${encodeURIComponent(project.id)}`
  }));

  return {
    topCards: [
      { id: 'cons-active-project', title: '当前在制项目数', value: String(myActiveProjects.length), route: `${APP_ROUTES.PROJECTS}?owner=me&status=active` },
      { id: 'cons-overdue-task', title: '逾期任务数', value: String(myOverdueTasks.length), route: `${APP_ROUTES.PROJECTS}?owner=me&task=overdue` },
      { id: 'cons-week-completed', title: '本周完成任务数', value: String(weekCompletedTasks), route: `${APP_ROUTES.PROJECTS}?owner=me&task=completed&range=7d` },
      { id: 'cons-customer-confirm', title: '客户待确认事项', value: String(pendingCustomerConfirm), route: `${APP_ROUTES.PROJECTS}?owner=me&task=customer_confirm` }
    ],
    middleCards: [
      { id: 'cons-due-soon', title: '即将到期任务', value: String(myDueSoonTasks.length), route: `${APP_ROUTES.PROJECTS}?owner=me&task=due_7d` },
      { id: 'cons-stacked-project', title: '任务堆积最多项目', value: mostStackedProject ? `${mostStackedProject.name}` : '暂无数据', route: `${APP_ROUTES.PROJECTS}?owner=me&focus=stacked` },
      { id: 'cons-below-half', title: '服务进度低于50%项目', value: String(belowHalfProjects.length), route: `${APP_ROUTES.PROJECTS}?owner=me&progress=lt50` }
    ],
    bottomCards: [
      { id: 'cons-week-logs', title: '本周日志条数', value: String(myWeekLogs.length), route: `${APP_ROUTES.PROJECTS}?owner=me&tab=logs&range=7d` },
      { id: 'cons-week-hours', title: '本周工时统计', value: `${weekHours.toFixed(1)}h`, route: `${APP_ROUTES.PROJECTS}?owner=me&tab=logs&metric=hours` },
      { id: 'cons-join-project', title: '参与项目数', value: String(new Set(myWeekLogs.map(l => l.projectId)).size), route: `${APP_ROUTES.PROJECTS}?owner=me` }
    ],
    listItems
  };
};

const buildFinanceMetrics = (inputs: Inputs, monthKey: string): RoleDashboardMetrics => {
  const now = nowDate();
  const receivables = inputs.contracts.flatMap(contract => (contract.receivables || []).map(r => ({
    contractId: contract.id,
    customerName: contract.customerName,
    amount: Number(r.amount || 0),
    dueDate: r.dueDate,
    status: r.status,
    contractAmount: Number(contract.amount || 0),
    contractNo: contract.contractNo || contract.title
  })));

  const monthReceivable = receivables.filter(r => inMonth(r.dueDate, monthKey)).reduce((acc, r) => acc + r.amount, 0);
  const monthPaid = receivables.filter(r => r.status === 'paid' && inMonth(r.dueDate, monthKey)).reduce((acc, r) => acc + r.amount, 0);
  const overdueItems = receivables.filter(r => r.status !== 'paid' && diffDays(r.dueDate, now) < 0);
  const overdueAmount = overdueItems.reduce((acc, r) => acc + r.amount, 0);
  const expected30 = receivables
    .filter(r => r.status !== 'paid' && diffDays(r.dueDate, now) >= 0 && diffDays(r.dueDate, now) <= 30)
    .reduce((acc, r) => acc + r.amount, 0);

  const missingContractAmountProjects = inputs.projects.filter(p => p.projectCategory === 'Delivery' && Number(p.projectAmount || 0) <= 0).length;
  const receivableWithoutContractAmount = inputs.contracts.filter(c => Number(c.amount || 0) <= 0 && (c.receivables || []).some(r => Number(r.amount || 0) > 0)).length;
  const uninvoiced = inputs.settlements.filter(s => s.status === 'draft').length;
  const abnormalProgress = inputs.contracts.filter(c => {
    const total = Number(c.amount || 0);
    const paid = contractPaidAmount(c);
    const overdue = contractUnpaidOverdueAmount(c, now);
    if (total > 0 && paid > total) return true;
    return total > 0 && overdue / total > 0.5;
  }).length;

  const industryPaidMap: Record<string, number> = {};
  inputs.contracts.forEach(c => {
    const customer = inputs.customers.find(x => normalizeName(x.name) === normalizeName(c.customerName));
    const industry = String(customer?.industry || '未分类');
    industryPaidMap[industry] = (industryPaidMap[industry] || 0) + contractPaidAmount(c);
  });
  const paidSum = Object.values(industryPaidMap).reduce((acc, val) => acc + val, 0);
  const topIndustry = Object.entries(industryPaidMap).sort((a, b) => b[1] - a[1])[0];
  const bigCustomerPaid: Record<string, number> = {};
  inputs.contracts.forEach(c => {
    bigCustomerPaid[c.customerName] = (bigCustomerPaid[c.customerName] || 0) + contractPaidAmount(c);
  });
  const sortedCustomerPaid = Object.entries(bigCustomerPaid).sort((a, b) => b[1] - a[1]);
  const top1Ratio = paidSum > 0 && sortedCustomerPaid.length > 0 ? sortedCustomerPaid[0][1] / paidSum : 0;
  const top3 = sortedCustomerPaid.slice(0, 3).reduce((acc, [, value]) => acc + value, 0);
  const concentration = paidSum > 0 ? top3 / paidSum : 0;

  const listItems: DashboardListItem[] = overdueItems.slice(0, 8).map((item, idx) => ({
    id: `finance-overdue-${item.contractId}-${idx}`,
    title: `${item.customerName} 超期应收`,
    subtitle: `${money(item.amount)} · 到期 ${item.dueDate || '未知'}`,
    route: `${APP_ROUTES.FINANCE}?status=overdue&contractId=${encodeURIComponent(item.contractId)}`
  }));

  return {
    topCards: [
      { id: 'fin-month-rec', title: '本月应收', value: money(monthReceivable), route: `${APP_ROUTES.FINANCE}?month=this&view=receivable` },
      { id: 'fin-month-paid', title: '本月已收', value: money(monthPaid), route: `${APP_ROUTES.FINANCE}?month=this&view=paid` },
      { id: 'fin-overdue', title: '超期金额', value: money(overdueAmount), hint: `${overdueItems.length} 单`, route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: 'fin-next30', title: '未来30天预计回款', value: money(expected30), route: `${APP_ROUTES.FINANCE}?range=30d` }
    ],
    middleCards: [
      { id: 'fin-missing-amt', title: '合同金额缺失项目', value: String(missingContractAmountProjects), route: `${APP_ROUTES.PROJECTS}?filter=missing_contract_amount` },
      { id: 'fin-rec-no-contract', title: '存在回款但无合同总额', value: String(receivableWithoutContractAmount), route: `${APP_ROUTES.FINANCE}?filter=no_contract_amount` },
      { id: 'fin-uninvoiced', title: '未开票项目', value: String(uninvoiced), route: `${APP_ROUTES.FINANCE}?filter=uninvoiced` },
      { id: 'fin-abnormal', title: '回款进度异常', value: String(abnormalProgress), route: `${APP_ROUTES.FINANCE}?filter=progress_abnormal` }
    ],
    bottomCards: [
      { id: 'fin-industry', title: '回款来源行业分布', value: topIndustry ? `${topIndustry[0]} ${pct(topIndustry[1] / Math.max(paidSum, 1))}` : '暂无数据', route: `${APP_ROUTES.FINANCE}?analysis=industry` },
      { id: 'fin-big-customer', title: '大客户占比', value: pct(top1Ratio), route: `${APP_ROUTES.FINANCE}?analysis=big_customer` },
      { id: 'fin-concentration', title: '回款集中度（Top3）', value: pct(concentration), route: `${APP_ROUTES.FINANCE}?analysis=concentration` }
    ],
    listItems
  };
};

export const buildDashboardMetrics = (inputs: Inputs): DashboardMetricsBundle => {
  const monthKey = currentMonthKey();
  return {
    roleView: resolveDashboardRoleView(inputs.currentUser, inputs.activeRole),
    monthKey,
    boss: buildBossMetrics(inputs, monthKey),
    sales: buildSalesMetrics(inputs, monthKey),
    consultant: buildConsultantMetrics(inputs),
    finance: buildFinanceMetrics(inputs, monthKey)
  };
};
