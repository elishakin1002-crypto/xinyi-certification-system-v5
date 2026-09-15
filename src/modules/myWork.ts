import { Project, ProjectTask, Status } from '../../types';
import { isOpenTask, isOverdue } from './taskFlow';

/**
 * 「我现在该做哪些任务」—— 全系统只算这一次。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个文件
 * ══════════════════════════════════════════════════════════════
 *
 * 这个问题原来有**三处各算各的**：
 *   components/MyWorkWidget.tsx   「我今天的活」    遍历全部项目
 *   pages/MyTasks.tsx             「我的任务」      遍历全部项目
 *   services/dashboardMetrics.ts  「逾期任务」卡片   只算进行中项目（2026-09-15 改的）
 *
 * 2026-09-15 我只改了第三处，结果金恩来的截图变成：
 *     逾期任务 0        ← 卡片（改过的）
 *     我今天的活 5 条已逾期   ← 同一屏，没改的
 * **从"两边都错"变成了"两边互相矛盾"，比原来更糟。**
 *
 * 他的原话：「逾期任务是 0，下面卡片已逾期是 5？字段不统一，显示也不关联？
 *            若是不同的内容，那字段不能这么写啊，完全看不懂！」
 *
 * 所以这次不是再改一处，是把这个问题**收口成一个函数**。
 * 以后任何地方要回答「我该做什么」，都从这里拿 —— 想改口径只有一个地方能改。
 *
 * ══════════════════════════════════════════════════════════════
 * 口径：为什么已结项项目里的任务不算
 * ══════════════════════════════════════════════════════════════
 *
 * 项目结项了，里面还剩几条没勾的任务 —— 那是**结项收尾没做干净的记录问题**，
 * 不是"今天要干的活"。把它算进待办的后果很具体：
 * 顾问名下项目全结项了，工作台却常年挂着一个红色的 5，点进去找不到对应项目。
 *
 * **一个永远消不掉的红色数字，会让人不再信任所有红色数字** ——
 * 而真正紧急的那条也在红色里。
 *
 * 这些任务不会消失：`strandedTasks()` 单独把它们捞出来，
 * 让人知道「有 N 条挂在已结项项目上，去清一下」，但不占今天的清单。
 */

export type TaskWithProject = { task: ProjectTask; project: Project };

/** 这条任务算不算我的。任务没写负责人时，算项目负责人的 */
export const isMyTask = (
  task: ProjectTask,
  project: Project,
  me: { name?: string; id?: string }
): boolean => {
  const myName = String(me?.name || '').trim();
  const owner = String(task.owner || '').trim();
  if (owner) return owner === myName;
  if (project.ownerUserId && me?.id) return project.ownerUserId === me.id;
  return String(project.manager || '').trim() === myName;
};

/** 还在进行中的项目 */
const isLive = (p: Project) => p.status !== Status.Completed;

/**
 * 我现在该做的任务：**进行中项目里、属于我的、还没了结的**。
 *
 * 「我今天的活」「我的任务」「工作台的逾期任务数」全部从这里取，
 * 三个数字因此必然一致 —— 不是靠谁记得同步。
 */
export const myActionableTasks = (
  projects: Project[] | undefined,
  me: { name?: string; id?: string }
): TaskWithProject[] => {
  const out: TaskWithProject[] = [];
  (projects || []).forEach((p) => {
    if (!isLive(p)) return;
    (p.tasks || []).forEach((t) => {
      if (!isOpenTask(t)) return;
      if (!isMyTask(t, p, me)) return;
      out.push({ task: t, project: p });
    });
  });
  return out;
};

/** 我的逾期任务。就是上面那批里过了截止日的 —— 没有第二套判定 */
export const myOverdueTasks = (
  projects: Project[] | undefined,
  me: { name?: string; id?: string },
  now = Date.now()
): TaskWithProject[] => myActionableTasks(projects, me).filter(({ task }) => isOverdue(task, now));

/**
 * 挂在**已结项项目**上、还没了结的任务。
 *
 * 它们不该进今天的清单（见文件头说明），但也不能凭空消失 ——
 * 那是真实存在的记录，而且说明某次结项收尾没做干净。
 * 界面上用一句话提示「有 N 条挂在已结项项目上」并给个入口去清。
 */
export const strandedTasks = (
  projects: Project[] | undefined,
  me: { name?: string; id?: string }
): TaskWithProject[] => {
  const out: TaskWithProject[] = [];
  (projects || []).forEach((p) => {
    if (isLive(p)) return;
    (p.tasks || []).forEach((t) => {
      if (!isOpenTask(t)) return;
      if (!isMyTask(t, p, me)) return;
      out.push({ task: t, project: p });
    });
  });
  return out;
};
