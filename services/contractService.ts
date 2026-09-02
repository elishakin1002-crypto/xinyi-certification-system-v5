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
