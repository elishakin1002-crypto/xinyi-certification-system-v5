import { reportClientError } from './errorReporter';

export interface ChatMessage {
  role: 'system' | 'user' | 'model';
  parts: { text?: string; inlineData?: { mimeType: string; data: string } }[];
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

class AIService {
  private backendUrl: string;
  private defaultModel: string;
  private backendState = { consecutiveFailures: 0, disabledUntil: 0 };

  constructor() {
    const envBackendUrl = (import.meta as any).env?.VITE_AI_BACKEND_URL as string | undefined;
    this.backendUrl = (envBackendUrl || '/api/ai').replace(/\/$/, '');

    const envModel = (import.meta as any).env?.VITE_KIMI_MODEL as string | undefined;
    /*
      默认模型不再写死 kimi-k2.5 —— 2026-09-03 查 Moonshot 账号，
      可用的是 kimi-k3 / kimi-k2.6 / kimi-k2.7-code*，**根本没有 k2.5**。
      配了一个不存在的模型，报错却是「AI 后端不可用」，很难往这上面想。

      另外这个值现在只在「显式指定模型」时用得上：
      服务端已经改成纯文本走 DeepSeek、含图片走 DeepSeek 视觉，Kimi 是兜底。
    */
    this.defaultModel = envModel || 'kimi-k3';
  }

  private resolveBackendTimeout(endpoint: string, payload: unknown): number {
    const env = (import.meta as any).env || {};
    const chatTimeout = Number(env.VITE_AI_CHAT_TIMEOUT_MS || 30000);
    const generateTimeout = Number(env.VITE_AI_GENERATE_TIMEOUT_MS || 45000);
    const defaultTimeout = Number(env.VITE_AI_DEFAULT_TIMEOUT_MS || 20000);

    let timeout = defaultTimeout;
    if (endpoint === '/chat') timeout = chatTimeout;
    if (endpoint === '/generate') timeout = generateTimeout;

    const payloadSize = JSON.stringify(payload || {}).length;
    if (payloadSize > 350000) timeout += 10000;
    if (payloadSize > 700000) timeout += 15000;
    return timeout;
  }

  private normalizeModelName(input: string | undefined, fallback: string): string {
    const raw = String(input || '').trim();
    if (!raw) return fallback;
    return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
  }

  private normalizeBase64(rawData: string): string {
    const raw = String(rawData || '');
    const marker = 'base64,';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length);
    return raw;
  }

  private resolveTemperature(model: string, requested?: number): number | undefined {
    const normalized = String(model || '').trim().toLowerCase();
    // kimi-k2.5 不接受自定义 temperature。该模型已不在账号可用列表里，
    // 这条留着是防止有人手工指定它时又踩一次。
    if (normalized === 'kimi-k2.5') return undefined;
    if (typeof requested === 'number') return requested;
    return 0.2;
  }

  private toOpenAIContent(parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>): OpenAIMessage['content'] {
    const rich: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
    let onlyText = true;

    (parts || []).forEach((part) => {
      if (part?.text) {
        rich.push({ type: 'text', text: String(part.text) });
        return;
      }
      const inlineData = part?.inlineData;
      if (!inlineData?.data) return;

      const mimeType = String(inlineData.mimeType || 'application/octet-stream');
      const base64 = this.normalizeBase64(String(inlineData.data || ''));

      if (mimeType.startsWith('image/')) {
        onlyText = false;
        rich.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` }
        });
        return;
      }

      rich.push({
        type: 'text',
        text: `[附件已提供: ${mimeType}] 当前模型接口优先支持文本与图片解析，请补充可读文本或图片以提升准确率。`
      });
    });

    if (onlyText) {
      return rich
        .filter((x): x is { type: 'text'; text: string } => x.type === 'text')
        .map(x => x.text)
        .join('\n')
        .trim();
    }

    return rich;
  }

  private toOpenAIMessages(history: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>): OpenAIMessage[] {
    return (history || []).map((msg) => {
      const roleRaw = String(msg?.role || 'user');
      const role: OpenAIMessage['role'] = roleRaw === 'model'
        ? 'assistant'
        : roleRaw === 'assistant'
          ? 'assistant'
          : roleRaw === 'system'
            ? 'system'
            : 'user';
      return {
        role,
        content: this.toOpenAIContent(Array.isArray(msg?.parts) ? msg.parts : [{ text: String((msg as any)?.text || '') }])
      };
    });
  }

  private extractTextFromChoice(choiceContent: unknown): string {
    if (typeof choiceContent === 'string') return choiceContent;
    if (!Array.isArray(choiceContent)) return '';
    return choiceContent
      .map((chunk) => {
        if (!chunk || typeof chunk !== 'object') return '';
        const type = (chunk as any).type;
        if (type === 'text') return String((chunk as any).text || '');
        return '';
      })
      .join('\n')
      .trim();
  }

  /*
    把上游的真实原因翻译成同事看得懂的一句话。

    ── 为什么要有这一层 ──────────────────────────────────────────
    2026-09-03：AI 对话框报「AI 后端不可用，请确认服务端已启动并配置模型密钥」。
    真实原因是 **DeepSeek 账户余额不足**，而这句提示把人引向了
    「是不是服务挂了」「是不是密钥没配」——两个都不是。
    我自己也顺着这句话多查了两轮才翻到后端日志。

    错误信息指错方向，比没有错误信息更费时间。

    ── 分两层说 ──────────────────────────────────────────────────
    给同事看的是「能不能干活、该找谁」，不是 API 的原文；
    原文保留在 cause 里，管理员在系统日志里能看到。
  */
  private explainAiFailure(cause: unknown): string {
    const raw = String((cause as any)?.message || cause || '');
    const lower = raw.toLowerCase();

    if (/insufficient balance|余额不足|欠费/i.test(raw)) {
      return 'AI 服务余额不足，暂时无法使用。请联系系统管理员充值。';
    }
    if (/not found the model|model.*not (found|exist)|无此模型/i.test(raw)) {
      return 'AI 模型配置有误（指定的模型不存在）。请联系系统管理员。';
    }
    if (/permission denied|unauthorized|invalid api key|401|403/i.test(lower)) {
      return 'AI 服务密钥无效或已过期。请联系系统管理员。';
    }
    if (/rate limit|too many requests|429/i.test(lower)) {
      return 'AI 服务当前请求过多，请稍等一会儿再试。';
    }
    if (/timeout|timed out|超时/i.test(lower)) {
      return 'AI 响应超时。可以再试一次，如果一直这样请联系系统管理员。';
    }
    if (/quota|配额/i.test(lower)) {
      return '今天的 AI 使用额度已用完。请联系系统管理员。';
    }
    // 认不出来的，把原文带上——总比一句放之四海皆准的废话强
    return `AI 暂时不可用${raw ? `：${raw.slice(0, 120)}` : ''}。请联系系统管理员。`;
  }

  private backendUnavailableFallback = async <T>(cause?: unknown): Promise<T> => {
    throw new Error(this.explainAiFailure(cause));
  }

  private async routeRequest<T>(
    endpoint: string,
    payload: any,
    fallbackMethod: (cause?: unknown) => Promise<T>,
    options?: { timeoutMs?: number; allowAbortFallback?: boolean }
  ): Promise<T> {
    const now = Date.now();
    if (now < this.backendState.disabledUntil) return fallbackMethod();

    try {
      const controller = new AbortController();
      const overrideTimeout = Number(options?.timeoutMs);
      const timeoutMs = Number.isFinite(overrideTimeout) && overrideTimeout >= 1000
        ? overrideTimeout
        : this.resolveBackendTimeout(endpoint, payload);
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.backendUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};
      const hasCode = Number.isFinite(Number(data?.code));
      const envelopeOk = hasCode ? Number(data.code) === 0 : Boolean(data?.ok ?? true);
      const message = String(data?.message || data?.error || '');

      if (!response.ok || !envelopeOk) {
        throw new Error(message || `Backend Status: ${response.status}`);
      }

      this.backendState.consecutiveFailures = 0;
      this.backendState.disabledUntil = 0;
      return ((data && typeof data?.data === 'object') ? data.data : data) as T;
    } catch (error) {
      const isAbort = (error as any)?.name === 'AbortError';
      if (isAbort) {
        if (options?.allowAbortFallback) {
          return fallbackMethod();
        }
        throw new Error(`AI 请求超时（${endpoint}）`);
      }

      const nextFailures = this.backendState.consecutiveFailures + 1;
      this.backendState.consecutiveFailures = nextFailures;
      const cooldownMs = Math.min(60000, 2000 * Math.pow(2, Math.min(5, nextFailures)));
      this.backendState.disabledUntil = Date.now() + cooldownMs;
      console.warn(`⚠️ 后端 AI 不可用 (${endpoint})，${cooldownMs}ms 后重试。`, error);
      /*
        AI 挂了要进错误收集。
        同事碰到「AI 不能用」几乎不会来说 —— 他会以为是自己网不好，
        换个方式绕过去。而这恰恰是最该被管理员看见的一类故障。
      */
      reportClientError('api', String((error as any)?.message || error), { source: `AI${endpoint}` });
      return fallbackMethod(error);
    }
  }

  private cleanAndParseJSON(text: string | undefined): any {
    if (!text) return {};
    try {
      const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch {
      const snippet = (text || '').slice(0, 500);
      throw new Error(`JSON Parsing Failed. Raw: ${snippet}`);
    }
  }

  async generateText(modelName: string, prompt: string | any): Promise<string> {
    const model = this.normalizeModelName(modelName, this.defaultModel);
    const parts = typeof prompt === 'string' ? [{ text: prompt }] : (Array.isArray(prompt) ? prompt : [prompt]);
    const history = [{ role: 'user', parts }];

    const result = await this.routeRequest<{ text?: string }>(
      '/generate',
      { model, prompt: history },
      this.backendUnavailableFallback
    );

    return result.text || '';
  }

  async generateJSON(
    modelName: string,
    input: string | any[],
    options?: { inlineData?: any; timeoutMs?: number; allowAbortFallback?: boolean }
  ): Promise<any> {
    const model = this.normalizeModelName(modelName, this.defaultModel);
    const parts = typeof input === 'string' ? [{ text: input }] : (Array.isArray(input) ? [...input] : [input]);
    if (options?.inlineData) {
      parts.push({ inlineData: options.inlineData });
    }
    const history = [{ role: 'user', parts }];

    const result = await this.routeRequest<{ text?: string }>(
      '/generate',
      {
        model,
        prompt: history,
        config: { responseMimeType: 'application/json' }
      },
      this.backendUnavailableFallback,
      {
        timeoutMs: options?.timeoutMs,
        allowAbortFallback: Boolean(options?.allowAbortFallback)
      }
    );

    return typeof result.text === 'string' ? this.cleanAndParseJSON(result.text) : result;
  }

  async chat(modelName: string, history: any[], tools?: any[]): Promise<{ text: string; groundingMetadata?: any }> {
    const model = this.normalizeModelName(modelName, this.defaultModel);

    return this.routeRequest<{ text: string; groundingMetadata?: any }>(
      '/chat',
      { model, history, tools },
      this.backendUnavailableFallback
    );
  }

  async generateDeepStrategicInsight(contextData: any): Promise<any> {
    const prompt = `
      Role: 首席战略官 (CSO) - 专注于中国市场.
      Task: 基于企业数据生成一份**纯中文**的战略分析报告.
      Data: ${JSON.stringify(contextData)}
      
      Critical Requirements:
      1. **LANGUAGE**: Output MUST be in **Simplified Chinese (简体中文)** only. Do NOT use English.
      2. **TRANSLATION**: If the input data contains English, translate the analysis/insight into Chinese.
      3. Format: Strict JSON. Do NOT use markdown code blocks.
      
      Output JSON Structure:
      {
        "keyRecommendation": "一句话核心战略建议 (必须中文)",
        "swot": {
          "strengths": [{"content": "优势点 (必须中文)"}, {"content": "优势点 (必须中文)"}],
          "weaknesses": [{"content": "劣势点 (必须中文)"}],
          "opportunities": [{"content": "机会点 (必须中文)"}],
          "threats": [{"content": "威胁点 (必须中文)"}]
        },
        "marketGrowthHigh": ["业务A (中文)", "业务B (中文)"],
        "marketGrowthLow": ["业务C (中文)"],
        "marketShareHigh": ["业务D (中文)"],
        "marketShareLow": ["业务E (中文)"]
      }
    `;
    return this.generateJSON(this.defaultModel, prompt);
  }

  async classifyAndExtract(contentSnippet: string): Promise<any> {
    const prompt = `Classify document: "${contentSnippet.slice(0, 1000)}..." -> JSON: { "type": "CERTIFICATE"|"CONTRACT", "confidence": number, "data": {} }`;
    return this.generateJSON(this.defaultModel, prompt);
  }

  async analyzeProjectStatus(project: any): Promise<any> {
    const prompt = `
你现在是该项目的“交付总监”兼“风险控制专家”。请根据以下项目信息进行深度诊断：

项目概况：
- 名称：${project.name}
- 类别：${project.projectCategory}
- 状态：${project.status} (进度: ${project.progress}%)
- 截止日期：${project.deadline}
- 核心任务：${JSON.stringify(project.tasks?.map((t:any) => ({title: t.title, status: t.status, deadline: t.deadline})) || [])}
- 支付状态：${project.paymentStatus}

请输出严格的 JSON 格式（不要包含 markdown 代码块标记），结构如下：
{
  "analysisSummary": "简短的一句话诊断结论（例如：项目进度严重滞后，且核心任务已逾期，需立即介入）",
  "riskLevel": "High" | "Medium" | "Low",
  "suggestedActions": [
    {
      "type": "ADD_REMINDER" | "UPDATE_RISK" | "SUGGEST_TASK",
      "payload": { ...根据类型不同的参数... },
      "reason": "为什么要执行这个动作"
    }
  ]
}

Action Payload 规范：
1. ADD_REMINDER: { "content": "提醒内容", "priority": "High"|"Medium" }
2. UPDATE_RISK: { "level": "High"|"Medium" }
3. SUGGEST_TASK: { "title": "建议补充的任务名", "deadline": "建议截止日(YYYY-MM-DD)" }

逻辑判断准则（严格）：
1. 异常检测（High Risk）：
   - 任务逾期（deadline < today 且 status != 'Completed'）
   - 项目僵尸化（状态为 Active 但 tasks 为空）
   - 项目整体逾期
2. 风险预警（Medium Risk）：
   - 进度滞后（时间过半但进度 < 50%）
   - 长期未更新（虽然未逾期但很久没动）
3. 正常状态（Low Risk）：
   - 一切按计划推进
   - 无逾期、无停滞

**只针对异常或风险项目生成 High/Medium 建议，正常项目保持安静。**
`;
    return this.generateJSON(this.defaultModel, prompt);
  }

  async executeProjectTask(task: any, projectContext: any): Promise<{ result: string, success: boolean }> {
    const prompt = `
你现在是该项目的“数字员工”（AI 助手）。你需要根据任务标题和项目背景，实际执行这个任务。

项目背景：
- 名称：${projectContext.name}
- 类别：${projectContext.projectCategory}
- 客户：${projectContext.customerName || '未知客户'}

当前任务：
- 标题：${task.title}
- 截止日：${task.deadline}

请执行以下操作：
1. 分析任务意图（是写文档、做分析、还是出方案？）
2. 生成一份高质量的“交付物内容”（Markdown 格式）
3. 如果任务无法由 AI 完成（如“去现场拜访”），请输出“AI 无法执行现场物理任务，建议转交人工”。

请直接输出交付物内容（不需要 JSON，直接输出 Markdown 文本，作为任务的执行结果）。
`;
    try {
      const result = await this.generateText(this.defaultModel, prompt);
      return { result, success: true };
    } catch {
      return { result: 'AI 执行失败，请重试。', success: false };
    }
  }
}

export const aiService = new AIService();
