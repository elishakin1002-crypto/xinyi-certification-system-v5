import { aiService } from './aiService';
import { normalizeJudgement, MonthlyJudgement } from '../src/modules/review/normalize';

/**
 * 月度经营判断。
 *
 * ── 为什么分成两步 ────────────────────────────────────────────
 * 第一步 `fetchSnapshot()` 只取事实，不花钱、不调模型；
 * 第二步 `askAI()` 才调模型，且必须由人点按钮。
 *
 * 分开的理由不只是省钱（虽然那也是真的——摘要功能就踩过「一打开页面就
 * 同步调 AI」的坑）。更要紧的是**事实本身就有用**：
 * 连续几个月零签约、逾期最久那笔欠了多少天、哪个环节的任务最常卡住，
 * 这些摆出来老板自己就能判断，不需要模型开口。
 *
 * 而且分开之后，出了问题分得清是数据错还是模型错——
 * 快照可以被逐条核对，模型的话不行。
 */

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`经营快照响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

export interface TrendMonth { month: string; deals: number; amount: number }
export interface OverdueItem { customer: string; amount: number; dueDate: string; overdueDays: number }

export interface MonthlySnapshot {
  month: string;
  signingTrend: TrendMonth[];
  overdueReceivables: { count: number; totalAmount: number; worst: OverdueItem[] };
  deliveryBottlenecks: { openTasks: number; overdueTasks: number; topStuck: Array<{ title: string; count: number }> };
  customerMix: {
    byIndustry: Array<{ industry: string; customers: number }>;
    topCustomers: Array<{ name: string; amount: number }>;
    top5Share: number;
  };
  dataGaps: string[];
}

export const monthlyReviewService = {
  /** 只取事实。不调模型，不花钱。 */
  fetchSnapshot: async (): Promise<{ snapshot: MonthlySnapshot; prompt: string }> => {
    const res = await fetch('/api/review/monthly', { credentials: 'include' });
    const body = await parseJson<{ snapshot: MonthlySnapshot; prompt: string }>(res);
    return body.data;
  },

  /**
   * 拿快照去问模型。**必须由人显式触发**，不要在组件挂载时自动调。
   *
   * 返回值一律过 normalizeJudgement：模型答非所问、多给几条、
   * 给出没有数字依据的建议，都在那里被挡掉。
   */
  askAI: async (prompt: string, period = ''): Promise<MonthlyJudgement> => {
    const raw = await aiService.generateJSON('kimi', prompt, { timeoutMs: 60000 });
    return normalizeJudgement(raw, period);
  },
};
