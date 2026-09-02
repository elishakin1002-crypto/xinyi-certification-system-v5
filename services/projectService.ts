import { Customer, KnowledgeDoc, Project, ProjectWorkLog, Reminder } from '../types';

type ApiEnvelope<T> = {
  ok: boolean;
  code: number;
  message: string;
  data: T;
};

export type ProjectTransactionDatasets = {
  projects_v8: Project[];
  customers_v8?: Customer[];
  reminders_v8?: Reminder[];
  project_work_logs_v1?: ProjectWorkLog[];
  knowledge_docs_v8?: KnowledgeDoc[];
};

const parseBoolean = (raw: unknown, fallback: boolean) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const readEnabled = parseBoolean(import.meta.env.VITE_PROJECTS_API_READ_ENABLED, false);
const writeEnabled = parseBoolean(import.meta.env.VITE_PROJECTS_API_WRITE_ENABLED, false);
const verifyWritesEnabled = parseBoolean(import.meta.env.VITE_PROJECTS_API_VERIFY_WRITES_ENABLED, false);

const parseJson = async <T,>(res: Response): Promise<ApiEnvelope<T>> => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`项目服务响应异常（HTTP ${res.status}）`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message || `项目请求失败（HTTP ${res.status}）`));
  }
  return body as ApiEnvelope<T>;
};

export const projectService = {
  isReadEnabled: () => readEnabled,
  isWriteEnabled: () => writeEnabled,
  shouldVerifyWrites: () => verifyWritesEnabled,

  listProjects: async (): Promise<Project[]> => {
    const res = await fetch('/api/projects', {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ projects: Project[] }>(res);
    return Array.isArray(body.data.projects) ? body.data.projects : [];
  },

  getProject: async (projectId: string): Promise<Project> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'GET',
      credentials: 'include'
    });
    const body = await parseJson<{ project: Project }>(res);
    return body.data.project;
  },

  createProject: async (project: Project): Promise<Project> => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ project })
    });
    const body = await parseJson<{ project: Project }>(res);
    return body.data.project;
  },

  updateProject: async (projectId: string, updates: Partial<Project>): Promise<Project> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ project: updates })
    });
    const body = await parseJson<{ project: Project }>(res);
    return body.data.project;
  },

  addTask: async (projectId: string, task: Project['tasks'][number]): Promise<{ project: Project; task: Project['tasks'][number] }> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ task })
    });
    const body = await parseJson<{ project: Project; task: Project['tasks'][number] }>(res);
    return body.data;
  },

  // 项目完成（后端原子级联：完成记录/评级 + PDCA 找建客户 + 客户分级 + 提醒 + PDCA 知识文档 + 结算草稿）。
  // 唯一业务权威路径；前端仅负责用返回结果刷新受影响数据集。校验失败时后端返回 409，parseJson 会抛出携带原因的错误。
  complete: async (
    projectId: string,
    opts?: { source?: string; tasksOverride?: Project['tasks'] }
  ): Promise<{ ok: boolean; eventId?: string; customerId?: string; rating?: string; level?: string; reminderIds?: string[]; pdcaDocId?: string; project?: Project }> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ source: opts?.source, tasksOverride: opts?.tasksOverride })
    });
    const body = await parseJson<{ ok: boolean; eventId?: string; customerId?: string; rating?: string; level?: string; reminderIds?: string[]; pdcaDocId?: string; project?: Project }>(res);
    return body.data;
  },

  commitTransaction: async (datasets: ProjectTransactionDatasets, projectId?: string): Promise<{ written: number; keys: string[]; project?: Project }> => {
    const res = await fetch('/api/projects/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ projectId, datasets })
    });
    const body = await parseJson<{ written: number; keys: string[]; project?: Project }>(res);
    return body.data;
  }
};
