import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, Check, X, RefreshCw } from 'lucide-react';
import { AIProposal } from '../types';
import { aiProposalService } from '../services/aiProposalService';
import { useApp } from '../context/AppContext';

/**
 * 「待我确认」队列。
 *
 * 放在工作台而不是独立菜单页：AI 提案的价值在于被及时处理，
 * 放在每天必看的地方才有用；独立页面大概率会变成没人点的入口。
 *
 * 驳回必须填原因，这是刻意的硬约束——
 * 这条记录的全部价值就在原因上，它告诉你 AI 在哪类判断上不可靠。
 * 没有原因，就只是「否掉了」，什么都学不到。
 */
const SOURCE_LABEL: Record<string, string> = {
  project_diagnosis: '项目诊断',
  audit_remediation: '整改方案',
  lead_scoring: '线索评分',
  task_template: '任务模板',
  doc_draft: '文件起草',
};

const REJECT_PRESETS = [
  '判断不准，实际情况不是这样',
  '这条不需要处理',
  '时机不对，现在不该做',
  '客户已另行沟通过',
];

export const AiProposalQueue: React.FC = () => {
  const { addContract, completeProject, toggleReceivableStatus } = useApp();
  const [items, setItems] = useState<AIProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  // 正在填驳回原因的那条
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await aiProposalService.list('pending'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /*
    批准之后**真的去执行**。

    2026-09-01 之前批准只是把状态改成 approved，然后没有下文——
    人以为点了就办了，实际什么都没发生。**那比不做还糟**：
    它看起来像个完整的流程，出了问题谁都不会想到是这里断的。
  */
  const runApproved = async (p: AIProposal) => {
    const a: any = p.action || {};
    const d = a.payload || {};
    switch (a.type) {
      case 'CONFIRM_RECEIVABLE':
        await toggleReceivableStatus(d.contractId, d.receivableId);
        return;
      case 'COMPLETE_PROJECT':
        await completeProject(d.projectId);
        return;
      case 'CREATE_CONTRACT':
        await addContract({
          ...d,
          amount: Number(d.amount),
          signDate: d.signDate || new Date().toISOString().slice(0, 10),
          serviceLine: d.serviceLine || '综合咨询',
          receivables: d.receivables || [],
        } as any, d.create_project ?? true);
        return;
      default:
        // 老的提案类型（诊断、整改方案等）不在这里执行，保持原样
        return;
    }
  };

  const decide = async (id: string, decision: 'approved' | 'rejected', reason?: string) => {
    setBusyId(id);
    try {
      const target = items.find(p => p.id === id);
      await aiProposalService.decide(id, decision, reason);
      /*
        先改状态再执行：状态改成功说明没有别人同时在处理这一条
        （decide 用 status='pending' 做条件，并发时第二个人会拿到 409）。
        反过来先执行的话，两个人同时点就会执行两次。
      */
      if (decision === 'approved' && target) {
        try {
          await runApproved(target);
        } catch (e) {
          setError(`已批准，但执行时出错：${e instanceof Error ? e.message : '未知错误'}。请到对应页面手工确认。`);
        }
      }
      setItems(prev => prev.filter(p => p.id !== id));
      setRejecting(null);
    } catch (e) {
      // 409 = 别人已经处理过了，刷新即可，不是错误
      const msg = e instanceof Error ? e.message : '操作失败';
      setError(msg);
      if (/已被处理/.test(msg)) load();
    } finally {
      setBusyId('');
    }
  };

  // 队列空是常态，不该占版面——但要让人知道机制在运行
  if (!loading && items.length === 0 && !error) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 text-sm font-black text-gray-900">
          <Sparkles className="w-4 h-4 text-indigo-600" /> 待我确认
          <span className="ml-auto text-[11px] font-bold text-gray-400">AI 有建议时会出现在这里</span>
        </div>
        <p className="mt-2 text-xs text-gray-400">当前没有待确认的 AI 建议。</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-indigo-600" />
        <h3 className="text-sm font-black text-gray-900">待我确认</h3>
        {items.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[11px] font-black">{items.length}</span>
        )}
        <button onClick={load} className="ml-auto text-gray-400 hover:text-gray-700" title="刷新">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">AI 只提建议，批准后才会真正执行。</p>

      {error && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 p-3 text-xs font-bold text-red-700">{error}</div>}

      <div className="space-y-3">
        {items.map(p => (
          <div key={p.id} className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex items-start gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[10px] font-black text-gray-500 whitespace-nowrap">
                {SOURCE_LABEL[p.source] || p.source}
              </span>
              <p className="text-sm font-bold text-gray-900 leading-5 flex-1">{p.title}</p>
            </div>

            {/* AI 为什么这么建议——人要据此判断，不能只给结论 */}
            {p.reason && <p className="mt-2 text-xs text-gray-500 leading-5">理由：{p.reason}</p>}

            {rejecting?.id === p.id ? (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-black text-gray-500">驳回原因（必填，用来改进 AI 判断）</p>
                <div className="flex flex-wrap gap-1.5">
                  {REJECT_PRESETS.map(r => (
                    <button key={r} onClick={() => setRejecting({ id: p.id, reason: r })}
                      className={`px-2 py-1 rounded-full text-[11px] font-bold border transition-all ${
                        rejecting.reason === r
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <textarea
                  value={rejecting.reason}
                  onChange={e => setRejecting({ id: p.id, reason: e.target.value })}
                  placeholder="也可以自己写，越具体越有用"
                  className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    disabled={!rejecting.reason.trim() || busyId === p.id}
                    onClick={() => decide(p.id, 'rejected', rejecting.reason)}
                    className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                    确认驳回
                  </button>
                  <button onClick={() => setRejecting(null)}
                    className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busyId === p.id}
                  onClick={() => decide(p.id, 'approved')}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40 flex items-center gap-1">
                  <Check className="w-3 h-3" /> 批准
                </button>
                <button
                  disabled={busyId === p.id}
                  onClick={() => setRejecting({ id: p.id, reason: '' })}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-40 flex items-center gap-1">
                  <X className="w-3 h-3" /> 驳回
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AiProposalQueue;
