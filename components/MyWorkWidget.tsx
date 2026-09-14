import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTodo, ArrowRight, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Project, ProjectTask } from '../types';
import { isOpenTask, isOverdue, byUrgency } from '../src/modules/taskFlow';
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

  const rows = useMemo(() => {
    const me = String(currentUser?.name || '').trim();
    const out: { task: ProjectTask; project: Project }[] = [];
    (projects || []).forEach(p => {
      (p.tasks || []).forEach(t => {
        if (!isOpenTask(t)) return;
        const owner = String(t.owner || '').trim();
        // 任务没写负责人时算项目负责人的 —— 和「我的任务」页同一套判断
        const mine = owner
          ? owner === me
          : (p.ownerUserId && currentUser?.id ? p.ownerUserId === currentUser.id : String(p.manager || '').trim() === me);
        if (!mine) return;
        out.push({ task: t, project: p });
      });
    });
    return out.sort((a, b) => byUrgency(a.task, b.task));
  }, [projects, currentUser?.name, currentUser?.id]);

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

      {urgent.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-4 text-xs font-bold text-gray-400">
          这一周没有到期的活。
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
              这周还有 {urgent.length - MAX_ROWS} 条，去我的任务看全部
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MyWorkWidget;
