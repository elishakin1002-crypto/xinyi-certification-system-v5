import React from 'react';
import { CheckCircle2, PlayCircle, Lock } from 'lucide-react';
import { ProjectTask } from '../types';
import { blockingPrerequisites, isOverdue } from '../src/modules/taskFlow';

/**
 * 任务的「开始 / 完成」控件。
 *
 * ── 为什么抽出来 ──────────────────────────────────────────────
 * 项目详情里有两处任务列表（分组视图和平铺视图），
 * 再加新的「我的任务」页，一共三处。三处各写一遍的话，
 * 加「进行中」这一步就要改三个地方 —— 而漏掉一处的表现是
 * 「同一个任务在这一页能标进行中，换一页就不能」，最难查。
 *
 * ── 为什么「开始」是独立的一下，不是勾选框的中间态 ────────────
 * 勾选框只有两态才好按。三态勾选框（空 / 半 / 满）人得点两下才到完成，
 * 而**完成才是最高频的操作**。所以圆圈还是只管完成，
 * 「开始做」单独一个小按钮，标上了就变成一个「进行中」的标签。
 */
export const TaskStatusControl: React.FC<{
  task: ProjectTask;
  /** 同一个项目里的全部任务，用来判断前置有没有做完 */
  allTasks: ProjectTask[];
  disabled?: boolean;
  onChange: (updates: Partial<ProjectTask>) => void;
  /** 紧凑模式：「我的任务」页一行一个，不需要那么大 */
  compact?: boolean;
}> = ({ task, allTasks, disabled = false, onChange, compact = false }) => {
  const blockers = blockingPrerequisites(task, allTasks);
  const overdue = isOverdue(task);
  const done = task.status === 'Completed';
  const doing = task.status === 'InProgress';

  /**
   * 前置没做完时**问一句，但不拦**。
   *
   * 强制不会让人按顺序做事，只会让人绕过系统做事 ——
   * 和「跳过要填原因」是同一条道理。现实里确实有并行推进、
   * 客户先给了材料这类情况。
   */
  const confirmIfBlocked = (what: string): boolean => {
    if (blockers.length === 0) return true;
    const names = blockers.map(b => `· ${b.title}`).join('\n');
    return window.confirm(
      `这条任务前面还有没做完的：\n\n${names}\n\n通常要等它们做完再${what}。确定现在就${what}吗？`
    );
  };

  const toggleDone = () => {
    if (disabled) return;
    if (done) { onChange({ status: 'Pending' }); return; }
    if (!confirmIfBlocked('标完成')) return;
    onChange({ status: 'Completed' });
  };

  const toggleDoing = () => {
    if (disabled) return;
    if (doing) { onChange({ status: 'Pending' }); return; }
    if (!confirmIfBlocked('开始')) return;
    onChange({ status: 'InProgress' });
  };

  const size = compact ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggleDone}
        disabled={disabled}
        title={done ? '点一下改回未完成' : '标记完成'}
        className={disabled ? 'cursor-not-allowed opacity-50' : ''}
      >
        {done
          ? <CheckCircle2 className={`${size} text-green-500`} />
          : <span className={`block ${size} rounded-full border-2 ${overdue ? 'border-red-300' : 'border-gray-200'} hover:border-indigo-400`} />}
      </button>

      {/* 已完成/已跳过就不再显示「开始」——那时候它没有意义 */}
      {!done && task.status !== 'Skipped' && (
        <button
          type="button"
          onClick={toggleDoing}
          disabled={disabled}
          title={doing ? '点一下改回待开始' : '标记我正在做这条'}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black transition-colors ${
            doing
              ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <PlayCircle className="h-3 w-3" />
          {doing ? '进行中' : '开始做'}
        </button>
      )}

      {/* 前置没做完时标一下，让人点之前就知道 */}
      {blockers.length > 0 && !done && (
        <span
          title={`要先做完：\n${blockers.map(b => '· ' + b.title).join('\n')}`}
          className="inline-flex cursor-help items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 ring-1 ring-amber-200"
        >
          <Lock className="h-3 w-3" />
          等 {blockers.length} 项
        </span>
      )}
    </span>
  );
};

export default TaskStatusControl;
