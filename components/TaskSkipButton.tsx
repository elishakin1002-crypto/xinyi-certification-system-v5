import React, { useState } from 'react';
import { SkipForward, RotateCcw } from 'lucide-react';
import { ProjectTask, TaskSkipReason, TASK_SKIP_REASON_LABEL } from '../types';

/**
 * 任务「跳过」控件。
 *
 * 为什么要有跳过：不强制「任务全完成才能完结项目」——
 * 强制不会让人做事，只会让人假打勾。空着至少还知道没做，假勾了你以为做了。
 * 现实里确实存在客户自行处理、客户放弃该体系、标准变更等情况。
 *
 * 但**跳过必须填原因**，这是刻意的硬约束：
 * 攒起来才能回答「哪个任务在 80% 的项目里都被跳过」，
 * 那是精简任务模板的唯一真实依据，外面买不到。
 */
export const TaskSkipButton: React.FC<{
  task: ProjectTask;
  onSkip: (reason: TaskSkipReason, note?: string) => void;
  onUndo: () => void;
  disabled?: boolean;
}> = ({ task, onSkip, onUndo, disabled }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<TaskSkipReason | ''>('');
  const [note, setNote] = useState('');

  // 已跳过：显示原因 + 撤销入口，不再给「跳过」按钮
  if (task.status === 'Skipped') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-black whitespace-nowrap">
          已跳过{task.skipReason ? ` · ${TASK_SKIP_REASON_LABEL[task.skipReason]}` : ''}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onUndo(); }} disabled={disabled}
          title="撤销跳过，恢复为待办"
          className="text-gray-400 hover:text-indigo-600 transition-colors p-1 disabled:opacity-40">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (task.status === 'Completed') return null;

  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} disabled={disabled}
        title="这条任务不做了"
        className="text-gray-400 hover:text-amber-600 transition-colors p-1 disabled:opacity-40">
        <SkipForward className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-0 bottom-0 z-20 bg-white border-t border-gray-100 rounded-b-2xl p-3 shadow-lg">
      <p className="text-[11px] font-black text-gray-500 mb-2">为什么不做这条？（必选）</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {(Object.keys(TASK_SKIP_REASON_LABEL) as TaskSkipReason[]).map(r => (
          <button key={r} onClick={() => setReason(r)}
            className={`px-2 py-1 rounded-full text-[11px] font-bold border transition-all ${
              reason === r ? 'bg-gray-900 text-white border-gray-900'
                           : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {TASK_SKIP_REASON_LABEL[r]}
          </button>
        ))}
      </div>
      {/* 选「其他」时必须写清楚，否则这条记录就没有分析价值 */}
      {reason === 'Other' && (
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder="请说明具体原因" autoFocus
          className="w-full mb-2 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-gray-900/10" />
      )}
      <div className="flex gap-2">
        <button
          disabled={!reason || (reason === 'Other' && !note.trim())}
          onClick={() => { onSkip(reason as TaskSkipReason, note.trim() || undefined); setOpen(false); setReason(''); setNote(''); }}
          className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed">
          确认跳过
        </button>
        <button onClick={() => { setOpen(false); setReason(''); setNote(''); }}
          className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
          取消
        </button>
      </div>
    </div>
  );
};

export default TaskSkipButton;
