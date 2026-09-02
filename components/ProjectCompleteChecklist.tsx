import React, { useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { Project, ProjectTask, TaskSkipReason, TASK_SKIP_REASON_LABEL } from '../types';

/**
 * 完结项目前的未完成任务清单。
 *
 * 设计原则：**不强制完成，但强制交代。**
 *
 * 不强制的理由：强制「任务全打勾才能完结」不会让人做事，只会让人假打勾。
 * 空着至少还知道没做，假勾了你以为做了。而且现实中确实存在客户自行处理、
 * 客户放弃该体系、标准变更等情况——强制反而逼人造假。
 *
 * 但也不能像原来那样什么都不问就完结：项目关了，未完成任务永远挂在那儿，
 * 没人知道为什么没做。所以改成逐条交代，每条默认「跳过」并选原因，
 * 想补完成的可以点「已完成」。全部默认好了，点一下就能过，不挡人干活。
 */
export const ProjectCompleteChecklist: React.FC<{
  project: Project;
  pendingTasks: ProjectTask[];
  onCancel: () => void;
  onConfirm: (decisions: Array<{ task: ProjectTask; action: 'complete' | 'skip'; reason?: TaskSkipReason }>) => void;
}> = ({ project, pendingTasks, onCancel, onConfirm }) => {
  // 默认全部按「跳过 · 客户自行处理」预填，最常见的情况点一下就过
  const [rows, setRows] = useState(() =>
    pendingTasks.map(t => ({
      task: t,
      action: 'skip' as 'complete' | 'skip',
      reason: 'CustomerHandled' as TaskSkipReason,
    }))
  );

  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(prev => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const skipCount = rows.filter(r => r.action === 'skip').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="p-6 pb-4 border-b border-gray-100">
          <h3 className="text-lg font-black text-gray-900">完结项目前，还有 {pendingTasks.length} 个任务没完成</h3>
          <p className="text-xs text-gray-500 mt-1.5 leading-5">
            不用非得做完才能完结——但请说明每条为什么没做。
            <span className="text-gray-400">这些原因攒起来能告诉我们哪些任务是多余的。</span>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {rows.map((r, i) => (
            <div key={r.task.id} className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
              <div className="flex items-start gap-3">
                <p className="flex-1 text-sm font-bold text-gray-900 leading-5">{r.task.title}</p>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => set(i, { action: 'complete' })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${
                      r.action === 'complete' ? 'bg-green-600 text-white border-green-600'
                                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                    已完成
                  </button>
                  <button onClick={() => set(i, { action: 'skip' })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${
                      r.action === 'skip' ? 'bg-amber-600 text-white border-amber-600'
                                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                    跳过
                  </button>
                </div>
              </div>
              {r.action === 'skip' && (
                <select value={r.reason} onChange={e => set(i, { reason: e.target.value as TaskSkipReason })}
                  className="mt-2 w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-gray-900/10">
                  {(Object.keys(TASK_SKIP_REASON_LABEL) as TaskSkipReason[]).map(k => (
                    <option key={k} value={k}>{TASK_SKIP_REASON_LABEL[k]}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>

        <div className="p-6 pt-4 border-t border-gray-100 flex items-center gap-2">
          <p className="text-[11px] text-gray-400 flex-1">
            {skipCount > 0 ? `将跳过 ${skipCount} 条，其余标记完成` : '全部标记为已完成'}
          </p>
          <button onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-black bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> 先不完结
          </button>
          <button onClick={() => onConfirm(rows)}
            className="px-4 py-2 rounded-xl text-xs font-black bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" /> 确认完结项目
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectCompleteChecklist;
