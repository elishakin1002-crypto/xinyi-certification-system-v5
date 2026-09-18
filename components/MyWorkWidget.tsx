import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTodo, ArrowRight, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Project, ProjectTask } from '../types';
import { isOverdue, byUrgency } from '../src/modules/taskFlow';
// 「我该做什么」只算一次，见 src/modules/myWork.ts
import { myActionableTasks, strandedTasks } from '../src/modules/myWork';
import { TaskStatusControl } from './TaskStatusControl';

/**
 * 工作台上的「我今天的活」摘要块。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么是「摘要在工作台、全量在我的任务」，不是二选一
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-08：「是不是把任务管理直接融入到工作台就好了？
 * 为什么要单独做一页？」
 *
 * 问得对，而且答案不是二选一，是**主从**：
 *
 *   工作台   一眼看完就走。它是「看」的地方 ——
 *            所以只能放三五条，放多了它就不再是概览。
 *   我的任务 一整天回来好几次，边做边勾。它是「做」的地方 ——
 *            所以要放全量（一个顾问名下可能三五十条）、要能筛能搜。
 *
 * 硬把全量塞进工作台，只有两个结局：要么截断（那还得有个
 * 「查看全部」，等于又回到单独一页），要么工作台变成一条长列表
 * （那它就不再是「一眼看完」了）。成熟工具都是这么分的 ——
 * Asana 的 Home 放一个 My Tasks 摘要挂件，点进去才是完整的 My Tasks 页。
 *
 * **在这个块出现之前，两页是断的**：工作台看完知道「有事」，
 * 却还要自己走到侧边栏去点「我的任务」。少的就是这一块。
 */

const DAY = 24 * 3600 * 1000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** 工作台上最多显示几条 —— 再多就不是概览了 */
const MAX_ROWS = 4;

export const MyWorkWidget: React.FC = () => {
  const { projects, currentUser, updateProjectTask, checkActionPermission } = useApp();
  const navigate = useNavigate();

  /*
    ── 「我该做什么」只算一次（2026-09-15）────────────────────────

    这里原来自己遍历全部项目算一遍，而工作台的「逾期任务」卡片算另一遍。
    我 09-15 上午只改了卡片那一处（排除已结项项目），
    结果金恩来看到的是同一屏上：

        逾期任务 0            ← 卡片（改过的）
        我今天的活 5 条已逾期   ← 这里（没改的）

    **从"两边都错"变成了"两边互相矛盾"，比原来更糟。**

    现在两边都从 src/modules/myWork.ts 取 —— 数字必然一致，
    不是靠谁记得同步。
  */
  const rows = useMemo(
    () => myActionableTasks(projects, { name: currentUser?.name, id: currentUser?.id })
      .sort((a, b) => byUrgency(a.task, b.task)),
    [projects, currentUser?.name, currentUser?.id]
  );

  /*
    挂在已结项项目上的残留任务：不进今天的清单，但要让人知道有这么回事。
    不提的话，那 5 条就凭空消失了 —— 人会以为系统把活弄丢了。
  */
  const stranded = useMemo(
    () => strandedTasks(projects, { name: currentUser?.name, id: currentUser?.id }),
    [projects, currentUser?.name, currentUser?.id]
  );

  /*
    只留「已经欠账的」和「这周要交的」。
    再远的东西放到工作台上只是让人焦虑，帮不上今天的忙。
  */
  const t0 = startOfToday();
  const urgent = rows.filter(r => {
    if (isOverdue(r.task)) return true;
    const d = new Date(String(r.task.deadline || '')).getTime();
    return Number.isFinite(d) && d < t0 + 7 * DAY;
  });
  const overdueCount = rows.filter(r => isOverdue(r.task)).length;

  return (
    <div data-onboard="my-work" className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ListTodo className="h-5 w-5 text-indigo-600" />
        <h3 className="text-sm font-black text-gray-900">我今天的活</h3>
        {overdueCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black text-red-700">
            <AlertTriangle className="h-3 w-3" />
            {overdueCount} 条已逾期
          </span>
        )}
        <button
          type="button"
          onClick={() => navigate('/my-tasks')}
          className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
        >
          全部 {rows.length} 条
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {/*
        挂在已结项项目上的残留任务，单独说一句。

        它们**不进今天的清单**（项目都结项了，不是今天要干的活），
        但也不能不提 —— 否则人会以为系统把活弄丢了。
        说清楚「在哪、有几条、去哪清」，人自己决定要不要去收尾。
      */}
      {stranded.length > 0 && (
        <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
          另有 {stranded.length} 条任务挂在**已结项**的项目上还没了结 ——
          不算今天的活，但建议去「项目管理」把它们标完成或跳过，否则一直挂着。
        </p>
      )}

      {urgent.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-4 text-xs font-bold text-gray-400">
          未来七天没有到期的活。
          {rows.length > 0 && `名下还有 ${rows.length} 条更远的，点右上角看。`}
        </p>
      ) : (
        <div className="space-y-1">
          {urgent.slice(0, MAX_ROWS).map(({ task, project }) => {
            const overdue = isOverdue(task);
            return (
              <div
                key={`${project.id}-${task.id}`}
                className={`flex items-start gap-2.5 rounded-xl px-3 py-2 ${overdue ? 'bg-red-50/60' : 'bg-gray-50'}`}
              >
                <div className="pt-0.5">
                  {/*
                    摘要块里也能直接勾完成。
                    「看到了但要走两步才能处理」，人就会先放着，然后忘掉。
                  */}
                  <TaskStatusControl
                    task={task}
                    allTasks={project.tasks || []}
                    compact
                    disabled={!checkActionPermission('TASK_COMPLETE', project).allowed}
                    onChange={(u) => updateProjectTask(project.id, task.id, u)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-gray-900">{task.title}</p>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-gray-500">
                    {project.name}
                    <span className="mx-1 text-gray-300">·</span>
                    <span className={overdue ? 'text-red-600' : ''}>
                      {task.deadline || '没定日期'}{overdue && ' 已逾期'}
                    </span>
                  </p>
                </div>
              </div>
            );
          })}
          {urgent.length > MAX_ROWS && (
            <button
              type="button"
              onClick={() => navigate('/my-tasks')}
              className="w-full rounded-xl border border-dashed border-gray-200 py-2 text-[11px] font-bold text-gray-500 hover:border-gray-300 hover:text-gray-700"
            >
              未来七天还有 {urgent.length - MAX_ROWS} 条，去我的任务看全部
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MyWorkWidget;
