import { ProjectTask } from '../../types';

/**
 * 任务的状态与先后顺序 —— 只写这一份。
 *
 * ══════════════════════════════════════════════════════════════
 * 一、为什么要有「进行中」（2026-09-08）
 * ══════════════════════════════════════════════════════════════
 *
 * 原来只有「未完成 / 已完成」。但「还没开始」和「在做但没做完」
 * 对管理者是**完全不同的信号**：
 *   还没开始 → 这活还没排上，可能是忘了，也可能是在等别人
 *   在做     → 有人扛着，做不完是卡住了，要问的是卡在哪
 *
 * 这两种情况原来在系统里长得一模一样，于是总助那块
 * 「谁手上活太多」看到的其实是个混合数：有人是真忙，
 * 有人只是名下堆了一堆根本没开始的活。
 *
 * ══════════════════════════════════════════════════════════════
 * 二、为什么要有前置任务
 * ══════════════════════════════════════════════════════════════
 *
 * ISO 交付有硬顺序：体系文件没定稿 → 内审做不了 → 管理评审开不了
 * → 不能报认证。这个顺序原来只存在于顾问脑子里，新人接手就断了。
 *
 * **加它的价值不是画甘特图。** 甘特图对 13 个人的公司是负担。
 * 真正的价值有两条：
 *   ① 一个任务延期时，能立刻说出后面哪几件跟着延 ——
 *      客户问「还要多久」时给得出有依据的答案；
 *   ② 有人想勾一个前置还没做完的任务时，提醒他一句 ——
 *      而不是等外审现场才发现顺序反了。
 *
 * ── 是提醒，不是禁止 ────────────────────────────────────────
 *
 * 前置没做完照样可以勾完成，只是会问一句。理由和「跳过要填原因」
 * 是同一个：**强制不会让人按顺序做事，只会让人绕过系统做事**。
 * 现实里确实存在并行推进、客户那边先给了材料这类情况。
 */

export type TaskStatus = ProjectTask['status'];

export const TASK_STATUS_META: Record<TaskStatus, {
  label: string;
  /** 一句话说明这个状态意味着什么 */
  hint: string;
  tone: 'gray' | 'blue' | 'emerald' | 'amber';
}> = {
  Pending: { label: '待开始', hint: '还没动手。堆太多说明活没排开', tone: 'gray' },
  InProgress: { label: '进行中', hint: '有人正扛着。做不完是卡住了，要问卡在哪', tone: 'blue' },
  Completed: { label: '已完成', hint: '做完了。勾上会自动记一条工作日志', tone: 'emerald' },
  Skipped: { label: '已跳过', hint: '主动决定不做，理由已记录', tone: 'amber' },
};

/** 还没了结的（跳过算了结 —— 人已经交代过原因了） */
export const isOpenTask = (t: Pick<ProjectTask, 'status'>) =>
  t.status !== 'Completed' && t.status !== 'Skipped';

/**
 * 已超期。跳过的不算 —— 那是主动的决定，不是欠账。
 *
 * ── 「今天到期」不算超期（2026-09-14 走查抓到）─────────────────
 *
 * 原来写的是 `d < now`：
 *   截止日 '2026-09-14' 被 new Date() 解析成 2026-09-14T00:00:00Z，
 *   而 now 是当天任意时刻 —— **只要过了零点，今天到期的任务就是"已超期"**。
 *
 * 后果很具体：新建项目时第一个任务的 offsetDays 是 0（截止日=今天），
 * 于是刚点完「确认立项」，页面上立刻出现「已超期」和
 * 「有任务卡住的项目 1」。人会以为自己漏做了什么。
 *
 * 截止日期是**日**不是**时刻**：说好今天交，今天下班前都不算迟。
 * 所以比的是「截止日那天的 23:59:59」——过了那一刻才算超期。
 */
export const isOverdue = (t: Pick<ProjectTask, 'status' | 'deadline'>, now = Date.now()) => {
  if (!isOpenTask(t)) return false;
  const raw = String(t.deadline || '').trim();
  if (!raw) return false;
  const d = new Date(raw).getTime();
  if (!Number.isFinite(d)) return false;
  // 只有日期没有时刻时，把截止点推到那天结束；带时刻的按原值比
  const endOfDueDay = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? d + 24 * 3600 * 1000 - 1 : d;
  return endOfDueDay < now;
};

/**
 * 挡在这个任务前面、还没做完的前置任务。
 *
 * 返回空数组 = 可以开工。
 */
export const blockingPrerequisites = (task: ProjectTask, all: ProjectTask[]): ProjectTask[] => {
  const ids = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  if (ids.length === 0) return [];
  return all.filter(t => ids.includes(t.id) && isOpenTask(t));
};

/** 在等这个任务的下游任务 —— 它一延期，这些跟着延 */
export const dependentTasks = (task: ProjectTask, all: ProjectTask[]): ProjectTask[] =>
  all.filter(t => Array.isArray(t.dependsOn) && t.dependsOn.includes(task.id));

/**
 * 这个任务能不能当前置。
 *
 * 不能选自己，也不能选「已经在等我的人」——否则两个任务互相等，
 * 谁都开不了工，而界面上看不出为什么。
 */
export const canBePrerequisite = (candidate: ProjectTask, target: ProjectTask, all: ProjectTask[]): boolean => {
  if (candidate.id === target.id) return false;
  // 顺着 candidate 的依赖往上找，如果能走到 target，说明会成环
  const seen = new Set<string>();
  const reaches = (t: ProjectTask): boolean => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    const ids = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    if (ids.includes(target.id)) return true;
    return all.filter(x => ids.includes(x.id)).some(reaches);
  };
  return !reaches(candidate);
};

/**
 * 一个任务延到某天，会把哪些下游任务挤到期限之后。
 *
 * 只看直接下游 —— 再往下推是连锁反应，对 13 个人的公司来说
 * 一层已经够用，而且**一层能说清、两层就没人看了**。
 */
export const knockOnDelays = (
  task: ProjectTask,
  all: ProjectTask[],
  newDeadline: string
): { task: ProjectTask; daysLate: number }[] => {
  const base = new Date(String(newDeadline || '')).getTime();
  if (!Number.isFinite(base)) return [];
  return dependentTasks(task, all)
    .filter(isOpenTask)
    .map(t => {
      const d = new Date(String(t.deadline || '')).getTime();
      if (!Number.isFinite(d)) return null;
      const daysLate = Math.ceil((base - d) / (24 * 3600 * 1000));
      return daysLate > 0 ? { task: t, daysLate } : null;
    })
    .filter(Boolean) as { task: ProjectTask; daysLate: number }[];
};

/** 按「该先处理谁」排：超期最久的在最前，然后按截止日期 */
export const byUrgency = (a: ProjectTask, b: ProjectTask) => {
  const rank = (t: ProjectTask) => (t.status === 'InProgress' ? 0 : 1);
  const da = new Date(String(a.deadline || '9999-12-31')).getTime();
  const db = new Date(String(b.deadline || '9999-12-31')).getTime();
  if (da !== db) return (Number.isFinite(da) ? da : 4102416000000) - (Number.isFinite(db) ? db : 4102416000000);
  return rank(a) - rank(b);
};
