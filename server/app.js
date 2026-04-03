const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { initStateStore, upsertStateBatch, getStateBatch, getStateHealth } = require('./stateStore');
const { sendSuccess, sendFail, ERROR_CODES } = require('./utils/apiResponse');
const { MARKET_SIGNAL_STATUS } = require('../src/constants/status.js');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const API_KEY = process.env.KIMI_API_KEY || process.env.API_KEY || '';
const KIMI_BASE_URL = String(process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/$/, '');
const DEFAULT_MODEL = String(process.env.KIMI_MODEL || 'kimi-k2.5').trim();
const FALLBACK_MODEL = String(process.env.KIMI_FALLBACK_MODEL || '').trim();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_DEFAULT_MODEL = String(process.env.GEMINI_MODEL || 'gemini-3-flash').trim();
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash').trim();
const AI_PROVIDER_TIMEOUT_MS = Math.max(8000, Number(process.env.AI_PROVIDER_TIMEOUT_MS || 45000));

const USER_AGENT = 'XinyiIntelBot/5.0 (+https://xinyi.local)';
const INTEL_SEARCH_TIMEOUT_MS = Math.max(1500, Number(process.env.INTEL_SEARCH_TIMEOUT_MS || 3500));
const INTEL_DEBUG = /^(1|true|yes|on)$/i.test(String(process.env.INTEL_DEBUG || '').trim());
const INTEL_QUOTA_KINDS = ['policy', 'industry', 'company', 'tender'];
const DEFAULT_INTEL_KIND_QUOTA = Object.freeze({
  policy: 1,
  industry: 3,
  company: 4,
  tender: 2
});
const DEFAULT_INTEL_REGIONS = ['温州', '苍南', '平阳', '龙港'];
const DEFAULT_INTEL_INDUSTRIES = ['塑料编织制品制造业', '食包', '药材', '印刷', '食品', '餐饮'];
const REGION_FEATURED_INDUSTRIES = Object.freeze({
  温州: ['泵阀', '低压电器', '汽摩配', '鞋革', '服装', '智能装备'],
  苍南: ['塑料编织', '印刷包装', '食品包装', '纺织制品', '礼品工艺'],
  平阳: ['宠物用品', '塑料制品', '印刷包装', '食品加工', '文体用品'],
  龙港: ['印刷包装', '塑料编织', '新材料', '智能印刷', '文创用品']
});
const ENTERPRISE_SIGNAL_KEYWORDS = String(process.env.INTEL_ENTERPRISE_KEYWORDS || '企业 动态 更新 中标 订单 扩产 投产 签约 合作 融资 并购 上市 技改 数字化 智能化 专精特新 小巨人 单项冠军 龙头企业').trim();
const INDUSTRY_SIGNAL_KEYWORDS = String(process.env.INTEL_INDUSTRY_KEYWORDS || '行业 动态 产业 趋势 市场 供需 价格 景气 出口 产业链 技术 前沿 新材料 绿色低碳 产业集群 工业互联网 智能制造').trim();
const ASSOCIATION_EVENT_KEYWORDS = String(process.env.INTEL_ASSOCIATION_KEYWORDS || '行业协会 商会 学会 通知 论坛 峰会 展会 博览会 研讨会 对接会 产业联盟 企业家大会').trim();
const intelDebugLog = (...args) => {
  if (INTEL_DEBUG) console.log('[IntelDebug]', ...args);
};
const compactSearchTerms = (text, maxTerms = 8) => String(text || '')
  .split(/\s+/)
  .map((x) => x.trim())
  .filter(Boolean)
  .slice(0, Math.max(1, maxTerms))
  .join(' ');

const normalizeModelId = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_MODEL;
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
};

const getModelFallbackChain = (requestedModel) => {
  const first = normalizeModelId(requestedModel);
  const chain = [first];
  if (DEFAULT_MODEL && DEFAULT_MODEL !== first) chain.push(DEFAULT_MODEL);
  if (FALLBACK_MODEL && !chain.includes(FALLBACK_MODEL)) chain.push(FALLBACK_MODEL);
  return chain.filter(Boolean);
};

const resolveTemperature = (model, requested) => {
  const normalized = String(model || '').trim().toLowerCase();
  // kimi-k2.5 rejects custom temperature values.
  if (normalized === 'kimi-k2.5') return undefined;
  if (typeof requested === 'number') return requested;
  return 0.2;
};

const normalizeAIError = (error) => {
  const raw = String(error?.message || error || 'Unknown Error');
  try {
    const parsed = JSON.parse(raw);
    const inner = parsed?.error || parsed;
    return {
      message: inner?.message || raw,
      code: inner?.code || inner?.type || inner?.status,
      raw
    };
  } catch {
    return { message: raw, code: error?.code, raw };
  }
};

const hasAnyAIKey = () => Boolean(API_KEY || GEMINI_API_KEY);

const isRetryableError = (error) => {
  const msg = String(error?.message || error || '').toLowerCase();
  return /429|rate limit|quota|timeout|timed out|503|overloaded|temporarily unavailable|networkerror|failed to fetch/.test(msg);
};

const isModelUnavailableError = (status, code, message) => {
  const text = `${String(code || '')} ${String(message || '')}`.toLowerCase();
  if (status === 404) return true;
  if (status === 400 && /model|not found|unsupported|invalid|does not exist/.test(text)) return true;
  return false;
};

const isKimiQuotaOrBalanceError = (error) => {
  const normalized = normalizeAIError(error);
  const text = `${String(normalized.message || '')} ${String(normalized.code || '')} ${String(normalized.raw || '')}`.toLowerCase();
  return /429|quota|insufficient[_\s-]?quota|insufficient balance|balance|credit|billing|payment required|rate limit|too many requests|resource_exhausted|余额不足|余额|费用不足|欠费|配额不足|超出配额|限流/.test(text);
};

const toHttpStatus = (code, message) => {
  const msg = String(message || '').toLowerCase();
  if (
    code === '429' ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('429') ||
    msg.includes('insufficient balance') ||
    msg.includes('payment required') ||
    msg.includes('余额不足') ||
    msg.includes('费用不足')
  ) return 429;
  if (msg.includes('invalid') || msg.includes('bad request')) return 400;
  if (msg.includes('not found')) return 404;
  return 500;
};

const toInternalErrorCode = (code, message) => {
  const normalizedCode = String(code || '').toUpperCase();
  const status = toHttpStatus(code, message);
  if (normalizedCode === 'NO_KEY') return ERROR_CODES.AI_KEY_MISSING;
  if (status === 429) return ERROR_CODES.RATE_LIMIT;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 400) return ERROR_CODES.PARAM_ERROR;
  return ERROR_CODES.AI_PROVIDER_ERROR;
};

const normalizeBase64 = (rawData) => {
  const raw = String(rawData || '');
  const marker = 'base64,';
  const idx = raw.indexOf(marker);
  if (idx >= 0) return raw.slice(idx + marker.length);
  return raw;
};

const toOpenAIContent = (parts) => {
  const rich = [];
  let hasRichMedia = false;

  (Array.isArray(parts) ? parts : []).forEach((part) => {
    if (part?.text) {
      rich.push({ type: 'text', text: String(part.text) });
      return;
    }

    const inlineData = part?.inlineData;
    if (!inlineData?.data) return;

    const mimeType = String(inlineData.mimeType || 'application/octet-stream');
    const base64 = normalizeBase64(String(inlineData.data || ''));

    if (mimeType.startsWith('image/')) {
      hasRichMedia = true;
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

  if (!hasRichMedia) {
    return rich
      .filter((x) => x.type === 'text')
      .map((x) => x.text)
      .join('\n')
      .trim();
  }

  return rich;
};

const normalizeRole = (roleRaw) => {
  const role = String(roleRaw || 'user');
  if (role === 'model' || role === 'assistant') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
};

const convertHistoryToMessages = (history) => {
  if (!Array.isArray(history)) return [];
  return history.map((msg) => ({
    role: normalizeRole(msg?.role),
    content: toOpenAIContent(Array.isArray(msg?.parts) ? msg.parts : [{ text: String(msg?.text || '') }])
  }));
};

const extractTextFromChoice = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      if (chunk.type === 'text') return String(chunk.text || '');
      return '';
    })
    .join('\n')
    .trim();
};

const requestKimiCompletion = async ({
  requestedModel,
  messages,
  jsonMode = false,
  temperature = 0.2,
  disableFallback = false
}) => {
  if (!API_KEY) {
    const err = new Error('KIMI_API_KEY 未配置');
    err.code = 'NO_KEY';
    throw err;
  }

  const models = disableFallback ? [normalizeModelId(requestedModel)] : getModelFallbackChain(requestedModel);
  let lastError = null;

  for (const model of models) {
    if (!model) continue;

    const temp = resolveTemperature(model, temperature);
    const body = {
      model,
      messages,
      ...(temp === undefined ? {} : { temperature: temp }),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        const err = new Error(data?.error?.message || data?.message || raw || `HTTP ${res.status}`);
        err.code = String(data?.error?.code || res.status);
        throw err;
      }

      const message = data?.choices?.[0]?.message;
      const text = extractTextFromChoice(message?.content);
      return {
        text,
        modelUsed: model,
        raw: data
      };
    } catch (error) {
      let retryProbe = error;
      if (String(error?.name || '') === 'AbortError') {
        const timeoutErr = new Error(`Kimi provider timeout (${AI_PROVIDER_TIMEOUT_MS}ms)`);
        timeoutErr.code = 'TIMEOUT';
        lastError = timeoutErr;
        retryProbe = timeoutErr;
      } else {
        lastError = error;
      }
      if (disableFallback || !isRetryableError(retryProbe)) break;
    } finally {
      clearTimeout(timer);
    }
  }

  const normalized = normalizeAIError(lastError || new Error('Unknown AI Error'));
  const err = new Error(normalized.message);
  err.code = normalized.code;
  throw err;
};

const requestGeminiCompletion = async ({
  requestedModel,
  messages,
  jsonMode = false,
  temperature = 0.2
}) => {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY 未配置');
    err.code = 'NO_KEY';
    throw err;
  }

  const modelRaw = (requestedModel || '').toLowerCase();
  const modelChain = Array.from(new Set(
    [
      modelRaw.includes('gemini') ? modelRaw : '',
      GEMINI_DEFAULT_MODEL,
      GEMINI_FALLBACK_MODEL,
      'gemini-1.5-flash'
    ].map((x) => String(x || '').trim()).filter(Boolean)
  ));

  let systemInstruction = undefined;
  const contents = [];

  for (const msg of messages) {
    const contentText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    if (msg.role === 'system') {
      if (!systemInstruction) systemInstruction = { parts: [{ text: contentText }] };
      else systemInstruction.parts[0].text += '\n' + contentText;
    } else {
      const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
      contents.push({ role, parts: [{ text: contentText }] });
    }
  }

  // Gemini requires non-empty contents
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  let lastError = null;
  for (const model of modelChain) {
    const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents,
      ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
      generationConfig: {
        temperature,
        ...(jsonMode ? { response_mime_type: 'application/json' } : {})
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        const parseErr = new Error(`Gemini response parse error: ${raw}`);
        parseErr.code = 'PARSE_ERROR';
        throw parseErr;
      }

      if (!res.ok) {
        const code = String(data?.error?.code || res.status);
        const msg = data?.error?.message || raw || `Gemini Error ${res.status}`;
        const err = new Error(`Gemini Error ${res.status}: ${msg}`);
        err.code = code;
        if (isModelUnavailableError(res.status, code, msg)) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { text, modelUsed: model, raw: data };
    } catch (error) {
      let retryProbe = error;
      if (String(error?.name || '') === 'AbortError') {
        const timeoutErr = new Error(`Gemini provider timeout (${AI_PROVIDER_TIMEOUT_MS}ms)`);
        timeoutErr.code = 'TIMEOUT';
        lastError = timeoutErr;
        retryProbe = timeoutErr;
      } else {
        lastError = error;
      }
      if (!isRetryableError(retryProbe)) break;
    } finally {
      clearTimeout(timer);
    }
  }

  const normalized = normalizeAIError(lastError || new Error('Gemini Unknown Error'));
  const err = new Error(normalized.message);
  err.code = normalized.code;
  throw err;
};

const requestAI = async (params) => {
  const model = (params.requestedModel || '').toLowerCase();
  // 1. Explicit Gemini request
  if (model.includes('gemini')) {
    return requestGeminiCompletion(params);
  }

  // 2. Kimi request (default)
  try {
    // If NO Kimi key but HAVE Gemini key, skip Kimi and go straight to Gemini
    if (!API_KEY && GEMINI_API_KEY) {
      throw new Error('KIMI_API_KEY_MISSING_USE_GEMINI');
    }
    return await requestKimiCompletion(params);
  } catch (err) {
    // 3. Fallback to Gemini if Kimi fails (quota, rate limit, or no key)
    const normalized = normalizeAIError(err);
    const isQuotaError = isKimiQuotaOrBalanceError(err);
    const isKeyMissing = normalized.message === 'KIMI_API_KEY_MISSING_USE_GEMINI' || String(normalized.code || '') === 'NO_KEY';
    const isTransientError = isRetryableError(err);
    
    if (GEMINI_API_KEY && (isQuotaError || isKeyMissing || isTransientError)) {
      console.warn(`[AI Fallback] Kimi failed (${normalized.message}), switching to Gemini...`);
      return requestGeminiCompletion({ ...params, requestedModel: GEMINI_DEFAULT_MODEL });
    }
    const out = new Error(normalized.message);
    out.code = normalized.code;
    throw out;
  }
};

const withTimeout = async (promise, ms, message) => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || 'Operation timeout')), Math.max(1000, ms));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const fetchTextWithTimeout = async (url, { headers = {}, timeoutMs = INTEL_SEARCH_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || INTEL_SEARCH_TIMEOUT_MS));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
};

const stripHtml = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const decodeDuckRedirect = (href) => {
  try {
    let url = String(href || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = `https:${url}`;
    const u = new URL(url);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return url;
  } catch {
    return String(href || '').trim();
  }
};

const parseDuckResults = (html, limit = 8) => {
  const results = [];
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="result__a"[\s\S]*?<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [];
  let sm = null;
  while ((sm = snippetRe.exec(html)) !== null && snippets.length < limit * 2) {
    snippets.push(stripHtml(sm[1]).slice(0, 220));
  }

  let m = null;
  let i = 0;
  while ((m = titleRe.exec(html)) !== null && results.length < limit) {
    const rawHref = m[1];
    const title = stripHtml(m[2]);
    const url = decodeDuckRedirect(rawHref);
    if (!title || !url) continue;
    results.push({ title, url, snippet: snippets[i] || '' });
    i += 1;
  }

  return results;
};

const parseDuckResultsFromMarkdown = (markdown, limit = 8) => {
  const text = String(markdown || '');
  const lines = text.split('\n').map((line) => line.trim());
  const linkOnlyRe = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
  const results = [];
  const seen = new Set();

  for (let i = 0; i < lines.length && results.length < limit * 2; i += 1) {
    const line = lines[i];
    const m = line.match(linkOnlyRe);
    if (!m) continue;

    const rawTitle = String(m[1] || '').trim();
    const rawUrl = String(m[2] || '').trim();
    if (!rawTitle || !rawUrl) continue;
    if (rawTitle.includes('Image') || rawTitle.startsWith('![') || rawTitle.includes('DuckDuckGo')) continue;

    const decodedUrl = decodeDuckRedirect(rawUrl);
    if (!decodedUrl || seen.has(decodedUrl)) continue;
    seen.add(decodedUrl);

    const snippetParts = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const next = lines[j];
      if (!next) continue;
      if (/^\[!\[Image/i.test(next)) continue;
      if (/^[-=]{4,}$/.test(next)) continue;
      if (linkOnlyRe.test(next)) break;
      const cleaned = next
        .replace(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) continue;
      snippetParts.push(cleaned);
      if (snippetParts.join(' ').length > 260) break;
    }

    results.push({
      title: stripHtml(rawTitle).replace(/\s+/g, ' ').trim(),
      url: decodedUrl,
      snippet: snippetParts.join(' ').slice(0, 240)
    });
  }

  return results.slice(0, limit);
};

const isNoiseUrl = (url) => {
  const u = String(url || '').toLowerCase();
  return /facebook\.com|douyin\.com|tiktok\.com|xiaohongshu\.com|weibo\.com|youtube\.com|bilibili\.com|instagram\.com/.test(u);
};

const parseBaiduResultsFromMarkdown = (md, limit = 8) => {
  const text = String(md || '');
  if (!text) return [];
  const re = /###\s*\[([^\]]+)\]\((https?:\/\/www\.baidu\.com\/link\?url=[^) \t\n\r]+)\)/g;
  const matches = [];
  let m = null;
  while ((m = re.exec(text)) !== null) {
    matches.push({
      title: stripHtml(String(m[1] || '')).replace(/\s+/g, ' ').trim(),
      baiduUrl: String(m[2] || '').trim(),
      start: m.index,
      end: re.lastIndex
    });
    if (matches.length >= Math.max(10, limit * 3)) break;
  }
  if (matches.length === 0) return [];

  const out = [];
  for (let i = 0; i < matches.length && out.length < limit; i += 1) {
    const cur = matches[i];
    const next = matches[i + 1];
    const tail = text.slice(cur.end, next ? next.start : Math.min(text.length, cur.end + 2200));
    const snippet = tail
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter((line) => line && !line.startsWith('![') && !/^\[!\[Image/i.test(line) && !/^_/.test(line))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    out.push({ title: cur.title, url: cur.baiduUrl, snippet });
  }
  return out;
};

const parseBaiduResultsFromHtml = (html, limit = 8) => {
  const text = String(html || '');
  if (!text) return [];
  const re = /href="(https?:\/\/www\.baidu\.com\/link\?url=[^"]+)"[^>]{0,300}data-module="title"/g;
  const out = [];
  const seen = new Set();
  let m = null;
  while ((m = re.exec(text)) !== null && out.length < limit * 2) {
    const link = String(m[1] || '').trim();
    if (!link || seen.has(link)) continue;
    seen.add(link);
    const tail = text.slice(re.lastIndex, Math.min(text.length, re.lastIndex + 1200));
    const titleMatch = tail.match(/<!--s-text-->([\s\S]*?)<!--\/s-text-->/);
    const title = titleMatch
      ? stripHtml(String(titleMatch[1] || '')).replace(/\s+/g, ' ').trim()
      : '';
    if (!title) continue;
    const snippet = stripHtml(tail).replace(/\s+/g, ' ').trim().slice(0, 240);
    out.push({ title, url: link, snippet });
  }
  return out.slice(0, limit);
};

const resolveWeChatArticleUrlFromBaiduLink = async (baiduLink) => {
  const rawInput = String(baiduLink || '').trim();
  if (!rawInput) return '';
  // Baidu redirect endpoints behave more consistently over https.
  const raw = rawInput.replace(/^http:\/\/www\.baidu\.com\/link\?/i, 'https://www.baidu.com/link?');
  if (!raw) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(raw, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: controller.signal
    });
    const finalUrl = String(res.url || '');
    try { res.body?.cancel(); } catch {}
    if (!finalUrl) return '';

    // Common: mp.weixin.qq.com captcha wrapper that contains target_url=...
    try {
      const u = new URL(finalUrl);
      if (u.hostname === 'mp.weixin.qq.com' && u.pathname.startsWith('/mp/wappoc_appmsgcaptcha')) {
        const target = u.searchParams.get('target_url');
        if (target) return decodeURIComponent(target);
      }
    } catch {}

    if (finalUrl.includes('mp.weixin.qq.com/')) return finalUrl;
    return '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
};

const searchWeChatIndexed = async (query, limit = 8) => {
  const q = String(query || '').trim();
  if (!q) return [];

  // WeChat direct crawling frequently triggers CAPTCHA; use Baidu-indexed snippets + redirect resolution.
  const baiduUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`;
  const html = await fetchTextWithTimeout(baiduUrl, {
    timeoutMs: INTEL_SEARCH_TIMEOUT_MS + 3500,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });
  if (!html) return [];
  if (html.includes('百度安全验证') || html.includes('网络不给力') || html.includes('请完成下方验证')) return [];

  const resolveNeed = Math.max(1, Math.min(2, toNonNegativeInt(process.env.INTEL_WECHAT_RESOLVE_LIMIT, 2)));
  let raw = parseBaiduResultsFromHtml(html, Math.max(3, Math.min(10, Math.max(limit, resolveNeed * 3))));
  if (raw.length === 0) {
    // Fallback: sometimes direct HTML structure changes; try Jina markdown as a backup.
    const md = await fetchTextWithTimeout(`https://r.jina.ai/${baiduUrl}`, {
      timeoutMs: INTEL_SEARCH_TIMEOUT_MS + 3500,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    if (md && !md.includes('百度安全验证')) {
      raw = parseBaiduResultsFromMarkdown(md, Math.max(3, Math.min(10, Math.max(limit, resolveNeed * 3))));
    }
  }
  if (raw.length === 0) return [];

  // Resolve a small number of top results in parallel (best-effort) to keep fetch latency stable.
  const candidates = raw.slice(0, Math.max(resolveNeed * 2, resolveNeed));
  const settled = await Promise.allSettled(candidates.map(async (item) => {
    const targetUrl = await resolveWeChatArticleUrlFromBaiduLink(item.url);
    if (!targetUrl) return null;
    return { title: item.title, url: targetUrl, snippet: String(item.snippet || '').slice(0, 240) };
  }));
  const resolved = settled
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(limit, resolveNeed)));
  return resolved;
};

const searchWeb = async (query, limit = 8) => {
  const q = String(query || '').trim();
  if (!q) return [];

  // r.jina.ai is usually more stable in CN network than direct duckduckgo html page.
  const sourceUrls = [
    `http://duckduckgo.com/html/?kl=cn-zh&df=m&q=${encodeURIComponent(q)}`,
    `http://duckduckgo.com/html/?kl=cn-zh&df=y&q=${encodeURIComponent(q)}`
  ];
  for (const sourceUrl of sourceUrls) {
    const jinaUrl = `https://r.jina.ai/${sourceUrl}`;
    const md = await fetchTextWithTimeout(jinaUrl, {
      timeoutMs: INTEL_SEARCH_TIMEOUT_MS + 2000,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    if (!md) continue;
    const parsed = parseDuckResultsFromMarkdown(md, limit);
    const cleaned = parsed.filter((x) => !isNoiseUrl(x.url));
    if (cleaned.length > 0) return cleaned;
  }

  // Last fallback: direct html endpoint.
  const directUrls = [
    `https://html.duckduckgo.com/html/?kl=cn-zh&df=y&q=${encodeURIComponent(q)}`,
    `https://duckduckgo.com/html/?kl=cn-zh&df=y&q=${encodeURIComponent(q)}`
  ];
  for (const url of directUrls) {
    const html = await fetchTextWithTimeout(url, {
      timeoutMs: INTEL_SEARCH_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    if (!html) continue;
    const parsed = parseDuckResults(html, limit);
    const cleaned = parsed.filter((x) => !isNoiseUrl(x.url));
    if (cleaned.length > 0) return cleaned;
  }

  return [];
};

const crawlPage = async (url, maxChars = 2000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    });
    if (!res.ok) return '';

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const raw = await res.text();

    if (contentType.includes('application/pdf')) {
      return '[PDF 文档，当前仅采集到链接，建议人工打开核验]';
    }

    if (contentType.includes('application/json')) {
      return String(raw || '').slice(0, maxChars);
    }

    return stripHtml(raw).slice(0, maxChars);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
};

const buildWebContextForQuery = async (query, maxResults = 5, deepCrawl = false, kindHint = '') => {
  const hint = String(kindHint || '').toLowerCase().trim();
  const results = hint === 'wechat'
    ? await searchWeChatIndexed(query, maxResults)
    : await searchWeb(query, maxResults);
  const picked = results.slice(0, maxResults);
  if (picked.length === 0) return [];

  // Fast path: use search snippets only. This keeps intel fetch stable.
  if (!deepCrawl) {
    return picked.map((item) => ({ ...item, excerpt: item.snippet || '' }));
  }

  // Deep crawl is used for chat/web-grounding where richer context helps.
  return Promise.all(
    picked.map(async (item) => {
      const excerpt = await crawlPage(item.url, 900);
      return { ...item, excerpt: excerpt || item.snippet || '' };
    })
  );
};

// -------- Intel Radar Store & Scheduler --------
const intelStorePath = path.resolve(__dirname, './intel_store.json');

const readIntelStore = () => {
  try {
    if (fs.existsSync(intelStorePath)) {
      const raw = fs.readFileSync(intelStorePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Intel store read failed', e);
  }
  return { lastRunAt: '', regions: [], industries: [], signals: [] };
};

const writeIntelStore = (store) => {
  try {
    fs.writeFileSync(intelStorePath, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('Intel store write failed', e);
  }
};

const normalizeList = (val) => Array.isArray(val) ? val.map(String).filter(Boolean) : [];
const toNonNegativeInt = (raw, fallback = 0) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(n));
};

const resolveIntelKindQuota = (limit) => {
  const raw = {
    policy: toNonNegativeInt(process.env.INTEL_QUOTA_POLICY, DEFAULT_INTEL_KIND_QUOTA.policy),
    industry: toNonNegativeInt(process.env.INTEL_QUOTA_INDUSTRY, DEFAULT_INTEL_KIND_QUOTA.industry),
    company: toNonNegativeInt(process.env.INTEL_QUOTA_COMPANY, DEFAULT_INTEL_KIND_QUOTA.company),
    tender: toNonNegativeInt(process.env.INTEL_QUOTA_TENDER, DEFAULT_INTEL_KIND_QUOTA.tender)
  };
  const maxTotal = Math.max(0, toNonNegativeInt(limit, 20));
  const quota = { policy: 0, industry: 0, company: 0, tender: 0 };
  if (maxTotal <= 0) return quota;

  const totalSeed = INTEL_QUOTA_KINDS.reduce((acc, kind) => acc + Math.max(0, Number(raw[kind] || 0)), 0);
  if (totalSeed <= 0) return quota;

  // If limit >= seed sum, keep seed quotas and let remaining slots be "flex fill".
  if (maxTotal >= totalSeed) {
    for (const kind of INTEL_QUOTA_KINDS) quota[kind] = Math.max(0, Number(raw[kind] || 0));
    return quota;
  }

  // Scale seed quotas proportionally when limit is smaller than seed sum.
  const fractions = [];
  let used = 0;
  for (const kind of INTEL_QUOTA_KINDS) {
    const exact = (Number(raw[kind] || 0) / totalSeed) * maxTotal;
    const base = Math.max(0, Math.floor(exact));
    quota[kind] = base;
    used += base;
    fractions.push({ kind, frac: exact - base });
  }

  let remain = maxTotal - used;
  fractions.sort((a, b) => b.frac - a.frac);
  for (const item of fractions) {
    if (remain <= 0) break;
    quota[item.kind] += 1;
    remain -= 1;
  }
  return quota;
};

const expandIndustries = (industries) => {
  const aliases = {
    '塑编': ['塑料编织', '塑料编织制品', '塑料编织制品制造业', '编织袋', '集装袋'],
    '塑料编织制品制造业': ['塑料编织', '塑料编织制品', '塑料编织制品制造业', '编织袋', '集装袋'],
    '食包': ['食品包装', '食品包装材料', '包装材料', '软包装'],
    '药材': ['中药材', '药品', '医药', '医疗器械', '生物医药'],
    '印刷': ['印刷业', '包装印刷', '彩印', '标签印刷', '数码印刷'],
    '食品': ['食品生产', '食品加工', '食品制造'],
    '餐饮': ['餐饮业', '餐饮服务'],
    '泵阀': ['泵阀', '阀门', '流体设备'],
    '低压电器': ['低压电器', '电气设备', '电器制造'],
    '汽摩配': ['汽摩配', '汽车零部件', '摩托车配件'],
    '鞋革': ['鞋革', '鞋业', '皮革制品'],
    '服装': ['服装', '纺织服装', '面辅料'],
    '智能装备': ['智能装备', '智能制造', '自动化设备'],
    '宠物用品': ['宠物用品', '宠物食品', '宠物产业'],
    '新材料': ['新材料', '功能材料', '高分子材料']
  };
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(industries) ? industries : []) {
    const candidates = [x, ...(aliases[x] || [])];
    for (const item of candidates) {
      const text = String(item || '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
};

const parseIntelList = (rawText) => {
  let parsed = null;
  try {
    const cleaned = String(rawText || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '');
    parsed = JSON.parse(cleaned);
  } catch {
    const m = String(rawText || '').match(/\[[\s\S]*\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (Array.isArray(parsed.signals)) return parsed.signals;
  }
  return [];
};

const HOMEPAGE_PATH_RE = /^\/(?:(?:index|home|main|default)(?:\.[a-z0-9]+)?)?$/i;
const LIST_PAGE_PATH_RE = /^\/(?:index|channel|col|list|node|zwgk|xxgk|xwzx)(?:\/|$)/i;
const ARTICLE_PATH_HINT_RE = /\/(?:art|article|content|detail|news|notice|show|view|tzgg|zwgk)[\/_.-]/i;

const LOW_VALUE_HOST_RE = /(?:^|\.)(11467\.com|1688\.com|aiqicha\.baidu\.com|qcc\.com|tianyancha\.com|huangye88\.com|b2b\.baidu\.com|facebook\.com|douyin\.com|tiktok\.com|xiaohongshu\.com|weibo\.com|youtube\.com|bilibili\.com|jobui\.com|docin\.com|renrendoc\.com|wenku\.baidu\.com|made-in-china\.com)$/i;
const HIGH_VALUE_HOST_RE = /(?:^|\.)(gov\.cn|wenzhou\.gov\.cn|zj\.gov\.cn|zjlg\.gov\.cn|zjpy\.gov\.cn|ccgp\.gov\.cn|cebpubservice\.com|cninfo\.com\.cn|eastmoney\.com|stcn\.com|sina\.com\.cn|foodmate\.net|mp\.weixin\.qq\.com)$/i;
const HIGH_VALUE_KEYWORD_RE = /政策|通知|公告|公示|监管|办法|条例|标准|国标|行标|招标|招采|采购|项目申报|专项资金/;
const INDUSTRY_NEWS_KEYWORD_RE = /行业|市场|产业|动态|新闻|趋势|景气|需求|价格|扩产|投产|开工|落地|招商|合作|并购|融资|上市|中标|订单/;
const LOW_VALUE_TITLE_RE = /顺企网|爱企查|黄页|企业信息查询|公司详情|厂家|工厂|阿里巴巴|短视频|直播|排行榜|公司排名|企业排名|下载|文档|资料库|模板|百科|供应商|制造商|名录/;
const DATE_CANDIDATE_RE = /((?:19|20)\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?/g;
const DATE_HINT_RE = /(发布时间|发布日期|更新于|更新|发布于|日期|时间|公示时间|公告时间)/;
const RECENT_HINT_RE = /最新|近日|近期|今日|昨天|本周|本月|刚刚|发布|公示|公告|通知|招标|招采|采购|截止|开标|投标|中标|签约|开工|落地|投产|扩产|融资|并购/;
const YEAR_CANDIDATE_RE = /(?:19|20)\d{2}/g;
const INTEL_RECENCY_DAYS = Object.freeze({
  policy: toNonNegativeInt(process.env.INTEL_RECENCY_POLICY_DAYS, 90),
  tender: toNonNegativeInt(process.env.INTEL_RECENCY_TENDER_DAYS, 90),
  standard: toNonNegativeInt(process.env.INTEL_RECENCY_STANDARD_DAYS, 90),
  industry: toNonNegativeInt(process.env.INTEL_RECENCY_INDUSTRY_DAYS, 90),
  company: toNonNegativeInt(process.env.INTEL_RECENCY_COMPANY_DAYS, 90),
  event: toNonNegativeInt(process.env.INTEL_RECENCY_EVENT_DAYS, 90)
});
const INTEL_UNDATED_MAX_AGE_DAYS = toNonNegativeInt(process.env.INTEL_UNDATED_MAX_AGE_DAYS, 45);
const REGION_ALIAS_MAP = Object.freeze({
  温州: ['温州', '温州市', 'wenzhou', 'wz.gov.cn', '66wz.com'],
  苍南: ['苍南', '苍南县', 'cangnan'],
  平阳: ['平阳', '平阳县', 'pingyang', 'zjpy.gov.cn'],
  龙港: ['龙港', '龙港市', 'longgang', 'zjlg.gov.cn']
});
const ZHEJIANG_PROVINCE_ALIASES = Object.freeze(['浙江', '浙江省', 'zhejiang', 'zj.gov.cn']);
const ZHEJIANG_DEFAULT_REGIONS = Object.freeze(['温州', '苍南', '平阳', '龙港']);
const DEFAULT_INTEL_WECHAT_ACCOUNTS = Object.freeze([
  '浙江经信',
  '中国排污许可',
  '质量与认证',
  '新知探索科创',
  '圆明园遗址公园'
]);
const DEFAULT_INTEL_WECHAT_EXCLUDE = Object.freeze(['浙江信义企业管理有限公司']);
const OFF_SCOPE_PROVINCE_HINTS = Object.freeze([
  '北京', '天津', '上海', '重庆',
  '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '江苏', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南',
  '四川', '贵州', '云南', '西藏',
  '陕西', '甘肃', '青海', '宁夏', '新疆',
  '香港', '澳门', '台湾'
]);
const OFF_SCOPE_CITY_HINTS = Object.freeze([
  '信阳', '南阳', '阜阳', '安阳', '濮阳', '沈阳', '德阳', '绵阳', '贵阳', '襄阳', '揭阳', '庆阳', '洛阳', '郑州'
]);
const LATIN_TOKEN_RE = /^[a-z0-9_.-]+$/i;

const escapeRegExp = (text) => String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniqueList = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map((x) => String(x || '').trim()).filter(Boolean)));

const isWeChatArticleUrl = (rawUrl) => {
  try { return new URL(String(rawUrl || '')).hostname === 'mp.weixin.qq.com'; } catch { return false; }
};

const includesRegionAlias = (text, alias) => {
  const source = String(text || '');
  const token = String(alias || '').trim();
  if (!source || !token) return false;
  if (LATIN_TOKEN_RE.test(token)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token.toLowerCase())}([^a-z0-9]|$)`, 'i').test(source.toLowerCase());
  }
  return source.includes(token);
};

const resolveRegionAliases = (region) => {
  const canonical = String(region || '').trim();
  if (!canonical) return [];
  return uniqueList([canonical, ...(REGION_ALIAS_MAP[canonical] || [])]);
};

const buildGeoText = (...parts) => parts
  .map((part) => String(part || '').trim())
  .filter(Boolean)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const shouldAllowZhejiangProvince = (selectedRegions) => {
  const regions = uniqueList(selectedRegions);
  if (regions.length === 0) return false;
  return regions.some((r) => ZHEJIANG_DEFAULT_REGIONS.includes(r));
};

const hasZhejiangProvinceHint = (text) => {
  const source = String(text || '');
  if (!source) return false;
  return ZHEJIANG_PROVINCE_ALIASES.some((alias) => includesRegionAlias(source, alias));
};

const resolveZhejiangFallbackRegion = (selectedRegions) => {
  const regions = uniqueList(selectedRegions);
  if (regions.includes('温州')) return '温州';
  return regions[0] || '温州';
};

const inferMatchedRegionsFromText = (text, selectedRegions) => {
  const source = String(text || '');
  if (!source) return [];
  const regions = uniqueList(selectedRegions);
  const matched = [];
  for (const region of regions) {
    const aliases = resolveRegionAliases(region);
    if (aliases.some((alias) => includesRegionAlias(source, alias))) {
      matched.push(region);
    }
  }
  return matched;
};

const hasOutOfScopeGeoHint = (text, selectedRegions, matchedRegions = []) => {
  const source = String(text || '');
  if (!source) return false;
  if (Array.isArray(matchedRegions) && matchedRegions.length > 0) return false;

  const selectedSet = new Set(uniqueList(selectedRegions));
  const hasProvinceHint = OFF_SCOPE_PROVINCE_HINTS.some((name) => !selectedSet.has(name) && source.includes(name));
  if (hasProvinceHint) return true;
  return OFF_SCOPE_CITY_HINTS.some((name) => !selectedSet.has(name) && source.includes(name));
};

const applyGeoScopeToSources = (sources, selectedRegions) => {
  const scopedRegions = uniqueList(selectedRegions);
  if (scopedRegions.length === 0) {
    return { sources: Array.isArray(sources) ? sources : [], droppedGeo: 0, droppedGeoConflict: 0 };
  }
  const out = [];
  let droppedGeo = 0;
  let droppedGeoConflict = 0;

  for (const item of Array.isArray(sources) ? sources : []) {
    const geoText = buildGeoText(item?.title, item?.snippet, item?.excerpt, item?.url);
    const matchedRegions = inferMatchedRegionsFromText(geoText, scopedRegions);
    if (matchedRegions.length === 0) {
      // Province-level signal (e.g. 浙江省级政策/资讯) is still relevant to 温州/苍南/平阳/龙港.
      if (shouldAllowZhejiangProvince(scopedRegions) && hasZhejiangProvinceHint(geoText)) {
        out.push({ ...item, _matchedRegions: [resolveZhejiangFallbackRegion(scopedRegions)] });
        continue;
      }
      // WeChat whitelisted queries often lack explicit region tokens in snippet/excerpt.
      // Keep them unless they explicitly conflict with out-of-scope geo hints.
      if (isWeChatArticleUrl(item?.url) && String(item?._queryKindHint || '') === 'wechat' && !hasOutOfScopeGeoHint(geoText, scopedRegions, matchedRegions)) {
        out.push({ ...item, _matchedRegions: [resolveZhejiangFallbackRegion(scopedRegions)] });
        continue;
      }
      if (hasOutOfScopeGeoHint(geoText, scopedRegions, matchedRegions)) droppedGeoConflict += 1;
      else droppedGeo += 1;
      continue;
    }
    out.push({ ...item, _matchedRegions: matchedRegions });
  }

  return { sources: out, droppedGeo, droppedGeoConflict };
};

const applyGeoScopeToSignals = (signals, selectedRegions) => {
  const scopedRegions = uniqueList(selectedRegions);
  if (scopedRegions.length === 0) {
    return { signals: Array.isArray(signals) ? signals : [], droppedGeo: 0, droppedGeoConflict: 0 };
  }
  const out = [];
  let droppedGeo = 0;
  let droppedGeoConflict = 0;

  for (const signal of Array.isArray(signals) ? signals : []) {
    const geoText = buildGeoText(
      signal?.title,
      signal?.summary,
      signal?.content,
      signal?.sourceName,
      signal?.sourceUrl
    );
    const matchedRegions = inferMatchedRegionsFromText(geoText, scopedRegions);
    if (matchedRegions.length === 0) {
      if (shouldAllowZhejiangProvince(scopedRegions) && hasZhejiangProvinceHint(geoText)) {
        out.push({ ...signal, regions: [resolveZhejiangFallbackRegion(scopedRegions)] });
        continue;
      }
      if (isWeChatArticleUrl(signal?.sourceUrl) && !hasOutOfScopeGeoHint(geoText, scopedRegions, matchedRegions)) {
        out.push({ ...signal, regions: [resolveZhejiangFallbackRegion(scopedRegions)] });
        continue;
      }
      if (hasOutOfScopeGeoHint(geoText, scopedRegions, matchedRegions)) droppedGeoConflict += 1;
      else droppedGeo += 1;
      continue;
    }
    out.push({ ...signal, regions: matchedRegions });
  }

  return { signals: out, droppedGeo, droppedGeoConflict };
};

const looksRecentText = (text, todayDate = new Date()) => {
  const src = String(text || '');
  if (!src) return false;
  if (RECENT_HINT_RE.test(src)) return true;
  const years = [];
  let m = null;
  while ((m = YEAR_CANDIDATE_RE.exec(src)) !== null) {
    const y = Number(m[0]);
    if (Number.isFinite(y)) years.push(y);
  }
  YEAR_CANDIDATE_RE.lastIndex = 0;
  if (years.length === 0) return false;
  const currentYear = todayDate.getUTCFullYear();
  return years.includes(currentYear);
};

const isLikelyHomepageUrl = (rawUrl) => {
  try {
    const u = new URL(String(rawUrl || '').trim());
    const path = String(u.pathname || '/').toLowerCase();
    const search = String(u.search || '');
    if (HOMEPAGE_PATH_RE.test(path)) return true;
    if (LIST_PAGE_PATH_RE.test(path) && !search) return true;
    if (path.endsWith('/index.html') || path.endsWith('/index.htm')) return true;
    if (ARTICLE_PATH_HINT_RE.test(path)) return false;
    return false;
  } catch {
    return true;
  }
};

const isHighValueSource = (item) => {
  const title = String(item?.title || '');
  const url = String(item?.url || '');
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }

  if (!host) return false;
  if (isLikelyHomepageUrl(url)) return false;
  if (LOW_VALUE_HOST_RE.test(host)) return false;
  if (LOW_VALUE_TITLE_RE.test(title)) return false;
  if (HIGH_VALUE_HOST_RE.test(host)) return true;

  const merged = `${title} ${item?.snippet || ''} ${item?.excerpt || ''}`;
  return HIGH_VALUE_KEYWORD_RE.test(merged) || INDUSTRY_NEWS_KEYWORD_RE.test(merged);
};

const isExplicitLowValueSource = (item) => {
  const title = String(item?.title || '');
  const url = String(item?.url || '');
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  if (!host) return true;
  if (isLikelyHomepageUrl(url)) return true;
  if (LOW_VALUE_HOST_RE.test(host)) return true;
  if (LOW_VALUE_TITLE_RE.test(title)) return true;
  return false;
};

const isUsableSignal = (s) => {
  const kind = String(s?.kind || '');
  const title = String(s?.title || '');
  const url = String(s?.sourceUrl || '');
  if (!title || !url) return false;

  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  if (!host || LOW_VALUE_HOST_RE.test(host)) return false;
  if (LOW_VALUE_TITLE_RE.test(title)) return false;

  const merged = `${title} ${s?.summary || ''} ${s?.content || ''}`;
  const isUndatedRescue = Array.isArray(s?.tags) && s.tags.includes('日期待核验');
  const recencyText = `${title} ${s?.content || ''} ${url}`;
  if (isUndatedRescue && !looksRecentText(recencyText)) return false;
  if (HIGH_VALUE_HOST_RE.test(host)) return true;
  if (HIGH_VALUE_KEYWORD_RE.test(merged) || INDUSTRY_NEWS_KEYWORD_RE.test(merged)) return true;

  const score = Number(s?.score || 0);
  if (['policy', 'tender', 'standard'].includes(kind)) return score >= 70;
  return ['industry', 'company', 'event'].includes(kind) && score >= 60;
};

const normalizeSignalKind = (rawKind) => {
  const kind = String(rawKind || '').toLowerCase().trim();
  if (kind === 'policy') return 'policy';
  if (kind === 'industry') return 'industry';
  if (kind === 'company') return 'company';
  if (kind === 'tender') return 'tender';
  if (kind === 'standard') return 'standard';
  if (kind === 'event') return 'event';
  if (/招标|招采|采购/.test(kind)) return 'tender';
  if (/政策|通知|监管|条例|办法/.test(kind)) return 'policy';
  if (/标准|规范|国标|行标/.test(kind)) return 'standard';
  if (/公司|企业|集团|股份/.test(kind)) return 'company';
  return 'industry';
};

const formatYmd = (date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateToUtc = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const iso = text.match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) return dt;
    return null;
  }

  const m = text.match(/^((?:19|20)\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return dt;
  return null;
};

const extractDateFromUrl = (rawUrl) => {
  let src = String(rawUrl || '');
  try { src = decodeURIComponent(src); } catch { src = String(rawUrl || ''); }
  if (!src) return '';
  const candidates = [];

  const addDate = (y, m, d) => {
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      dt.getUTCFullYear() === Number(y) &&
      dt.getUTCMonth() === Number(m) - 1 &&
      dt.getUTCDate() === Number(d)
    ) candidates.push(dt);
  };

  // /2025/08/29/ or -2025-08-29-
  const sepRe = /((?:19|20)\d{2})[\/_.-](\d{1,2})[\/_.-](\d{1,2})/g;
  let m = null;
  while ((m = sepRe.exec(src)) !== null) addDate(m[1], m[2], m[3]);
  sepRe.lastIndex = 0;

  // 20250829
  const compactRe = /(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?:[^\d]|$)/g;
  while ((m = compactRe.exec(src)) !== null) addDate(m[1], m[2], m[3]);
  compactRe.lastIndex = 0;

  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return formatYmd(candidates[0]);
};

const extractDateNearHint = (text) => {
  const src = String(text || '');
  if (!src) return '';
  const candidates = [];
  let m = null;
  while ((m = DATE_CANDIDATE_RE.exec(src)) !== null) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
    const start = Math.max(0, m.index - 24);
    const end = Math.min(src.length, m.index + String(m[0] || '').length + 24);
    const near = src.slice(start, end);
    if (!DATE_HINT_RE.test(near)) continue;
    candidates.push(dt);
  }
  DATE_CANDIDATE_RE.lastIndex = 0;
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return formatYmd(candidates[0]);
};

const extractMostRecentDate = (text) => {
  const src = String(text || '');
  if (!src) return '';
  const candidates = [];
  let m = null;
  while ((m = DATE_CANDIDATE_RE.exec(src)) !== null) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) continue;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
    candidates.push(dt);
  }
  DATE_CANDIDATE_RE.lastIndex = 0;
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return formatYmd(candidates[0]);
};

const inferPublishedMeta = (...segments) => {
  for (const seg of segments) {
    const direct = parseDateToUtc(seg);
    if (direct) return { date: formatYmd(direct), confidence: 'high', method: 'explicit' };
  }

  for (const seg of segments) {
    const fromUrl = extractDateFromUrl(seg);
    if (fromUrl) return { date: fromUrl, confidence: 'medium', method: 'url' };
  }

  for (const seg of segments) {
    const text = String(seg || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const hintedDate = extractDateNearHint(text.slice(0, 800));
    if (hintedDate) return { date: hintedDate, confidence: 'high', method: 'hint' };
  }

  return { date: '', confidence: 'low', method: 'none' };
};

const inferPublishedAt = (...segments) => {
  const meta = inferPublishedMeta(...segments);
  return String(meta?.date || '');
};

const getRecencyDaysByKind = (kindRaw) => {
  const kind = normalizeSignalKind(kindRaw);
  if (kind === 'policy') return INTEL_RECENCY_DAYS.policy;
  if (kind === 'tender') return INTEL_RECENCY_DAYS.tender;
  if (kind === 'standard') return INTEL_RECENCY_DAYS.standard;
  if (kind === 'industry') return INTEL_RECENCY_DAYS.industry;
  if (kind === 'company') return INTEL_RECENCY_DAYS.company;
  if (kind === 'event') return INTEL_RECENCY_DAYS.event;
  return Math.max(INTEL_RECENCY_DAYS.industry, INTEL_RECENCY_DAYS.company);
};

const addUniqueTag = (tags, tag) => {
  const base = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  if (!base.includes(tag)) base.push(tag);
  return base;
};

const annotateUndatedSignal = (signal, fallbackYmd) => {
  const base = signal && typeof signal === 'object' ? signal : {};
  const summaryRaw = String(base.summary || '').trim();
  const suffix = '（发布日期待核验）';
  const summary = summaryRaw
    ? (summaryRaw.includes('发布日期待核验') ? summaryRaw : `${summaryRaw}${suffix}`)
    : `发布日期待核验，按抓取日期 ${fallbackYmd} 暂存。`;
  return {
    ...base,
    publishedAt: fallbackYmd,
    summary,
    tags: addUniqueTag(base.tags, '日期待核验')
  };
};

const appendPublishedAtTag = (tags, meta) => {
  const base = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  const confidence = String(meta?.confidence || '');
  if (confidence === 'medium') return addUniqueTag(base, '发布时间待确认');
  if (confidence === 'low') return addUniqueTag(base, '日期待核验');
  return base;
};

const isLikelyRecentUndatedSignal = (signal, todayDate) => {
  const text = `${signal?.title || ''} ${signal?.summary || ''} ${signal?.content || ''} ${signal?.sourceUrl || ''}`.slice(0, 520);
  if (!text) return false;
  if (LOW_VALUE_TITLE_RE.test(text)) return false;

  const guessedDate = extractMostRecentDate(text);
  if (guessedDate) {
    const guessed = parseDateToUtc(guessedDate);
    if (!guessed) return false;
    const ageDays = Math.floor((todayDate.getTime() - guessed.getTime()) / (24 * 3600 * 1000));
    return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= INTEL_UNDATED_MAX_AGE_DAYS;
  }

  const hintsRecent = RECENT_HINT_RE.test(text);
  const years = [];
  let m = null;
  while ((m = YEAR_CANDIDATE_RE.exec(text)) !== null) {
    const y = Number(m[0]);
    if (Number.isFinite(y)) years.push(y);
  }
  YEAR_CANDIDATE_RE.lastIndex = 0;

  const currentYear = todayDate.getUTCFullYear();
  const prevYear = currentYear - 1;
  const maxYear = years.length > 0 ? Math.max(...years) : -Infinity;
  if (years.length > 0 && maxYear < prevYear) return false;
  if (!hintsRecent) return false;
  if (years.length === 0) return true;
  return years.includes(currentYear) || years.includes(prevYear);
};

const filterSignalsByFreshness = (signals, todayYmd, options = {}) => {
  const list = Array.isArray(signals) ? signals : [];
  const today = parseDateToUtc(todayYmd) || new Date();
  const allowUndated = Boolean(options?.allowUndated);
  const fallbackDate = parseDateToUtc(options?.undatedFallbackYmd) || today;
  const fallbackYmd = formatYmd(fallbackDate);
  const fresh = [];
  let droppedStale = 0;
  let droppedUndated = 0;
  let adoptedUndated = 0;
  for (const s of list) {
    const publishedAt = String(s?.publishedAt || '').slice(0, 10);
    const published = parseDateToUtc(publishedAt);
    if (!published) {
      if (allowUndated) {
        if (!isLikelyRecentUndatedSignal(s, today)) {
          droppedUndated += 1;
          continue;
        }
        fresh.push(annotateUndatedSignal(s, fallbackYmd));
        adoptedUndated += 1;
        continue;
      }
      droppedUndated += 1;
      continue;
    }
    const ageDays = Math.floor((today.getTime() - published.getTime()) / (24 * 3600 * 1000));
    const recencyDays = getRecencyDaysByKind(s?.kind);
    if (!Number.isFinite(ageDays) || ageDays < -1 || ageDays > recencyDays) {
      droppedStale += 1;
      continue;
    }
    fresh.push({ ...s, publishedAt: formatYmd(published) });
  }
  return { fresh, droppedStale, droppedUndated, adoptedUndated };
};

const toHttpUrl = (rawUrl) => {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
};

const normalizeSignalKey = (s) => {
  const title = String(s?.title || '').trim().toLowerCase();
  const url = String(s?.sourceUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  return url ? `${url}::${title}` : title;
};

const computeAgeDays = (publishedAt) => {
  const published = parseDateToUtc(String(publishedAt || '').slice(0, 10));
  if (!published) return Number.NaN;
  const now = new Date();
  return Math.floor((now.getTime() - published.getTime()) / (24 * 3600 * 1000));
};

const recencyRankBonus = (ageDays) => {
  if (!Number.isFinite(ageDays)) return -14;
  if (ageDays <= 3) return 26;
  if (ageDays <= 7) return 20;
  if (ageDays <= 15) return 14;
  if (ageDays <= 30) return 8;
  if (ageDays <= 60) return 2;
  if (ageDays <= 90) return -6;
  return -16;
};

const signalRankScore = (s) => {
  const score = Number(s?.score || 0);
  const urgencyBonus = String(s?.urgency || '') === 'high' ? 8 : String(s?.urgency || '') === 'medium' ? 4 : 0;
  const ageDays = computeAgeDays(s?.publishedAt);
  return score + urgencyBonus + recencyRankBonus(ageDays);
};

const buildSignalHostName = (url) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '') || 'Web';
  } catch {
    return 'Web';
  }
};

const quotaBucketKind = (signalKind) => {
  const kind = normalizeSignalKind(signalKind);
  if (kind === 'standard') return 'policy';
  if (INTEL_QUOTA_KINDS.includes(kind)) return kind;
  return '';
};

const pickSignalsByQuota = ({ primarySignals, fallbackSignals, limit, quota }) => {
  const maxCount = Math.max(0, toNonNegativeInt(limit, 20));
  if (maxCount <= 0) return [];

  const sortByRank = (arr) => (Array.isArray(arr) ? arr.slice() : [])
    .filter((s) => s && typeof s === 'object')
    .sort((a, b) => signalRankScore(b) - signalRankScore(a));

  const primary = sortByRank(primarySignals);
  const secondary = sortByRank(fallbackSignals);
  const selected = [];
  const selectedKeySet = new Set();
  const bucketCount = { policy: 0, industry: 0, company: 0, tender: 0 };
  const kindSoftCap = {
    policy: Math.max(toNonNegativeInt(quota?.policy, 0), Math.ceil(maxCount * 0.3)),
    industry: Math.max(toNonNegativeInt(quota?.industry, 0), Math.ceil(maxCount * 0.5)),
    company: Math.max(toNonNegativeInt(quota?.company, 0), Math.ceil(maxCount * 0.5)),
    tender: Math.max(toNonNegativeInt(quota?.tender, 0), Math.ceil(maxCount * 0.35))
  };

  const tryAddSignal = (s, acceptedKinds = null, enforceSoftCap = false) => {
    if (!s || selected.length >= maxCount) return false;
    const title = String(s.title || '').trim();
    const sourceUrl = toHttpUrl(s.sourceUrl);
    if (!title || !sourceUrl) return false;
    const normalized = {
      ...s,
      kind: normalizeSignalKind(s.kind),
      sourceUrl,
      sourceName: String(s.sourceName || '').trim() || buildSignalHostName(sourceUrl)
    };
    const key = normalizeSignalKey(normalized);
    if (!key || selectedKeySet.has(key)) return false;
    if (Array.isArray(acceptedKinds) && acceptedKinds.length > 0) {
      if (!acceptedKinds.includes(normalized.kind)) return false;
    }
    const bucket = quotaBucketKind(normalized.kind);
    if (enforceSoftCap && bucket && bucketCount[bucket] >= Math.max(1, kindSoftCap[bucket] || maxCount)) return false;
    selected.push(normalized);
    selectedKeySet.add(key);
    if (bucket) bucketCount[bucket] += 1;
    return true;
  };

  const takeFromPool = (pool, acceptedKinds, needCount) => {
    let remaining = Math.max(0, needCount);
    if (remaining <= 0) return remaining;
    for (const s of pool) {
      if (remaining <= 0 || selected.length >= maxCount) break;
      if (tryAddSignal(s, acceptedKinds)) remaining -= 1;
    }
    return remaining;
  };

  for (const kind of INTEL_QUOTA_KINDS) {
    if (selected.length >= maxCount) break;
    const required = Math.max(0, toNonNegativeInt(quota?.[kind], 0));
    if (required <= 0) continue;
    const acceptedKinds = kind === 'policy' ? ['policy', 'standard'] : [kind];
    let missing = Math.max(0, required - bucketCount[kind]);
    if (missing > 0) missing = takeFromPool(primary, acceptedKinds, missing);
    if (missing > 0) takeFromPool(secondary, acceptedKinds, missing);
  }

  const fillAny = (pool) => {
    for (const s of pool) {
      if (selected.length >= maxCount) break;
      tryAddSignal(s, null, true);
    }
  };

  if (selected.length < maxCount) fillAny(primary);
  if (selected.length < maxCount) fillAny(secondary);
  // If soft caps still leave slots empty, relax caps to avoid under-filling.
  if (selected.length < maxCount) {
    for (const s of primary) {
      if (selected.length >= maxCount) break;
      tryAddSignal(s, null, false);
    }
  }
  if (selected.length < maxCount) {
    for (const s of secondary) {
      if (selected.length >= maxCount) break;
      tryAddSignal(s, null, false);
    }
  }
  return selected.slice(0, maxCount);
};

const buildIntelPrompt = ({ regions, industries, today, limit, sources }) => {
  const regionText = regions.length > 0 ? regions.join('、') : '温州、苍南、平阳、龙港';
  const industryText = industries.length > 0 ? industries.join('、') : '食品、包装、印刷、餐饮、医药';

  const sourceText = (sources || []).map((s, idx) => {
    return [
      `[${idx + 1}] 标题: ${s.title}`,
      `URL: ${s.url}`,
      s.snippet ? `搜索摘要: ${s.snippet}` : '',
      s.excerpt ? `正文节选: ${String(s.excerpt).slice(0, 1200)}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `
你是“企业咨询情报雷达”分析员。请基于“已抓取网页资料”输出结构化商机情报。

区域范围：${regionText}
行业范围：${industryText}
当前日期：${today}

已抓取网页资料：
${sourceText || '（无）'}

输出要求：
1) 仅输出 JSON 数组（不要 Markdown）。
2) 每个对象必须严格包含以下字段：
[
  {
    "title": "...",
    "sourceName": "...",
    "sourceUrl": "...",
    "publishedAt": "YYYY-MM-DD",
    "summary": "...",
    "content": "...",
    "kind": "policy|industry|company|tender|standard|event",
    "regions": ["..."],
    "industries": ["..."],
    "departments": ["..."],
    "deadline": "YYYY-MM-DD 或空",
    "serviceCategory": "体系认证|政府项目申报|生产许可类|产品认证|管理培训/顾问服务|其他",
    "serviceItemCode": "... 或空",
    "score": 0-100,
    "urgency": "high|medium|low",
    "tags": ["..."],
    "opportunityHypothesis": ["...","..."],
    "recommendedActions": ["...","..."]
  }
]
3) summary <= 120 字，必须写“为什么重要 + 可转化点”。
4) content 建议 200-600 字，写清楚适用对象、办理/申报线索、截止时间、可转化服务。
5) 只能基于已抓取资料，不要编造来源；找不到发布日期请填空字符串 ""，不要虚构为今天。
6) 返回最多 ${Math.max(5, Math.min(30, limit))} 条，按紧急度和转化潜力排序。
7) 覆盖面：政策/标准、行业动态、企业动态、招采机会都要覆盖，不要只给政策；企业动态与行业动态优先。
8) 必须给出可执行转化建议（推荐动作要具体到48小时内可执行）。
9) 时效规则：政策/招采/标准仅保留近90天；行业/企业/活动仅保留近90天。超出时效不要输出。
`;
};

const runIntelFetch = async ({ regions, industries, limit }) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const iso = now.toISOString();
  const quota = resolveIntelKindQuota(limit);

  const selectedRegions = (regions.length > 0 ? regions : DEFAULT_INTEL_REGIONS)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const selectedIndustries = (industries.length > 0 ? industries : DEFAULT_INTEL_INDUSTRIES)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  let droppedGeo = 0;
  let droppedGeoConflict = 0;
  const featuredIndustries = selectedRegions.flatMap((region) => REGION_FEATURED_INDUSTRIES[region] || []);
  const expandedIndustries = expandIndustries([...selectedIndustries, ...featuredIndustries]);
  const prioritizedIndustries = Array.from(new Set([
    ...selectedIndustries,
    ...featuredIndustries,
    ...expandedIndustries
  ])).slice(0, 10);
  const regionQuery = selectedRegions.join(' ');
  const currentYear = today.slice(0, 4);
  const currentMonth = String(Number(today.slice(5, 7)) || 1);
  const prevDate = new Date(now.getTime());
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevMonth = String(prevDate.getUTCMonth() + 1);
  const recencyHintHard = `${currentYear} ${currentYear}年${currentMonth}月 ${currentYear}年${prevMonth}月 今日 近日 最新 发布`;
  const recencyHintSoft = `${currentYear} 最新 近期 本周 本月 动态 发布 公示 通知`;
  const enterpriseQueryTerms = '企业 动态 扩产 投产 签约 融资 并购 上市 技改 数字化';
  const enterpriseFocusHint = compactSearchTerms(`${enterpriseQueryTerms} ${ENTERPRISE_SIGNAL_KEYWORDS}`, 10);
  const industryFocusHint = compactSearchTerms(`${INDUSTRY_SIGNAL_KEYWORDS} 特色产业 产业集群`, 10);
  const associationFocusHint = compactSearchTerms(`${ASSOCIATION_EVENT_KEYWORDS} 技术沙龙 供需对接`, 10);

  const queryPlans = [];
  const querySeen = new Set();
  const pushQueryPlan = (kindHint, q, priority = 50, maxResults = 3) => {
    const text = String(q || '').replace(/\s+/g, ' ').trim();
    if (!text || querySeen.has(text)) return;
    querySeen.add(text);
    queryPlans.push({ kindHint, q: text, priority, maxResults: Math.max(2, Math.min(6, Number(maxResults) || 3)) });
  };

  // Baseline policy/tender/standard coverage.
  pushQueryPlan('policy', `${regionQuery} site:gov.cn 政策 通知 公告 公示 ${recencyHintHard}`, 82, 4);
  pushQueryPlan('tender', `${regionQuery} 招标 招采 采购 交易中心 中标 公示 ${recencyHintHard}`, 79, 4);
  pushQueryPlan('standard', `${regionQuery} 市场监管 标准 监督抽检 认证 管理 ${recencyHintSoft}`, 76, 4);
  pushQueryPlan('policy', `${regionQuery} 工信 经信 科技 发改 专项资金 项目申报 指南 ${recencyHintSoft}`, 74, 4);

  // WeChat Official Accounts: prioritized scanning (CN-friendly) via indexed article pages.
  // Note: direct profile crawling often needs cookies/captcha, so we rely on search + article fetch.
  const parseCsvEnv = (key, fallbackCsv) => String(process.env[key] ?? fallbackCsv ?? '')
    .split(',')
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const wechatExcludeSet = new Set(uniqueList(parseCsvEnv('INTEL_WECHAT_EXCLUDE', DEFAULT_INTEL_WECHAT_EXCLUDE.join(','))));
  const wechatAccounts = uniqueList(parseCsvEnv('INTEL_WECHAT_ACCOUNTS', DEFAULT_INTEL_WECHAT_ACCOUNTS.join(',')))
    .filter((name) => !wechatExcludeSet.has(name));
  const wechatPlanMax = Math.max(0, Math.min(10, toNonNegativeInt(process.env.INTEL_WECHAT_PLAN_MAX, wechatAccounts.length)));
  if (wechatAccounts.length > 0 && wechatPlanMax > 0) {
    // Keep queries broad to avoid empty hits; relevance is handled downstream via scoring/freshness/geo rules.
    const wechatSuffix = compactSearchTerms(`${currentYear} ${currentYear}年${currentMonth}月 ${recencyHintSoft}`, 8);
    for (const name of wechatAccounts.slice(0, wechatPlanMax)) {
      pushQueryPlan('wechat', `${name} site:mp.weixin.qq.com ${wechatSuffix}`, 110, 2);
    }
  }

  // Enterprise + industry are first priority.
  prioritizedIndustries.slice(0, 6).forEach((industry, idx) => {
    const scopedRegion = selectedRegions[idx % Math.max(1, selectedRegions.length)] || regionQuery;
    pushQueryPlan('company', `${scopedRegion} ${industry} ${enterpriseFocusHint} ${recencyHintSoft}`, 98, 4);
    pushQueryPlan('industry', `${scopedRegion} ${industry} ${industryFocusHint} ${recencyHintSoft}`, 95, 4);
    if (idx < 4) {
      pushQueryPlan('industry', `${scopedRegion} ${industry} ${associationFocusHint} ${recencyHintSoft}`, 91, 3);
    }
    if (idx < 3) {
      pushQueryPlan('event', `${scopedRegion} ${industry} 展会 博览会 高峰论坛 技术论坛 供需对接 ${recencyHintSoft}`, 89, 3);
    }
  });

  // Region featured industries expansion.
  for (const region of selectedRegions.slice(0, 4)) {
    const featured = (REGION_FEATURED_INDUSTRIES[region] || []).slice(0, 5);
    if (featured.length === 0) continue;
    const featuredQuery = featured.join(' ');
    pushQueryPlan('company', `${region} ${featuredQuery} 企业 ${enterpriseFocusHint} ${recencyHintSoft}`, 95, 3);
    pushQueryPlan('industry', `${region} ${featuredQuery} 产业集群 行业协会 展会 论坛 ${recencyHintSoft}`, 91, 3);
    pushQueryPlan('company', `${region} 专精特新 小巨人 单项冠军 认定 公示 ${recencyHintSoft}`, 93, 3);
    pushQueryPlan('company', `${region} 重点企业 签约 投产 开工 扩产 中标 ${recencyHintSoft}`, 92, 3);
  }

  if (prioritizedIndustries.length > 0) {
    pushQueryPlan('industry', `${regionQuery} ${prioritizedIndustries.slice(0, 6).join(' ')} 行业协会 产业联盟 会展 论坛 ${recencyHintSoft}`, 90, 4);
    pushQueryPlan('company', `${regionQuery} ${prioritizedIndustries.slice(0, 6).join(' ')} 龙头企业 专精特新 企业动态 ${recencyHintSoft}`, 93, 4);
  }

  const queryPlanLimit = Math.max(8, Math.min(20, toNonNegativeInt(process.env.INTEL_QUERY_PLAN_LIMIT, 12)));
  const sortedPlans = queryPlans.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  const pinnedWechatPlans = sortedPlans.filter((p) => String(p?.kindHint || '') === 'wechat');
  const otherPlans = sortedPlans.filter((p) => String(p?.kindHint || '') !== 'wechat');
  const pinnedCount = Math.min(pinnedWechatPlans.length, Math.max(0, Math.min(queryPlanLimit, wechatPlanMax)));
  const activeQueryPlans = [
    ...pinnedWechatPlans.slice(0, pinnedCount),
    ...otherPlans
  ].slice(0, queryPlanLimit);
  intelDebugLog('query-plan', {
    total: queryPlans.length,
    active: activeQueryPlans.length,
    top: activeQueryPlans.slice(0, 6).map((x) => `${x.kindHint}:${x.q}`)
  });

  const wechatPlans = activeQueryPlans.filter((p) => String(p?.kindHint || '') === 'wechat');
  const nonWechatPlans = activeQueryPlans.filter((p) => String(p?.kindHint || '') !== 'wechat');

  const groupedNonWechat = await Promise.all(
    nonWechatPlans.map(async ({ kindHint, q, maxResults }) => ({
      kindHint,
      items: await buildWebContextForQuery(q, maxResults, false, kindHint)
    }))
  );
  const groupedWechat = [];
  for (const plan of wechatPlans) {
    // Light throttle to avoid triggering Baidu anti-bot during batch fetch.
    // (WeChat crawling itself is blocked by CAPTCHA; we rely on indexed search results.)
    // eslint-disable-next-line no-await-in-loop
    const items = await buildWebContextForQuery(plan.q, plan.maxResults, false, plan.kindHint);
    groupedWechat.push({ kindHint: plan.kindHint, items });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 120));
  }

  const grouped = [...groupedWechat, ...groupedNonWechat];

  // Round-robin merge to keep source diversity across policy/industry/company/tender queries.
  const merged = [];
  const seen = new Set();
  const maxPool = Math.max(16, Math.min(32, limit * 2));
  let step = 0;
  while (merged.length < maxPool && step < 8) {
    let added = false;
    for (const group of grouped) {
      const list = Array.isArray(group?.items) ? group.items : [];
      const item = list[step];
      if (!item?.url) continue;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push({ ...item, _queryKindHint: String(group?.kindHint || '') });
      added = true;
      if (merged.length >= maxPool) break;
    }
    if (!added) break;
    step += 1;
  }

  // If first round is sparse, run broader rescue queries for enterprise/industry news.
  if (merged.length < Math.max(6, Math.floor(limit * 0.5))) {
    const rescuePlans = [
      { kindHint: 'company', q: `${regionQuery} 企业 动态 签约 投产 扩产 融资 并购 技改 数字化改造 最新` },
      { kindHint: 'industry', q: `${regionQuery} 产业 行业 协会 论坛 展会 对接会 技术前沿 最新` },
      { kindHint: 'event', q: `${regionQuery} 会展 博览会 论坛 峰会 招商 推介会 本周 本月` }
    ];
    const rescueGrouped = await Promise.all(
      rescuePlans.map(async ({ kindHint, q }) => ({
        kindHint,
        items: await buildWebContextForQuery(q, 4, false, kindHint)
      }))
    );
    for (const group of rescueGrouped) {
      const list = Array.isArray(group?.items) ? group.items : [];
      for (const item of list) {
        if (!item?.url) continue;
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        merged.push({ ...item, _queryKindHint: String(group?.kindHint || '') });
        if (merged.length >= maxPool) break;
      }
      if (merged.length >= maxPool) break;
    }
  }
  intelDebugLog('search-pool', {
    grouped: grouped.reduce((acc, g) => acc + (Array.isArray(g?.items) ? g.items.length : 0), 0),
    merged: merged.length
  });
  intelDebugLog('wechat-pool', {
    mergedWechat: merged.filter((x) => isWeChatArticleUrl(x?.url)).length,
    groupedWechat: grouped
      .filter((g) => String(g?.kindHint || '') === 'wechat')
      .reduce((acc, g) => acc + (Array.isArray(g?.items) ? g.items.filter((x) => isWeChatArticleUrl(x?.url)).length : 0), 0)
  });

  const rawSources = merged;
  const preferredSources = rawSources.filter(isHighValueSource);
  const targetSourceCount = Math.max(12, Math.min(24, limit + 8));
  let sourceList = (() => {
    const selected = [];
    const seen = new Set();
    const primaryPool = preferredSources.length > 0 ? preferredSources : rawSources;
    const secondaryPool = primaryPool === rawSources ? [] : rawSources;

    const pushFromPool = (pool, matcher, needCount) => {
      if (!Array.isArray(pool) || pool.length === 0 || needCount <= 0) return 0;
      let taken = 0;
      for (const item of pool) {
        if (taken >= needCount || selected.length >= targetSourceCount) break;
        if (!item?.url) continue;
        if (seen.has(item.url)) continue;
        if (!matcher(item)) continue;
        seen.add(item.url);
        selected.push(item);
        taken += 1;
      }
      return taken;
    };

    for (const kind of INTEL_QUOTA_KINDS) {
      if (selected.length >= targetSourceCount) break;
      const seedNeed = Math.max(0, Math.min(3, quota[kind] || 0));
      if (seedNeed <= 0) continue;
      const acceptedHints = kind === 'policy' ? ['policy', 'standard'] : [kind];
      const hintMatcher = (item) => {
        if (!acceptedHints.includes(normalizeSignalKind(item?._queryKindHint))) return false;
        const mergedText = `${item?.title || ''} ${item?.snippet || ''} ${item?.excerpt || ''}`;
        const isTenderish = /招标|招采|采购|中标|交易中心|投标|竞价/.test(mergedText);
        if (kind === 'company') {
          return /企业|公司|集团|股份|有限公司|签约|投产|扩产|融资|并购|开工|投建|开业|项目落地|订单/.test(mergedText) && !isTenderish;
        }
        if (kind === 'industry') {
          return /行业|产业|市场|协会|论坛|展会|博览会|技术|景气|趋势|集群/.test(mergedText) && !isTenderish;
        }
        return true;
      };
      let missing = seedNeed;
      missing -= pushFromPool(primaryPool, hintMatcher, missing);
      if (missing > 0) pushFromPool(secondaryPool, hintMatcher, missing);
    }

    const takeAny = (pool) => {
      pushFromPool(pool, () => true, targetSourceCount - selected.length);
    };
    if (selected.length < targetSourceCount) takeAny(primaryPool);
    if (selected.length < targetSourceCount) takeAny(secondaryPool);

    return selected.slice(0, targetSourceCount);
  })();
  if (sourceList.length === 0 && rawSources.length > 0) {
    sourceList = rawSources
      .filter((item) => item?.url)
      .slice(0, targetSourceCount)
      .map((item) => ({ ...item, _queryKindHint: String(item?._queryKindHint || 'industry') }));
  }

  // Promote WeChat article sources (mp.weixin.qq.com) to increase hit rate for selected accounts.
  const wechatSourceBoost = Math.max(0, Math.min(10, toNonNegativeInt(process.env.INTEL_WECHAT_SOURCE_BOOST, 6)));
  if (wechatSourceBoost > 0) {
    const boosted = [];
    const seenBoost = new Set();
    for (const item of rawSources) {
      if (boosted.length >= wechatSourceBoost) break;
      if (!item?.url || !isWeChatArticleUrl(item.url)) continue;
      if (seenBoost.has(item.url)) continue;
      seenBoost.add(item.url);
      boosted.push(item);
    }
    if (boosted.length > 0) {
      const seenUrl = new Set();
      const next = [];
      for (const item of [...boosted, ...sourceList]) {
        if (!item?.url) continue;
        if (seenUrl.has(item.url)) continue;
        seenUrl.add(item.url);
        next.push(item);
        if (next.length >= targetSourceCount) break;
      }
      sourceList = next;
    }
  }

  const geoScopedSourceResult = applyGeoScopeToSources(sourceList, selectedRegions);
  sourceList = geoScopedSourceResult.sources;
  droppedGeo += Number(geoScopedSourceResult.droppedGeo || 0);
  droppedGeoConflict += Number(geoScopedSourceResult.droppedGeoConflict || 0);
  intelDebugLog('wechat-sourcelist', {
    selectedWechat: sourceList.filter((x) => isWeChatArticleUrl(x?.url)).length
  });

  if (sourceList.length === 0) {
    return {
      signals: [],
      modelUsed: 'web-heuristic',
      empty: true,
      droppedGeo,
      droppedGeoConflict
    };
  }
  intelDebugLog('source-list', {
    preferred: preferredSources.length,
    selected: sourceList.length,
    pool: rawSources.length
  });

  const inferKind = (text, kindHint = '') => {
    const hint = normalizeSignalKind(kindHint);
    const t = String(text || '');
    // Strong lexical cues should override query hint to avoid misclassification.
    if (/招标|招采|采购|中标|成交公告/.test(t)) return 'tender';
    if (/标准|规范|国标|行标/.test(t)) return 'standard';
    if (/政策|通知|办法|条例|监管|公示/.test(t)) return 'policy';
    if (/发布会|论坛|活动|会议|展会|博览会|对接会/.test(t)) return 'event';
    if (['policy', 'industry', 'company', 'tender', 'standard', 'event'].includes(hint)) return hint;
    if (/扩产|投产|并购|融资|上市|中标|订单|企业|公司|集团|股份|有限公司/.test(t)) return 'company';
    if (/行业|市场|产业|趋势|景气|价格|需求|供给/.test(t)) return 'industry';
    return 'industry';
  };

  const inferUrgency = (text) => {
    const t = String(text || '');
    if (/截止|即将|今日|本周|紧急|处罚|通报|开标|中标|征求意见截止/.test(t)) return 'high';
    if (/通知|政策|招标|公示|征求意见|发布|开工|落地/.test(t)) return 'medium';
    return 'low';
  };

  const inferServiceCategory = (text) => {
    const t = String(text || '');
    if (/认证|体系|iso|iatf|质量管理|食品安全|haccp|标准|国标|行标/i.test(t)) return '体系认证';
    if (/申报|补贴|专项资金|项目指南|工信|发改|经信|科技项目/.test(t)) return '政府项目申报';
    if (/许可|生产许可证|备案/.test(t)) return '生产许可类';
    if (/产品认证|ccc|ce|fda|出口准入/i.test(t)) return '产品认证';
    if (/扩产|并购|融资|上市|中标|订单|趋势|市场|咨询|顾问|辅导/.test(t)) return '管理培训/顾问服务';
    return '其他';
  };

  const buildOpportunityHints = (kind, serviceCategory, title, industriesText) => {
    const base = String(title || '');
    const hints = [];
    const actions = [];

    if (kind === 'policy' || kind === 'standard') {
      hints.push(`围绕“${base.slice(0, 24)}”可发起合规差距诊断与标准落地辅导。`);
      hints.push(`对${industriesText}客户可推出“解读培训 + 文件整改 + 内审辅导”组合包。`);
      actions.push('48小时内完成受影响客户名单筛选并分派负责人。');
      actions.push('72小时内发布一页纸解读并邀约重点客户线上沟通。');
    } else if (kind === 'tender') {
      hints.push('可转化为招投标辅导、资质补齐、体系证明材料准备服务。');
      hints.push('适合打包“项目机会识别 + 报名条件核验 + 文件支持”服务。');
      actions.push('24小时内建立机会卡，标注截止时间与投标门槛。');
      actions.push('对匹配客户发起一轮定向触达并评估参与意愿。');
    } else if (kind === 'company' || kind === 'industry') {
      hints.push(`该动态可作为${industriesText}增量市场线索，适合切入管理改进与认证升级。`);
      hints.push('可围绕扩产/订单/市场变化场景，提供专项诊断与项目化服务。');
      actions.push('在CRM新建线索并绑定行业标签，进入7天跟进行动。');
      actions.push('准备同业成功案例与报价框架，安排首次沟通。');
    } else {
      hints.push('可作为区域市场活跃度信号，辅助销售前置触达。');
      actions.push('纳入周会情报复盘，筛选可转化客户。');
    }

    if (serviceCategory === '政府项目申报') {
      hints.push('可联动“项目申报代办 + 材料辅导”形成短周期成交机会。');
    }

    return { hints: hints.slice(0, 2), actions: actions.slice(0, 2) };
  };

  const sourcePublishedMetaByUrl = new Map(
    sourceList.map((s) => [toHttpUrl(s?.url), inferPublishedMeta(s?.url, s?.title, s?.snippet, s?.excerpt)])
  );

  const fallbackFromSources = () => {
    const dedup = new Set();
    const out = [];
    const usable = sourceList;
    for (const s of usable) {
      if (!s?.url || dedup.has(s.url)) continue;
      dedup.add(s.url);
      const merged = `${s.title || ''} ${s.snippet || ''} ${s.excerpt || ''}`;
      let host = 'Web';
      try {
        host = new URL(s.url).hostname.replace(/^www\./, '');
      } catch {
        host = 'Web';
      }
      const kind = inferKind(merged, s._queryKindHint);
      const serviceCategory = inferServiceCategory(merged);
      const urgency = inferUrgency(merged);
      const publishedMeta = inferPublishedMeta(s?.url, s?.title, s?.snippet, s?.excerpt);
      const industriesText = (selectedIndustries.length > 0 ? selectedIndustries : ['重点行业']).join('、');
      const { hints, actions } = buildOpportunityHints(kind, serviceCategory, s.title, industriesText);
      const baseScore = kind === 'tender' ? 82 : kind === 'policy' ? 78 : kind === 'standard' ? 76 : kind === 'company' ? 72 : kind === 'industry' ? 68 : 62;
      const urgencyBonus = urgency === 'high' ? 8 : urgency === 'medium' ? 4 : 0;
      let signal = {
        id: `SIG-${Date.now()}-${out.length}`,
        title: String(s.title || `情报-${out.length + 1}`).slice(0, 180),
        sourceName: host,
        sourceUrl: toHttpUrl(s.url),
        publishedAt: String(publishedMeta?.date || ''),
        summary: String((s.snippet || s.excerpt || '').slice(0, 120)) || '基于联网检索自动生成的情报条目。',
        content: String((s.excerpt || s.snippet || '').slice(0, 900)),
        kind,
        regions: (Array.isArray(s?._matchedRegions) && s._matchedRegions.length > 0)
          ? uniqueList(s._matchedRegions)
          : inferMatchedRegionsFromText(merged, selectedRegions),
        industries: selectedIndustries.length > 0 ? selectedIndustries : DEFAULT_INTEL_INDUSTRIES,
        departments: [],
        tags: appendPublishedAtTag([], publishedMeta),
        deadline: '',
        serviceCategory,
        serviceItemCode: '',
        opportunityHypothesis: hints,
        recommendedActions: actions,
        score: Math.min(95, Math.max(50, baseScore + urgencyBonus - out.length * 2)),
        urgency,
        status: MARKET_SIGNAL_STATUS.NEW,
        ownerUserId: '',
        convertedTo: {},
        createdAt: iso,
        updatedAt: iso
      };
      // WeChat articles often can't be crawled for publish date; keep them visible but mark as "待核验".
      if (isWeChatArticleUrl(signal.sourceUrl) && !String(signal.publishedAt || '').trim()) {
        signal = annotateUndatedSignal(signal, today);
      }
      out.push(signal);
      if (out.length >= Math.max(limit * 2, 30)) break;
    }
    return out.filter((x) => x.sourceUrl);
  };

  const fallbackSignalsRaw = fallbackFromSources();
  const fallbackGeoScoped = applyGeoScopeToSignals(fallbackSignalsRaw, selectedRegions);
  droppedGeo += Number(fallbackGeoScoped.droppedGeo || 0);
  droppedGeoConflict += Number(fallbackGeoScoped.droppedGeoConflict || 0);

  const fallbackStrictFreshness = filterSignalsByFreshness(fallbackGeoScoped.signals, today);
  const fallbackRescueFreshness = fallbackStrictFreshness.droppedUndated > 0
    ? filterSignalsByFreshness(fallbackGeoScoped.signals, today, { allowUndated: true, undatedFallbackYmd: today })
    : { fresh: [], droppedStale: 0, droppedUndated: 0, adoptedUndated: 0 };
  const fallbackStrictSet = new Set(fallbackStrictFreshness.fresh.map(normalizeSignalKey));
  const maxUndatedSupplement = fallbackStrictFreshness.fresh.length < Math.max(4, Math.floor(limit * 0.4))
    ? Math.max(4, Math.floor(limit * 0.7))
    : Math.max(1, Math.floor(limit * 0.3));
  const needUndatedSupplement = fallbackStrictFreshness.fresh.length < Math.max(4, Math.floor(limit * 0.5));
  const fallbackUndatedPool = (needUndatedSupplement
    ? fallbackRescueFreshness.fresh.filter((s) => !fallbackStrictSet.has(normalizeSignalKey(s)))
    : []
  ).slice(0, maxUndatedSupplement);
  const fallbackUndatedSeed = new Set(fallbackUndatedPool.map(normalizeSignalKey));
  const fallbackEmergencyNeed = Math.max(0, maxUndatedSupplement - fallbackUndatedPool.length);
  const fallbackEmergencyUndated = (fallbackStrictFreshness.fresh.length < Math.max(3, Math.floor(limit * 0.3)) && fallbackEmergencyNeed > 0
    ? fallbackGeoScoped.signals
      .filter((s) => !String(s?.publishedAt || '').trim())
      .filter((s) => !fallbackUndatedSeed.has(normalizeSignalKey(s)))
      .slice(0, fallbackEmergencyNeed)
      .map((s) => annotateUndatedSignal(s, today))
    : []);
  const balancedFallbackSignals = pickSignalsByQuota({
    primarySignals: fallbackStrictFreshness.fresh,
    fallbackSignals: [...fallbackUndatedPool, ...fallbackEmergencyUndated],
    limit,
    quota
  });
  const fallbackRescuedUndated = balancedFallbackSignals.filter((s) => Array.isArray(s?.tags) && s.tags.includes('日期待核验')).length;
  const fallbackDroppedStale = Number(fallbackStrictFreshness.droppedStale || 0);
  const fallbackDroppedUndated = Math.max(0, Number(fallbackStrictFreshness.droppedUndated || 0) - fallbackRescuedUndated);
  intelDebugLog('fallback-freshness', {
    strictFresh: fallbackStrictFreshness.fresh.length,
    strictDroppedStale: fallbackStrictFreshness.droppedStale,
    strictDroppedUndated: fallbackStrictFreshness.droppedUndated,
    undatedSupplement: fallbackUndatedPool.length,
    emergencyUndated: fallbackEmergencyUndated.length,
    balanced: balancedFallbackSignals.length
  });
  const llmBypassThreshold = Math.max(6, Math.floor(limit * 0.7));
  if (balancedFallbackSignals.length >= llmBypassThreshold || (balancedFallbackSignals.length > 0 && fallbackStrictFreshness.fresh.length === 0)) {
    return {
      signals: balancedFallbackSignals,
      modelUsed: 'web-heuristic',
      empty: false,
      droppedStale: fallbackDroppedStale,
      droppedUndated: fallbackDroppedUndated,
      rescuedUndated: fallbackRescuedUndated,
      droppedGeo,
      droppedGeoConflict
    };
  }

  const prompt = buildIntelPrompt({
    regions: selectedRegions,
    industries: prioritizedIndustries,
    today,
    limit,
    sources: sourceList
  });
  const intelLlmTimeoutMs = Math.max(6000, toNonNegativeInt(process.env.INTEL_LLM_TIMEOUT_MS, 12000));

  let completion = null;
  try {
    completion = await withTimeout(
      requestAI({
        requestedModel: DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        jsonMode: false,
        temperature: 0.2
      }),
      intelLlmTimeoutMs,
      'INTEL_LLM_TIMEOUT'
    );
  } catch {
    return {
      signals: balancedFallbackSignals,
      modelUsed: 'web-fallback',
      empty: balancedFallbackSignals.length === 0,
      droppedStale: fallbackDroppedStale,
      droppedUndated: fallbackDroppedUndated,
      rescuedUndated: fallbackRescuedUndated,
      droppedGeo,
      droppedGeoConflict
    };
  }

  const list = parseIntelList(completion?.text || '');
  intelDebugLog('llm-parse', {
    model: completion?.modelUsed || '',
    list: Array.isArray(list) ? list.length : 0
  });
  const modelSignalsRaw = list.map((x, idx) => {
    const sourceUrl = toHttpUrl(x?.sourceUrl);
    const sourcePublishedMeta = sourcePublishedMetaByUrl.get(sourceUrl);
    const publishedMeta = inferPublishedMeta(
      x?.publishedAt,
      sourcePublishedMeta?.date,
      sourceUrl,
      x?.title,
      x?.summary,
      x?.content
    );
    const mergedText = `${x?.title || ''} ${x?.summary || ''} ${x?.content || ''}`;
    const kind = normalizeSignalKind(x?.kind || inferKind(mergedText));
    const urgency = ['high', 'medium', 'low'].includes(String(x?.urgency || '').toLowerCase())
      ? String(x.urgency).toLowerCase()
      : inferUrgency(mergedText);
    const score = Math.max(0, Math.min(100, Number(x?.score || 50)));

    return {
      id: `SIG-${Date.now()}-${idx}`,
      title: String(x?.title || '').slice(0, 180) || `情报-${idx + 1}`,
      sourceName: String(x?.sourceName || '').trim() || buildSignalHostName(sourceUrl),
      sourceUrl,
      publishedAt: String(publishedMeta?.date || ''),
      summary: String(x?.summary || ''),
      content: String(x?.content || x?.summary || ''),
      kind,
      regions: Array.isArray(x?.regions) ? x.regions.map(String).filter(Boolean) : selectedRegions,
      industries: Array.isArray(x?.industries) ? x.industries.map(String).filter(Boolean) : selectedIndustries,
      departments: Array.isArray(x?.departments) ? x.departments.map(String).filter(Boolean) : [],
      tags: appendPublishedAtTag(Array.isArray(x?.tags) ? x.tags.map(String).filter(Boolean) : [], publishedMeta),
      deadline: x?.deadline ? String(x.deadline).slice(0, 10) : '',
      serviceCategory: x?.serviceCategory ? String(x.serviceCategory) : '',
      serviceItemCode: x?.serviceItemCode ? String(x.serviceItemCode) : '',
      opportunityHypothesis: Array.isArray(x?.opportunityHypothesis) ? x.opportunityHypothesis.map(String).filter(Boolean) : [],
      recommendedActions: Array.isArray(x?.recommendedActions) ? x.recommendedActions.map(String).filter(Boolean) : [],
      score,
      urgency,
      status: MARKET_SIGNAL_STATUS.NEW,
      ownerUserId: '',
      convertedTo: {},
      createdAt: iso,
      updatedAt: iso
    };
  }).filter((x) => x.sourceUrl && x.title);

  const modelGeoScoped = applyGeoScopeToSignals(modelSignalsRaw, selectedRegions);
  droppedGeo += Number(modelGeoScoped.droppedGeo || 0);
  droppedGeoConflict += Number(modelGeoScoped.droppedGeoConflict || 0);

  const modelStrictFreshness = filterSignalsByFreshness(modelGeoScoped.signals, today);
  const modelRescueFreshness = modelStrictFreshness.droppedUndated > 0
    ? filterSignalsByFreshness(modelGeoScoped.signals, today, { allowUndated: true, undatedFallbackYmd: today })
    : { fresh: [], droppedStale: 0, droppedUndated: 0, adoptedUndated: 0 };
  const modelStrictSet = new Set(modelStrictFreshness.fresh.map(normalizeSignalKey));
  const strictTotalForDecision = modelStrictFreshness.fresh.length + fallbackStrictFreshness.fresh.length;
  const modelUndatedPool = (strictTotalForDecision < Math.max(5, Math.floor(limit * 0.6))
    ? modelRescueFreshness.fresh.filter((s) => !modelStrictSet.has(normalizeSignalKey(s)))
    : []
  ).slice(0, maxUndatedSupplement);

  let signals = pickSignalsByQuota({
    primarySignals: modelStrictFreshness.fresh,
    fallbackSignals: [...fallbackStrictFreshness.fresh, ...modelUndatedPool, ...fallbackUndatedPool],
    limit,
    quota
  });

  // Ensure WeChat sources (whitelisted official accounts) are not completely drowned out.
  // This is a display/prioritization guardrail, not a business rule change.
  const wechatForceMin = Math.max(0, Math.min(3, toNonNegativeInt(process.env.INTEL_WECHAT_FORCE_MIN, 1)));
  if (wechatForceMin > 0) {
    const currentWechat = signals.filter((s) => isWeChatArticleUrl(s?.sourceUrl)).length;
    const need = Math.max(0, wechatForceMin - currentWechat);
    if (need > 0) {
      const wechatPool = balancedFallbackSignals
        .filter((s) => isWeChatArticleUrl(s?.sourceUrl))
        .filter((s) => !signals.some((x) => normalizeSignalKey(x) === normalizeSignalKey(s)));
      if (wechatPool.length > 0) {
        const next = [...signals];
        let inserted = 0;
        for (const cand of wechatPool) {
          if (inserted >= need) break;
          // Replace from the end (prefer keeping higher priority items).
          let replaced = false;
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (!isWeChatArticleUrl(next[i]?.sourceUrl)) {
              next[i] = cand;
              replaced = true;
              break;
            }
          }
          if (replaced) inserted += 1;
        }
        signals = next;
      }
    }
  }
  const rescuedUndated = signals.filter((s) => Array.isArray(s?.tags) && s.tags.includes('日期待核验')).length;
  const droppedStale = modelStrictFreshness.droppedStale + fallbackStrictFreshness.droppedStale;
  const droppedUndated = Math.max(0, modelStrictFreshness.droppedUndated + fallbackStrictFreshness.droppedUndated - rescuedUndated);

  // If model did not return usable results, fall back to balanced source-driven entries.
  if (signals.length === 0) {
    return {
      signals: balancedFallbackSignals,
      modelUsed: completion.modelUsed,
      empty: balancedFallbackSignals.length === 0,
      droppedStale,
      droppedUndated,
      rescuedUndated: fallbackRescuedUndated,
      droppedGeo,
      droppedGeoConflict
    };
  }

  intelDebugLog('result', {
    modelFresh: modelStrictFreshness.fresh.length,
    modelUndatedSupplement: modelUndatedPool.length,
    final: signals.length,
    droppedStale,
    droppedUndated,
    rescuedUndated
  });
  return {
    signals,
    modelUsed: completion.modelUsed,
    empty: false,
    droppedStale,
    droppedUndated,
    rescuedUndated,
    droppedGeo,
    droppedGeoConflict
  };
};

const getLastUserQuery = (history) => {
  const messages = Array.isArray(history) ? history : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (normalizeRole(msg?.role) !== 'user') continue;
    const parts = Array.isArray(msg?.parts) ? msg.parts : [];
    const text = parts.map((p) => String(p?.text || '')).join('\n').trim();
    if (text) return text;
  }
  return '';
};

const hasWebSearchTool = (tools) => Array.isArray(tools) && tools.some((t) => t && typeof t === 'object' && Object.prototype.hasOwnProperty.call(t, 'webSearch'));

const shouldUseWebSearch = (query) => /最新|政策|法规|新闻|今天|今日|最近|动态|情报|通知|招标|招采/i.test(String(query || ''));

const toGroundingMetadata = (sources) => ({
  groundingChunks: (sources || []).map((s) => ({
    web: {
      uri: s.url,
      title: s.title
    }
  }))
});

app.get('/api/ai/health', (req, res) => {
  if (!API_KEY && !GEMINI_API_KEY) {
    return sendFail(
      res,
      ERROR_CODES.AI_KEY_MISSING,
      'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)',
      {},
      500
    );
  }

  return sendSuccess(res, {
    provider: API_KEY ? 'moonshot-kimi' : 'google-gemini',
    fallback: GEMINI_API_KEY ? 'google-gemini' : 'none',
    keyLoaded: true,
    defaultModel: DEFAULT_MODEL,
    geminiModel: GEMINI_DEFAULT_MODEL
  }, 'success');
});

app.get('/api/ai/selftest', async (req, res) => {
  try {
    if (!hasAnyAIKey()) {
      return sendFail(
        res,
        ERROR_CODES.AI_KEY_MISSING,
        'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)',
        {},
        500
      );
    }

    const requestedModel = String(req.query.model || '').trim();
    const rawMode = String(req.query.raw || '').trim() === '1';

    const result = await requestAI({
      requestedModel: requestedModel || DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      disableFallback: rawMode
    });

    return sendSuccess(res, { model: result.modelUsed, text: result.text }, 'success');
  } catch (error) {
    const e = normalizeAIError(error);
    const status = toHttpStatus(e.code, e.message);
    return sendFail(res, toInternalErrorCode(e.code, e.message), e.message, {}, status);
  }
});

app.post('/api/ai/generate', async (req, res) => {
  try {
    if (!hasAnyAIKey()) {
      return sendFail(
        res,
        ERROR_CODES.AI_KEY_MISSING,
        'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)',
        {},
        500
      );
    }

    const { model, prompt, config } = req.body;
    const messages = convertHistoryToMessages(prompt);
    const result = await requestAI({
      requestedModel: model || DEFAULT_MODEL,
      messages,
      jsonMode: String(config?.responseMimeType || '').includes('application/json')
    });

    return sendSuccess(res, { text: result.text, model: result.modelUsed }, 'success');
  } catch (error) {
    const e = normalizeAIError(error);
    console.error('AI API Error:', e.message);
    const status = toHttpStatus(e.code, e.message);
    return sendFail(res, toInternalErrorCode(e.code, e.message), e.message, {}, status);
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    if (!hasAnyAIKey()) {
      return sendFail(
        res,
        ERROR_CODES.AI_KEY_MISSING,
        'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)',
        {},
        500
      );
    }

    const { model, history, tools } = req.body;
    const messages = convertHistoryToMessages(history);

    let sources = [];
    const query = getLastUserQuery(history);
    const allowWeb = hasWebSearchTool(tools) && shouldUseWebSearch(query);

    if (allowWeb && query) {
      sources = await buildWebContextForQuery(query, 4, true);
      if (sources.length > 0) {
        const webContext = sources
          .map((s, idx) => `[#${idx + 1}] ${s.title}\nURL: ${s.url}\n摘要: ${s.snippet || ''}\n节选: ${(s.excerpt || '').slice(0, 600)}`)
          .join('\n\n');

        messages.unshift({
          role: 'system',
          content: `以下是联网检索到的网页资料，请优先基于这些来源回答，并在结尾给出引用编号：\n\n${webContext}`
        });
      }
    }

    const result = await requestAI({
      requestedModel: model || DEFAULT_MODEL,
      messages
    });

    return sendSuccess(res, {
      text: result.text,
      model: result.modelUsed,
      groundingMetadata: sources.length > 0 ? toGroundingMetadata(sources) : undefined
    }, 'success');
  } catch (error) {
    const e = normalizeAIError(error);
    console.error('Chat API Error:', e.message);
    const status = toHttpStatus(e.code, e.message);
    return sendFail(res, toInternalErrorCode(e.code, e.message), e.message, {}, status);
  }
});

app.post('/api/intel/fetch', async (req, res) => {
  try {
    const regions = normalizeList(req.body?.regions);
    const industries = normalizeList(req.body?.industries);
    const limit = Number(req.body?.limit || 20);
    const timeoutMs = Number(process.env.INTEL_FETCH_TIMEOUT_MS || 45000);
    const today = new Date().toISOString().slice(0, 10);

    if (!hasAnyAIKey()) {
      return sendFail(
        res,
        ERROR_CODES.AI_KEY_MISSING,
        'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)',
        { signals: [], source: 'no-key' },
        500
      );
    }

    const { signals, modelUsed, empty, droppedStale = 0, droppedUndated = 0, rescuedUndated = 0, droppedGeo = 0, droppedGeoConflict = 0 } = await withTimeout(
      runIntelFetch({ regions, industries, limit }),
      timeoutMs,
      `INTEL_FETCH_TIMEOUT(${timeoutMs}ms)`
    );

    if (empty) {
      const store = readIntelStore();
      const cachedSignals = Array.isArray(store?.signals) ? store.signals : [];
      const geoRegions = regions.length > 0 ? regions : DEFAULT_INTEL_REGIONS;
      const cacheGeoScoped = applyGeoScopeToSignals(cachedSignals.filter(isUsableSignal), geoRegions);
      const cacheFreshness = filterSignalsByFreshness(cacheGeoScoped.signals, today);
      const usableCached = cacheFreshness.fresh;
      if (usableCached.length > 0) {
        return sendFail(
          res,
          ERROR_CODES.INTEL_FETCH_ERROR,
          `本次联网检索未提取到可用结构化结果，已回退最近缓存（${store.lastRunAt || '未知时间'}）`,
          {
            stale: true,
            signals: usableCached,
            source: 'cache',
            droppedStale: Number(droppedStale || 0) + Number(cacheFreshness.droppedStale || 0),
            droppedUndated: Number(droppedUndated || 0) + Number(cacheFreshness.droppedUndated || 0),
            rescuedUndated: Number(rescuedUndated || 0),
            droppedGeo: Number(droppedGeo || 0) + Number(cacheGeoScoped.droppedGeo || 0),
            droppedGeoConflict: Number(droppedGeoConflict || 0) + Number(cacheGeoScoped.droppedGeoConflict || 0)
          },
          200
        );
      }

      return sendFail(
        res,
        ERROR_CODES.INTEL_FETCH_ERROR,
        '本次联网检索没有提取到可用行业情报（已执行时效过滤），请缩小范围后重试。',
        {
          stale: false,
          signals: [],
          source: 'error',
          droppedStale,
          droppedUndated,
          rescuedUndated,
          droppedGeo,
          droppedGeoConflict
        },
        200
      );
    }

    writeIntelStore({ lastRunAt: new Date().toISOString(), regions, industries, signals });
    return sendSuccess(res, {
      signals,
      model: modelUsed,
      source: 'server',
      droppedStale,
      droppedUndated,
      rescuedUndated,
      droppedGeo,
      droppedGeoConflict,
      freshnessPolicy: {
        policy: INTEL_RECENCY_DAYS.policy,
        tender: INTEL_RECENCY_DAYS.tender,
        standard: INTEL_RECENCY_DAYS.standard,
        industry: INTEL_RECENCY_DAYS.industry,
        company: INTEL_RECENCY_DAYS.company,
        event: INTEL_RECENCY_DAYS.event
      }
    }, 'success');
  } catch (error) {
    const e = normalizeAIError(error);
    const store = readIntelStore();
    const cachedSignals = Array.isArray(store?.signals) ? store.signals : [];
    const today = new Date().toISOString().slice(0, 10);
    const regions = normalizeList(req.body?.regions);
    const geoRegions = regions.length > 0 ? regions : DEFAULT_INTEL_REGIONS;
    const cacheGeoScoped = applyGeoScopeToSignals(cachedSignals.filter(isUsableSignal), geoRegions);
    const cacheFreshness = filterSignalsByFreshness(cacheGeoScoped.signals, today);
    const usableCached = cacheFreshness.fresh;
    const isTimeout = String(e.message || '').includes('INTEL_FETCH_TIMEOUT');

    if (isTimeout && usableCached.length > 0) {
      return sendFail(
        res,
        ERROR_CODES.TIMEOUT,
        `抓取超时，已回退到最近一次缓存（${store.lastRunAt || '未知时间'}）`,
        {
            stale: true,
            signals: usableCached,
            source: 'cache',
            droppedStale: Number(cacheFreshness.droppedStale || 0),
            droppedUndated: Number(cacheFreshness.droppedUndated || 0),
            droppedGeo: Number(cacheGeoScoped.droppedGeo || 0),
            droppedGeoConflict: Number(cacheGeoScoped.droppedGeoConflict || 0)
        },
        200
      );
    }

    return sendFail(
      res,
      toInternalErrorCode(e.code, e.message),
      e.message,
      {
        signals: [],
        source: 'error',
        droppedGeo: Number(cacheGeoScoped.droppedGeo || 0),
        droppedGeoConflict: Number(cacheGeoScoped.droppedGeoConflict || 0)
      },
      200
    );
  }
});

app.get('/api/intel/latest', (req, res) => {
  const store = readIntelStore();
  const configuredRegions = normalizeList(store?.regions);
  const geoRegions = configuredRegions.length > 0 ? configuredRegions : DEFAULT_INTEL_REGIONS;
  const scoped = applyGeoScopeToSignals(Array.isArray(store?.signals) ? store.signals : [], geoRegions);
  return sendSuccess(
    res,
    {
      ...store,
      signals: scoped.signals,
      droppedGeo: Number(scoped.droppedGeo || 0),
      droppedGeoConflict: Number(scoped.droppedGeoConflict || 0)
    },
    'success'
  );
});

app.post('/api/state/sync', async (req, res) => {
  try {
    const datasets = req.body?.datasets;
    if (!datasets || typeof datasets !== 'object') {
      return sendFail(res, ERROR_CODES.PARAM_ERROR, 'datasets 不能为空且必须是对象', {}, 400);
    }

    const meta = {
      source: String(req.body?.source || 'frontend'),
      actorUserId: String(req.body?.actorUserId || ''),
      clientId: String(req.body?.clientId || ''),
      appVersion: String(req.body?.appVersion || '')
    };

    const result = await upsertStateBatch(datasets, meta);
    const health = await getStateHealth();
    return sendSuccess(
      res,
      { written: result.written, mode: health.mode, latestUpdateAt: health.latestUpdateAt },
      'success'
    );
  } catch (error) {
    return sendFail(res, ERROR_CODES.STATE_SYNC_ERROR, error?.message || 'state sync failed', {}, 500);
  }
});

app.get('/api/state/sync', async (req, res) => {
  try {
    const keysRaw = String(req.query?.keys || '').trim();
    const keys = keysRaw ? keysRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const result = await getStateBatch(keys);
    const health = await getStateHealth();
    return sendSuccess(res, { mode: health.mode, datasets: result.datasets, metadata: result.metadata }, 'success');
  } catch (error) {
    return sendFail(
      res,
      ERROR_CODES.STATE_SYNC_ERROR,
      error?.message || 'state fetch failed',
      { datasets: {} },
      500
    );
  }
});

app.get('/api/state/health', async (req, res) => {
  try {
    const health = await getStateHealth();
    return sendSuccess(res, health, 'success');
  } catch (error) {
    return sendFail(res, ERROR_CODES.SERVER_ERROR, error?.message || 'state health failed', {}, 500);
  }
});

app.get('/', (req, res) => {
  return sendSuccess(
    res,
    { service: 'xinyi-backend', gateway: 'kimi', status: 'running' },
    '信义后端服务运行正常'
  );
});

const scheduleIntelJob = () => {
  const enabledRaw = String(process.env.INTEL_CRON_ENABLED ?? '').trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(enabledRaw)) return;

  // Default: run before 09:00 to ensure morning briefing is ready for workday.
  const hour = Number(process.env.INTEL_CRON_HOUR || 8);
  const minute = Number(process.env.INTEL_CRON_MINUTE || 55);
  const defaultRegions = String(process.env.INTEL_REGIONS || '温州,苍南,平阳,龙港')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultIndustries = String(process.env.INTEL_INDUSTRIES || '塑料编织制品制造业,食包,药材,印刷,食品,餐饮')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Number(process.env.INTEL_LIMIT || 20);

  console.log(`[IntelRadar] 自动抓取已启用：每日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}（服务器本地时区）`);

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        if (!hasAnyAIKey()) return;
        const { signals } = await runIntelFetch({ regions: defaultRegions, industries: defaultIndustries, limit });
        writeIntelStore({ lastRunAt: new Date().toISOString(), regions: defaultRegions, industries: defaultIndustries, signals });
        console.log(`[IntelRadar] 自动抓取完成，条数=${signals.length}`);
      } catch (e) {
        console.error('[IntelRadar] 自动抓取失败', e?.message || e);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
};

const startServer = async () => {
  let stateHealth = null;
  try {
    stateHealth = await initStateStore();
  } catch (error) {
    console.error('[StateStore] 初始化失败，将继续以降级模式启动', error?.message || error);
  }

  app.listen(port, () => {
    const stateMode = stateHealth?.mode || 'unknown';
    const stateReason = stateHealth?.reason || 'n/a';
    const providerInfo = API_KEY
      ? `Kimi (${DEFAULT_MODEL})${GEMINI_API_KEY ? ` -> Gemini (${GEMINI_DEFAULT_MODEL})` : ''}`
      : `Gemini (${GEMINI_DEFAULT_MODEL})`;
    console.log(`\n🚀 后端服务已启动！\n👉 API 地址: http://localhost:${port}\n👉 AI Provider: ${providerInfo}\n👉 StateStore: ${stateMode} (${stateReason})\n👉 请新开一个终端运行前端页面。`);
    scheduleIntelJob();
  });
};

if (process.env.VERCEL) {
  // Vercel Serverless Environment
  // Do not listen to port, just export the app
  initStateStore().catch(console.error);
  module.exports = app;
} else {
  // Local Environment
  startServer();
}
