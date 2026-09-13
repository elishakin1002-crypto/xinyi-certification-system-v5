import { Contract, ContractAttachment } from '../types';

type ContractTransactionDatasets = {
  contracts_v8: Contract[];
  customers_v8?: unknown[];
  projects_v8?: unknown[];
  leads_v8?: unknown[];
  knowledge_docs_v8?: unknown[];
};

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

const readEnabled = parseBoolean(import.meta.env.VITE_CONTRACTS_API_READ_ENABLED, false);
const writeEnabled = parseBoolean(import.meta.env.VITE_CONTRACTS_API_WRITE_ENABLED, false);
const verifyWritesEnabled = parseBoolean(import.meta.env.VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`合同服务响应异常（HTTP ${res.status}）`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message || `合同请求失败（HTTP ${res.status}）`));
  }
  return body as ApiEnvelope<T>;
};

export const contractService = {
  isReadEnabled: () => readEnabled,
  isWriteEnabled: () => writeEnabled,
  shouldVerifyWrites: () => verifyWritesEnabled,

  listContracts: async (): Promise<Contract[]> => {
    const res = await fetch('/api/contracts', {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ contracts: Contract[] }>(res);
    return Array.isArray(body.data.contracts) ? body.data.contracts : [];
  },

  getContract: async (contractId: string): Promise<Contract> => {
    const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}`, {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ contract: Contract }>(res);
    return body.data.contract;
  },

  createContract: async (contract: Contract): Promise<Contract> => {
    const res = await fetch('/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ contract })
    });
    const body = await parseJson<{ contract: Contract }>(res);
    return body.data.contract;
  },

  updateContract: async (contractId: string, updates: Partial<Contract>): Promise<Contract> => {
    const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ contract: updates })
    });
    const body = await parseJson<{ contract: Contract }>(res);
    return body.data.contract;
  },

  /**
   * 真正把文件传上去（存盘），而不是只记一条元数据。
   *
   * ── 2026-09-13 查出来的事 ──────────────────────────────────────
   *
   * 金恩来：「客户管理中可以直接预览合同，但合同管理却不能」。
   * 顺着查下去发现的是更严重的事：
   *
   * **生产上 12 份有附件的合同，附件 url 全是 `blob:http://...`** ——
   * 那是浏览器的临时地址：只在上传的那个标签页里有效，
   * 刷新就失效，换台电脑、换个人永远打不开。
   * 也就是说**上传过的合同原件，一份都没真的存下来**。
   *
   * 而服务端**早就有真实的上传接口**（存盘 + 返回 /api/files/...），
   * 前端一直没用它，走的是只记元数据那条（addAttachment），
   * 把 blob 地址当成 url 存了进去。
   *
   * 又是「有两条路，用错了那条」—— 和两份 pdf.js、两份查重规则同一类。
   */
  uploadAttachment: async (
    contractId: string,
    file: File
  ): Promise<{ contract: Contract; attachment: ContractAttachment }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/attachments/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,   // 不要手写 Content-Type，浏览器要自己带 multipart 边界
    });
    const body = await parseJson<{ contract: Contract; attachment: ContractAttachment }>(res);
    return body.data;
  },

  /**
   * 建合同时还没有合同 id，用通用上传先把文件存下来，拿到稳定 URL。
   * 服务端那个接口的注释写得很清楚：就是为「表单保存前先把文件传上来」准备的。
   */
  uploadLooseFile: async (file: File): Promise<ContractAttachment> => {
    const form = new FormData();
    form.append('files', file);
    const res = await fetch('/api/uploads/misc', {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const body = await parseJson<{ files: ContractAttachment[] }>(res);
    const one = body.data.files[0];
    return { id: `A-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, ...one };
  },

  addAttachment: async (
    contractId: string,
    attachment: ContractAttachment
  ): Promise<{ contract: Contract; attachment: ContractAttachment }> => {
    const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ attachment })
    });
    const body = await parseJson<{ contract: Contract; attachment: ContractAttachment }>(res);
    return body.data;
  },

  // 回款确认/撤销（后端原子级联：切换回款节点 paid↔unpaid + 更新项目付款状态 + 全额到账时客户升级 + 生成 PDCA 文档）。
  // 唯一业务权威路径；后端行为为「切换」，与前端 toggleReceivableStatus 对应。校验失败后端返回 409。
  confirmReceivable: async (
    contractId: string,
    receivableId: string
  ): Promise<{ ok: boolean; allPaid?: boolean; paymentStatus?: string; customerId?: string; pdcaDocId?: string; leveledUp?: boolean; contract?: Contract }> => {
    const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/receivables/${encodeURIComponent(receivableId)}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({})
    });
    const body = await parseJson<{ ok: boolean; allPaid?: boolean; paymentStatus?: string; customerId?: string; pdcaDocId?: string; leveledUp?: boolean; contract?: Contract }>(res);
    return body.data;
  },

  commitTransaction: async (
    datasets: ContractTransactionDatasets,
    contractId?: string
  ): Promise<{ written: number; keys: string[]; contract: Contract | null }> => {
    const res = await fetch('/api/contracts/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ datasets, contractId })
    });
    const body = await parseJson<{ written: number; keys: string[]; contract: Contract | null }>(res);
    return body.data;
  }
};
