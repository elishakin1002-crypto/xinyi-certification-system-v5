import { FollowUpRecord, Lead } from '../types';

type ApiEnvelope<T> = {
  ok: boolean;
  code: number;
  message: string;
  data: T;
};

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_LEADS_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_LEADS_API_READ_ENABLED, false);
const verifyWritesEnabled = parseBoolean(import.meta.env.VITE_LEADS_API_VERIFY_WRITES_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`线索服务响应异常（HTTP ${res.status}）`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message || `线索请求失败（HTTP ${res.status}）`));
  }
  return body as ApiEnvelope<T>;
};

export const leadService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,
  shouldVerifyWrites: () => verifyWritesEnabled,

  listLeads: async (): Promise<Lead[]> => {
    const res = await fetch('/api/leads', {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ leads: Lead[] }>(res);
    return Array.isArray(body.data.leads) ? body.data.leads : [];
  },

  getLead: async (leadId: string): Promise<Lead> => {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ lead: Lead }>(res);
    return body.data.lead;
  },

  createLead: async (lead: Lead): Promise<Lead> => {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lead })
    });
    const body = await parseJson<{ lead: Lead }>(res);
    return body.data.lead;
  },

  updateLead: async (leadId: string, updates: Partial<Lead>): Promise<Lead> => {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lead: updates })
    });
    const body = await parseJson<{ lead: Lead }>(res);
    return body.data.lead;
  },

  bulkUpsertLeads: async (leads: Lead[]): Promise<number> => {
    const res = await fetch('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ leads })
    });
    const body = await parseJson<{ written: number }>(res);
    return Number(body.data?.written || 0);
  },

  /**
   * 线索转客户。
   *
   * ── 为什么这个方法 2026-09-18 才补上 ──────────────────────────
   *
   * 服务端 `POST /api/leads/:id/convert` **一直都在**，`LEAD_CONVERT`
   * 权限也早就分给了三个角色，实测调用完全正常（建客户 + 把线索标成
   * 已转化）。缺的只是**前端从来没人调它**。
   *
   * 后果是销售主线断了一节：建完线索没有任何按钮能转客户，
   * 只能去客户管理把公司名、联系人、电话**重新录一遍** ——
   * 而这些信息线索里全都有。
   * 连带的：线索页「转化率」和销售工作台「销售转化率」永远是 0，
   * 线索详情里那个「已转化(退役)」状态永远到不了。
   *
   * 这一条是走「六条业务主线端到端」时发现的 —— 逐页逐钮清点发现不了它，
   * 因为**每一页单独看都是好的，断的是页面之间那一步**。
   */
  convertToCustomer: async (leadId: string): Promise<{ lead: Lead; customer: { id: string; name: string }; created: boolean }> => {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    const body = await parseJson<{ lead: Lead; customer: { id: string; name: string }; created: boolean }>(res);
    return body.data;
  },

  addFollowUp: async (leadId: string, record: FollowUpRecord): Promise<{ lead: Lead; record: FollowUpRecord }> => {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ record })
    });
    const body = await parseJson<{ lead: Lead; record: FollowUpRecord }>(res);
    return body.data;
  }
};
