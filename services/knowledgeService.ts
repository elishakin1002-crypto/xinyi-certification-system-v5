import { KnowledgeDoc } from '../types';

type ApiEnvelope<T> = { ok: boolean; code: number; message: string; data: T };

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const enabled = parseBoolean(import.meta.env.VITE_KNOWLEDGE_API_ENABLED, false);
const readEnabled = parseBoolean(import.meta.env.VITE_KNOWLEDGE_API_READ_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`知识库服务响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `知识库请求失败（HTTP ${res.status}）`));
  return body as ApiEnvelope<T>;
};

export const knowledgeService = {
  isEnabled: () => enabled,
  isReadEnabled: () => readEnabled,

  listDocs: async (): Promise<KnowledgeDoc[]> => {
    const res = await fetch('/api/knowledge', { method: 'GET', credentials: 'include' });
    const body = await parseJson<{ docs: KnowledgeDoc[] }>(res);
    return Array.isArray(body.data.docs) ? body.data.docs : [];
  },

  createDoc: async (doc: KnowledgeDoc): Promise<KnowledgeDoc> => {
    const res = await fetch('/api/knowledge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ doc }),
    });
    const body = await parseJson<{ doc: KnowledgeDoc }>(res);
    return body.data.doc;
  },

  updateDoc: async (id: string, updates: Partial<KnowledgeDoc>): Promise<KnowledgeDoc> => {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ doc: updates }),
    });
    const body = await parseJson<{ doc: KnowledgeDoc }>(res);
    return body.data.doc;
  },

  deleteDoc: async (id: string): Promise<void> => {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    await parseJson<{ ok: boolean }>(res);
  },
};
