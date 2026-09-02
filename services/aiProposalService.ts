import { AIProposal } from '../types';

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`AI 提案服务响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

/**
 * AI 待确认队列。
 *
 * 这条链路的存在意义：AI 一律只提案，人确认后才执行。
 * 改之前 AI 判定高风险就自己写提醒进系统，人不知道；其余建议只在页面上摆着。
 */
export const aiProposalService = {
  /**
   * 提一条建议进队列。
   *
   * 高风险动作（确认回款、完成项目、录合同）走这里而不是直接执行——
   * 不是因为动作危险，是因为**这个动作是 AI 从一句话推断出来的**。
   * 人自己点按钮是他的判断；AI 认错一笔合同号，代价是不可撤销的。
   */
  create: async (input: {
    source: string; sourceRef?: string; title: string;
    action: { type: string; payload: any; reason: string };
    reason?: string; confidence?: 'high' | 'medium' | 'low';
  }): Promise<AIProposal> => {
    const res = await fetch('/api/ai-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    const body = await parseJson<{ proposal: AIProposal }>(res);
    return body.data.proposal;
  },

  list: async (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): Promise<AIProposal[]> => {
    const res = await fetch(`/api/ai-proposals?status=${encodeURIComponent(status)}`, { credentials: 'include' });
    const body = await parseJson<{ proposals: AIProposal[] }>(res);
    return Array.isArray(body.data.proposals) ? body.data.proposals : [];
  },

  /**
   * 批准或驳回。
   * 驳回必须给原因——服务端也会拦，这里提前挡一次，省一个来回。
   */
  decide: async (id: string, decision: 'approved' | 'rejected', rejectReason?: string): Promise<AIProposal> => {
    if (decision === 'rejected' && !String(rejectReason || '').trim()) {
      throw new Error('驳回必须填写原因');
    }
    const res = await fetch(`/api/ai-proposals/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ decision, rejectReason }),
    });
    const body = await parseJson<{ proposal: AIProposal }>(res);
    return body.data.proposal;
  },

  /** 采纳率统计：哪类提案 AI 还不该自己做 */
  stats: async (): Promise<Array<{ source: string; approved: number; rejected: number; total: number; approvalRate: number }>> => {
    const res = await fetch('/api/ai-proposals/stats', { credentials: 'include' });
    const body = await parseJson<{ stats: any[] }>(res);
    return Array.isArray(body.data.stats) ? body.data.stats : [];
  },
};
