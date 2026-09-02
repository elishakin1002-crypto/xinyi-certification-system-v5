export interface IntelConfig {
  regions: string[];
  industries: string[];
  keywords: string[];
  sourceUrls: string[];
  limit: number;
  updatedAt?: string;
}

const parseJson = async (res: Response) => {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`情报配置响应异常（HTTP ${res.status}）`);
  if (!res.ok || body.ok === false) throw new Error(String(body.message || `情报配置请求失败（HTTP ${res.status}）`));
  return body;
};

export const intelConfigService = {
  getConfig: async (): Promise<IntelConfig> => {
    const res = await fetch('/api/intel/config', { method: 'GET', credentials: 'include' });
    const body = await parseJson(res);
    return body.data.config as IntelConfig;
  },
  saveConfig: async (cfg: IntelConfig): Promise<IntelConfig> => {
    const res = await fetch('/api/intel/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(cfg),
    });
    const body = await parseJson(res);
    return body.data.config as IntelConfig;
  },
};
