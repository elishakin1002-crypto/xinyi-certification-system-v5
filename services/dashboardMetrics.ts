import { Contract, Customer, Lead, Project, ProjectTask, ProjectWorkLog, RoleID, Settlement, Status, UserProfile } from '../types';
import { APP_ROUTES } from '../src/routes';
import { inferProjectMeta } from '../src/utils/projectCapabilities';
import { isOpenTask, isOverdue } from '../src/modules/taskFlow';
import { isUnownedProject, isUnownedName } from '../src/modules/ownership';
// 术语只有一份定义，见 src/modules/glossary.ts（口径也写在那里）
import { TERM_PROJECT, TERM_TASK, TERM_RECEIVABLE } from '../src/modules/glossary';
// 「我该做什么」只算一次，见 src/modules/myWork.ts
import { myActionableTasks } from '../src/modules/myWork';

export type DashboardRoleView = 'boss' | 'manager' | 'sales' | 'consultant' | 'finance';

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
  manager: RoleDashboardMetrics;
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

/**
 * 比率类指标：**分母为 0 时显示「暂无数据」，不显示 0.0%。**
 *
 * 2026-08-24 实测：老板工作台的「销售转化率」显示 0.0%，
 * 而真实情况是本月一条新线索都没有（455 条线索全是 6 月批量导入的），
 * 分母为 0，代码返回 0，界面就写成了 0.0%。
 *
 * 「没有线索进来」和「线索一条都没转化」是**完全相反的两个信号**：
 * 前者要查获客渠道，后者要找销售谈。显示成 0.0% 会把人引到错的方向。
 * 延误率、日志覆盖率同理——分母为 0 时都不该报 0%。
 */
const rate = (numerator: number, denominator: number) =>
  (Number(denominator) > 0 ? pct(Number(numerator) / Number(denominator)) : '暂无数据');


/*
  ── 「这条是不是我的」统一判定 ────────────────────────────────────
  优先看 ownerUserId，姓名只作为历史数据的兜底。

  2026-08-24 实测：销售视角的工作台**每一个指标都是 0**，
  而下面的风险列表有真实数据。根因是这里原来只按姓名匹配：

      myLeadSet = leads.filter(l =>
        l.followUpRecords.some(r => r.operator === me)   // 跟进人姓名
        || String(l.name) === me)                        // ← 线索的「联系人姓名」！

  第二个条件把**客户联系人的姓名**拿来和员工姓名比，本身就不成立；
  第一个条件要求这条线索已经有过跟进记录且操作人姓名完全一致。
  库里 455 条线索是批量导入的，没有跟进记录，于是销售看到的全是 0。

  更要紧的是：这套判定**完全不认 ownerUserId**，
  也就是不认 2026-08-21 建的归属机制（认领 / 指派）。
  销售认领了线索，工作台照样显示 0——归属做了等于没做。

  姓名匹配还有个长期问题：重名、改名、姓名带空格都会失效，
  而失效的表现是「数字变成 0」，没有任何报错。
*/
const ownedByUser = (
  entity: { ownerUserId?: string; ownerName?: string; owner?: string; manager?: string } | null | undefined,
  user: { id?: string; name?: string }
): boolean => {
  if (!entity) return false;
  const uid = String(user?.id || '').trim();
  const uname = String(user?.name || '').trim();
  const owner = String((entity as any).ownerUserId || '').trim();
  if (uid && owner) return owner === uid;          // 有归属就以归属为准
  if (!uname) return false;
  // 历史数据兜底：这些字段存的是姓名
  return [(entity as any).ownerName, (entity as any).owner, (entity as any).manager]
    .some(v => String(v || '').trim() === uname);
};

const normalizeName = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
const taskOwner = (task: ProjectTask, userName: string) => String(task?.owner || '') === userName;
/**
 * 项目是不是我的：负责人是我，或者我在这个项目上有任务。
 * 两个条件都要——只看负责人会漏掉多顾问协作的项目，
 * 这个口径和服务端 authorize.js 的 inScope 保持一致，
 * 两边不一致会出现「工作台说是我的、服务端说不是」。
 */
const projectIsMine = (project: Project, userName: string, user?: { id?: string; name?: string }) =>
  (user ? ownedByUser(project as any, user) : false)
  || String(project.manager || '') === userName
  || (project.tasks || []).some(task => taskOwner(task, userName));

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
  // 总助看老板视图（团队产能与执行才是他的活），与 Layout 的 roleToPersona 保持一致。
  // 两处不一致会出现「侧栏按老板渲染、工作台按销售渲染」的错位。
  if (activeRole === 'MANAGER') return 'boss';
  const tags = (currentUser.positionTags || []).join(' ');
  if (/销售/i.test(tags) && !/负责人|老板|总经理/i.test(tags)) return 'sales';
  return 'boss';
};

/**
 * 在制项目 —— **排除已停用的「售前跟进」旧类别**。
 *
 * ── 为什么（2026-09-11）────────────────────────────────────────
 *
 * 金恩来 2026-09-08 说「还在争取的客户不该放进项目」，
 * FollowUp 于是退出项目管理、标成 legacy、新建不出来了。
 * 但**指标这一侧一直没跟着改** —— 库里还躺着 8 个 Active 的
 * 「XX 认证到期挖角跟进」，它们照旧被算进：
 *
 *   · 在制项目总数      虚高
 *   · 人均在制项目数    分子虚高
 *   · 本周日志覆盖率    分母虚高 → 覆盖率被拉低
 *   · 项目延误率        分母虚高，而它们永远不会被人去做
 *
 * 这就是坑 #23 说的「改分类字段时最容易漏的是连带」：
 * 类别改掉了、界面改掉了、**统计口径忘了改**，
 * 于是每个数字都偏一点，而没人看得出偏在哪。
 *
 * 为什么改代码而不是把那 8 个项目归档：
 * 系统里根本没有「已归档」这个状态，硬塞只能改成「已完成」——
 * 而它们**没有完成**，那是在账本上写假话。
 * 排除一个已经停用的类别，是说实话且对未来同类数据一并生效。
 */
const isLiveProject = (p: Project) => p.status === Status.Active && p.projectCategory !== 'FollowUp';

/**
 * 未完成任务 —— **只数在制项目里的**，而且用统一的 isOpenTask。
 *
 * ── 2026-09-11 发现的两处口径错 ────────────────────────────────
 *
 * 原来是 `inputs.projects.flatMap(p => p.tasks).filter(t => t.status !== 'Completed')`，
 * 有两个问题：
 *
 * ① **从全部项目里数**，包括已完成的项目。
 *    一个项目结项了，它里面没勾完的任务不该再算成「未完成任务」——
 *    那是历史，不是欠账。改完在制项目口径后这条立刻显形：
 *    工作台上出现「在制项目 0 个，未完成任务 70 条」，人完全看不懂那 70 条在哪。
 *
 * ② **没排除 Skipped**。跳过是主动的决定（客户自行处理、标准变更），
 *    不是欠账。把它算进「未完成」，等于让人对着一个永远清不掉的数字发愁，
 *    而且延误率的分母也跟着虚高。
 *    统一用 src/modules/taskFlow.ts 的 isOpenTask，不在这里另写一套判断。
 */
const openTasksOf = (projects: Project[]) =>
  projects.filter(isLiveProject).flatMap(p => p.tasks || []).filter(isOpenTask);

const buildBossMetrics = (inputs: Inputs, monthKey: string): RoleDashboardMetrics => {
  const now = nowDate();
  const activeProjects = inputs.projects.filter(isLiveProject);
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

  /*
    「人均」的分母只能是**真人**，分子只能是**已认领的项目**。

    2026-09-17 Codex 交叉复核：界面显示 3.00 —— 9 个项目除以
    「验收顾问、黄佳佳、待指派」三个"人"。而「待指派」是占位词不是员工。
    真实承载量是 8 个已认领项目 ÷ 2 个人 = 4.00，差了整整一档。
    它的原话很准：「标题写『人均』，不应默默把占位词当员工。」

    原来只挡空字符串（`.filter(Boolean)`），这是嘉力那次的同款判空 ——
    收口在 ownership.ts，这里跟着走。
  */
  const claimedProjects = activeProjects.filter(p => !isUnownedProject(p as any));
  const owners = Array.from(new Set(
    claimedProjects.map(p => String(p.manager || '').trim()).filter(name => name && !isUnownedName(name))
  ));
  const avgInProgress = owners.length > 0 ? claimedProjects.length / owners.length : 0;
  const openTasks = openTasksOf(inputs.projects);
  const delayedTasks = openTasks.filter(t => isOverdue(t, now.getTime()));   // 判逾期只用 taskFlow.isOverdue 一份
  /** 进行中、且名下有逾期任务的项目 —— 口径见 glossary 的 TERM_PROJECT.withOverdueTask */
  const delayedProjects = activeProjects.filter(p => (p.tasks || []).some(t => isOpenTask(t) && isOverdue(t, now.getTime())));
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  /*
    本周日志覆盖率 = 在制项目中本周有日志的比例。

    **分子必须限定在「在制项目」里**，否则和分母不是同一个总体。
    2026-08-24 实测：卡片显示 18.8%，点进去下钻列表是「共 0 个项目」——
    因为分子把已完结项目、乃至已删除的演示项目（日志里有 4 个这样的 projectId）
    都算了进来，而下钻只看在制项目。数字和列表在构造上就不可能一致。

    工作日志主要在任务完成时产生，有日志的项目多半已经完结，
    所以这个偏差不是小数点问题，是能把 0% 显示成 18.8% 的量级。
    老板据此判断「团队有没有在记录」，错的方向还偏乐观。
  */
  const activeProjectIds = new Set(activeProjects.map(p => String(p.id)));
  const weekLogProjects = new Set(
    inputs.projectWorkLogs
      .filter(log => parseDate(log.logDate) >= weekStart.getTime())
      .map(log => String(log.projectId))
      .filter(id => activeProjectIds.has(id))
  );

  const topRiskList: DashboardListItem[] = [
    ...inputs.contracts
      .filter(c => contractUnpaidOverdueAmount(c, now) > 0)
      .slice(0, 3)
      .map(c => ({
        id: `risk-contract-${c.id}`,
        title: `${c.customerName} 回款逾期`,
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
      { id: 'boss-overdue-amt', title: `${TERM_RECEIVABLE.overdue}金额`, value: money(overdueAmount), route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: 'boss-conv', title: '销售转化率（线索→营收项目）', value: rate(monthLeadRevenueProjects.length, monthLeads.length), route: `${APP_ROUTES.LEADS}?filter=conversion` }
    ],
    middleCards: [
      { id: 'boss-near-overdue', title: '即将逾期合同', value: String(nearOverdueContracts), route: `${APP_ROUTES.CONTRACTS}?due=7d` },
      { id: 'boss-high-risk-project', title: '高风险项目', value: String(highRiskProjects), route: `${APP_ROUTES.PROJECTS}?risk=high` },
      { id: 'boss-overdue-receivable', title: `${TERM_RECEIVABLE.overdue}清单`, value: String(overdueReceivableCount), route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: 'boss-customer-churn', title: '客户流失预警', value: String(churnCustomers), route: `${APP_ROUTES.CUSTOMERS}?filter=churn` }
    ],
    bottomCards: [
      { id: 'boss-capacity', title: `人均${TERM_PROJECT.active}数`, value: avgInProgress.toFixed(2), route: `${APP_ROUTES.PROJECTS}?view=team` },
      /*
        ── 「项目延误率」要数项目，不是数任务（2026-09-16 修）──────────

        这张卡原来算的是 rate(delayedTasks, openTasks) —— **任务**的比例，
        标题却写「**项目**延误率」。库里 3 条逾期任务 / 10 条未完成任务
        显示成 30.0%，而实际是 2 个项目里有 2 个出了问题（100%）。
        老板照这个数字判断"团队还好"，其实手上每个项目都在延。

        和 2026-09-16 上午修的项目卡片是同一类：
        **标签念出来，和它旁边那个数字对不上**。
        而且它左右两张卡（人均进行中项目数、本周日志覆盖率）都是项目口径，
        夹在中间的这张数任务，人更不会察觉。

        口径用术语表的 TERM_PROJECT.withOverdueTask：
        进行中、且名下有逾期任务的项目 ÷ 进行中项目。
      */
      { id: 'boss-delay-rate', title: '项目延误率', value: rate(delayedProjects.length, activeProjects.length), route: `${APP_ROUTES.PROJECTS}?filter=delay` },
      // 必须带 range=7d：不带的话下钻看的是「任何时候有日志的项目」，
      // 而指标算的是本周，点进去的列表和卡片上的数字对不上。
      { id: 'boss-log-coverage', title: '本周日志覆盖率', value: rate(weekLogProjects.size, activeProjects.length), route: `${APP_ROUTES.PROJECTS}?tab=logs&range=7d` }
    ],
    listItems: topRiskList
  };
};


/*
  ── 总助工作台（2026-09-05 新建）─────────────────────────────

  在这之前总助看的是总经理那套看板。理由当时写的是「她不拥有线索，
  销售那套数字对她永远是 0」—— 这话没错，但结论选错了：
  她该有自己的一套，而不是借用老板的。

  借用老板看板的后果是**每天第一眼看到的都不是她能动的事**：
  本月签约金额、已回款金额、回款风险 —— 这些她既不负责也无权处理
  （权限矩阵里她没有确认到账和结算）。**看得见但动不了的数字，
  比看不见更糟**：它占着最显眼的位置，把她真正该盯的挤到下面去了。

  她的活是「代总经理统筹派活与进度」，所以这套看板回答三个问题：

    谁手上活太多 · 哪个项目要延期 · 这周谁没记日志

  **刻意不放任何金额。** 不是怕她看到（她有查看合同金额的权限），
  是因为钱不是她能推动的事 —— 放在这里只会分散注意力。
  她要看金额，去合同管理页看。
*/
const buildManagerMetrics = (inputs: Inputs): RoleDashboardMetrics => {
  const now = nowDate();
  // 和老板那套用同一个口径 —— 两边数字对不上是这个项目最高频的 bug 形态
  const activeProjects = inputs.projects.filter(isLiveProject);

  /*
    没人认领的项目 —— 这是她最该先处理的一类：没人认领就没人推进。

    口径必须走 ownership.ts，不许在这里自己判空。
    2026-09-17 跑交叉复核时这张卡显示 0，而库里明明躺着一个负责人是
    「待指派」的项目 —— 因为这里原来写的是
        !String(p.manager || '').trim()
    只认**空字符串**。于是**这张专门用来发现"没人认领的项目"的卡片，
    恰恰看不见没人认领的项目**；而新手引导还在教总助
    「『待指派负责人』不为零，先处理这个」（steps.ts）。

    这就是嘉力那次的同款：判空写成枚举几个已知的词，别人换个说法就漏。
    2026-09-15 已经为此收口出 isUnownedProject，这个文件当时漏掉了 ——
    「改一处漏一处」。
  */
  const unassigned = activeProjects.filter(p => isUnownedProject(p as any));

  const openTasks = openTasksOf(inputs.projects);
  const overdueTasks = openTasks.filter(t => isOverdue(t, now.getTime()));   // 同上：一份实现
  const dueSoonTasks = openTasks.filter(t => {
    const d = diffDays(t.deadline, now);
    return d >= 0 && d <= 3;
  });

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  /*
    分子必须限定在「在制项目」里，否则和分母不是同一个总体。
    2026-08-24 在老板看板上踩过：卡片 18.8%，点进去列表 0 个项目。
  */
  const activeIds = new Set(activeProjects.map(p => String(p.id)));
  const weekLogProjects = new Set(
    inputs.projectWorkLogs
      .filter(log => parseDate(log.logDate) >= weekStart.getTime())
      .map(log => String(log.projectId))
      .filter(id => activeIds.has(id))
  );

  /*
    每个人手上多少活。**按负责人分组，不取平均** ——
    「人均 3.67 个」这种数字对派活毫无用处：
    可能是 5 个人各 3-4 个（正常），也可能是 1 个人扛 11 个、
    另外 4 个人各 0 个（要立刻调）。平均值恰好把这两种情况混成一个数。
  */
  /*
    「谁手上活多少」「有活在手的人」只数真人。
    2026-09-17 之前「待指派」会作为一行出现在负责人列表里，
    并把「有活在手的人」从 2 抬到 3 —— 总助据此判断谁该加活、谁该减活，
    多出来的那个"人"会让她低估每个人的实际承载。
    没人认领的项目归「待指派负责人」那张卡管，不该混进人头统计。
  */
  const loadByOwner = new Map<string, number>();
  activeProjects.forEach(p => {
    if (isUnownedProject(p as any)) return;
    const owner = String(p.manager || '').trim();
    if (!owner || isUnownedName(owner)) return;
    loadByOwner.set(owner, (loadByOwner.get(owner) || 0) + 1);
  });
  const loads = Array.from(loadByOwner.entries()).sort((a, b) => b[1] - a[1]);
  const busiest = loads[0];

  const stuckList: DashboardListItem[] = [
    ...unassigned.slice(0, 3).map(p => ({
      id: `mgr-unassigned-${p.id}`,
      title: `${p.name} 还没有负责人`,
      subtitle: '没人认领就没人推进，这是最该先处理的一类',
      route: `${APP_ROUTES.PROJECTS}?projectId=${encodeURIComponent(p.id)}`
    })),
    ...activeProjects
      .filter(p => (p.tasks || []).some(t => isOverdue(t, now.getTime())))
      .slice(0, 4)
      .map(p => ({
        id: `mgr-overdue-${p.id}`,
        title: `${p.name} 有任务已逾期`,
        subtitle: `负责人：${String(p.manager || '未指派')}`,
        route: `${APP_ROUTES.PROJECTS}?filter=delay&projectId=${encodeURIComponent(p.id)}`
      })),
  ].slice(0, 6);

  return {
    topCards: [
      { id: 'mgr-unassigned', title: '待指派负责人', value: String(unassigned.length),
        hint: '没人认领的项目不会自己往前走', route: `${APP_ROUTES.PROJECTS}?filter=unassigned` },
      { id: 'mgr-overdue-task', title: TERM_TASK.overdue, value: String(overdueTasks.length),
        hint: '过了截止日还没完成的', route: `${APP_ROUTES.PROJECTS}?filter=delay` },
      { id: 'mgr-due-soon', title: '三天内到期任务', value: String(dueSoonTasks.length),
        hint: '现在提醒还来得及', route: `${APP_ROUTES.PROJECTS}?filter=duesoon` },
      { id: 'mgr-log-coverage', title: '本周日志覆盖率',
        value: rate(weekLogProjects.size, activeProjects.length),
        hint: '低不代表偷懒，多半是某个环节太麻烦',
        route: `${APP_ROUTES.PROJECTS}?tab=logs&range=7d` }
    ],
    middleCards: loads.slice(0, 8).map(([owner, n]) => ({
      id: `mgr-load-${owner}`,
      title: owner,
      value: String(n),
      hint: busiest && n === busiest[1] && loads.length > 1 ? '手上最多' : '',
      route: `${APP_ROUTES.PROJECTS}?owner=${encodeURIComponent(owner)}`
    })),
    bottomCards: [
      { id: 'mgr-active', title: TERM_PROJECT.active, value: String(activeProjects.length),
        route: `${APP_ROUTES.PROJECTS}?view=team` },
      { id: 'mgr-people', title: '有活在手的人', value: String(loads.length),
        route: `${APP_ROUTES.PROJECTS}?view=team` },
      { id: 'mgr-open-task', title: TERM_TASK.open, value: String(openTasks.length),
        route: `${APP_ROUTES.PROJECTS}?filter=open` }
    ],
    listItems: stuckList
  };
};

const buildSalesMetrics = (inputs: Inputs, monthKey: string): RoleDashboardMetrics => {
  const now = nowDate();
  const me = String(inputs.currentUser.name || '');
  const user = inputs.currentUser;
  /*
    「我的线索」：先看归属，再看跟进记录。
    删掉了原来的 `String(lead.name) === me`——那是拿线索联系人的姓名
    和员工姓名比，任何情况下都不该成立。
  */
  const myLeadSet = inputs.leads.filter(lead =>
    ownedByUser(lead as any, user)
    || (lead.followUpRecords || []).some(r => String(r.operator || '') === me)
  );
  const myLeadIds = new Set(myLeadSet.map(l => l.id));
  const myMonthLeads = myLeadSet.filter(l => isLeadInMonth(l, monthKey)).length;
  const myFollowups = [
    ...inputs.leads.flatMap(l => l.followUpRecords || []),
    ...inputs.customers.flatMap(c => c.followUpRecords || [])
  ].filter(f => String(f.operator || '') === me && inMonth(f.date, monthKey)).length;

  const myContracts = inputs.contracts.filter(c => {
    if (ownedByUser(c as any, user)) return true;
    // 合同本身没归属时，看它关联的项目归谁
    const linked = inputs.projects.find(p => p.contractRef === c.id || p.contractRef === c.contractNo);
    return linked ? ownedByUser(linked as any, user) : false;
  });
  const myMonthSignedAmount = myContracts
    .filter(c => inMonth(c.signDate, monthKey))
    .reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const myMonthLeadRevenueProjects = inputs.projects.filter(p => {
    if (!isLeadSourcedRevenueProject(p)) return false;
    if (projectCompleteMonthKey(p) !== monthKey) return false;
    const leadId = resolveLeadIdFromProject(p);
    if (leadId && myLeadIds.has(leadId)) return true;
    return ownedByUser(p as any, user);
  });

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
      { id: 'sales-conversion', title: '个人转化率（线索→营收项目）', value: rate(myMonthLeadRevenueProjects.length, myMonthLeads), route: `${APP_ROUTES.LEADS}?owner=me&filter=conversion` }
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
  const myProjects = inputs.projects.filter(p => projectIsMine(p, me, inputs.currentUser));
  const myActiveProjects = myProjects.filter(isLiveProject);   // 同上：口径必须一致
  const myTaskPairs = myProjects.flatMap(project => (project.tasks || []).map(task => ({ project, task })))
    .filter(({ task }) => taskOwner(task, me));
  /*
    ── 已结项项目里的残留任务，不算「逾期任务」（2026-09-15 推翻了原设计）──

    这里原来的注释写着「**故意**不限定在制项目 —— 他确实还得去处理或跳过」。
    那个"故意"是错的，金恩来的截图把后果摆了出来：

        当前在制项目数  0        ← 他名下项目全结项了
        逾期任务数      5        ← 却还有 5 条红色的逾期任务
        （项目管理那边的同名统计是 0，因为它只算进行中项目）

    于是顾问每天打开工作台，看到一个**永远消不掉的红色 5**，
    点进去还找不到对应的项目。两个后果，第二个更贵：
      · 他不知道该做什么
      · **他开始不信任所有红色数字** —— 而真正紧急的那条也在红色里

    已结项项目里没勾完的任务，本质是**结项时收尾没做干净的记录问题**，
    该在结项那一刻处理（完结清单就是干这个的），
    不该天天挂在人的日常待办上。

    所以「我的逾期任务」只算**进行中项目**里的 —— 和项目管理那边同口径。
    残留任务在项目详情里照样看得到，不会丢。
  */
  /*
    2026-09-15 下午：这段逻辑搬进 src/modules/myWork.ts 了。

    上午我在这里加了「只算进行中项目」，**却没去改
    MyWorkWidget 和 MyTasks** —— 于是同一屏上「逾期任务 0」
    和「我今天的活 5 条已逾期」并存，比原来更糟。

    现在三处都从 myWork.ts 取，数字必然一致，不靠谁记得同步。
  */
  const myOpenTasksInActive = myActionableTasks(inputs.projects, { name: me })
    .map(({ task, project }) => ({ task, project }));
  const myOpenTasks = myTaskPairs.filter(({ task }) => isOpenTask(task));
  /*
    用 taskFlow.isOverdue，不要自己拿 diffDays 再判一遍（2026-09-14）。

    这里原来写的是 `diffDays(task.deadline, now) < 0`，
    而 taskFlow.isOverdue 的规则是「截止日当天结束才算逾期」——
    两者在「今天到期」上结论相反。
    于是工作台数出 5 条逾期，点进项目管理一条都看不到。

    全系统判逾期只留 taskFlow.isOverdue 这一份。
  */
  const myOverdueTasks = myOpenTasksInActive.filter(({ task }) => isOverdue(task, now.getTime()));
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
      { id: 'cons-active-project', title: TERM_PROJECT.active, value: String(myActiveProjects.length), route: `${APP_ROUTES.PROJECTS}?owner=me&status=active` },
      { id: 'cons-overdue-task', title: TERM_TASK.overdue, value: String(myOverdueTasks.length), route: `${APP_ROUTES.PROJECTS}?owner=me&task=overdue` },
      { id: 'cons-week-completed', title: '本周完成任务数', value: String(weekCompletedTasks), route: `${APP_ROUTES.PROJECTS}?owner=me&task=completed&range=7d` },
      { id: 'cons-customer-confirm', title: '客户待确认事项', value: String(pendingCustomerConfirm), route: `${APP_ROUTES.PROJECTS}?owner=me&task=customer_confirm` }
    ],
    middleCards: [
      { id: 'cons-due-soon', title: TERM_TASK.dueSoon, value: String(myDueSoonTasks.length), route: `${APP_ROUTES.PROJECTS}?owner=me&task=due_7d` },
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
  /*
    ── 这个数是「结算草稿」，不是「未开票」（2026-09-17 改名）────────

    它数的是 settlements 里 status === 'draft' 的条数：
    既没有判断发票，也没有按项目去重，更没有"项目"这个维度。
    而卡片原来叫「未开票项目」—— 财务照这个数字去催开票，
    催的是一批根本还没确认的结算单。

    这个系统里**没有发票字段**（Settlement 类型里只有
    type/beneficiary/contractRef/month/amount/status/notes），
    所以真正的"未开票"现在算不出来。算不出来就别起那个名字。
    真要做，得先有发票数据，不能拿草稿顶替。

    Codex 2026-09-16 排查出来的，我核过代码属实。
  */
  const draftSettlements = inputs.settlements.filter(s => s.status === 'draft').length;
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
    title: `${item.customerName} 逾期应收`,
    subtitle: `${money(item.amount)} · 到期 ${item.dueDate || '未知'}`,
    route: `${APP_ROUTES.FINANCE}?status=overdue&contractId=${encodeURIComponent(item.contractId)}`
  }));

  return {
    topCards: [
      { id: 'fin-month-rec', title: '本月应收', value: money(monthReceivable), route: `${APP_ROUTES.FINANCE}?month=this&view=receivable` },
      { id: 'fin-month-paid', title: '本月已收', value: money(monthPaid), route: `${APP_ROUTES.FINANCE}?month=this&view=paid` },
      { id: 'fin-overdue', title: TERM_RECEIVABLE.overdue, value: money(overdueAmount), hint: `${overdueItems.length} 单`, route: `${APP_ROUTES.FINANCE}?status=overdue` },
      { id: 'fin-next30', title: '未来30天预计回款', value: money(expected30), route: `${APP_ROUTES.FINANCE}?range=30d` }
    ],
    middleCards: [
      { id: 'fin-missing-amt', title: '合同金额缺失项目', value: String(missingContractAmountProjects), route: `${APP_ROUTES.PROJECTS}?filter=missing_contract_amount` },
      { id: 'fin-rec-no-contract', title: '存在回款但无合同总额', value: String(receivableWithoutContractAmount), route: `${APP_ROUTES.FINANCE}?filter=no_contract_amount` },
      { id: 'fin-uninvoiced', title: '待确认结算单', value: String(draftSettlements), route: `${APP_ROUTES.FINANCE}?tab=settlements&status=draft` },
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
    manager: buildManagerMetrics(inputs),
    sales: buildSalesMetrics(inputs, monthKey),
    consultant: buildConsultantMetrics(inputs),
    finance: buildFinanceMetrics(inputs, monthKey)
  };
};
