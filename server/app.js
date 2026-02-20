const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { initStateStore, upsertStateBatch, getStateBatch, getStateHealth } = require('./stateStore');

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

const USER_AGENT = 'XinyiIntelBot/5.0 (+https://xinyi.local)';
const INTEL_QUOTA_KINDS = ['policy', 'industry', 'company', 'tender'];
const DEFAULT_INTEL_KIND_QUOTA = Object.freeze({
  policy: 2,
  industry: 3,
  company: 3,
  tender: 2
});

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

    try {
      const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(body)
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
      lastError = error;
      if (disableFallback || !isRetryableError(error)) break;
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

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
      lastError = error;
      if (!isRetryableError(error)) break;
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
    
    if (GEMINI_API_KEY && (isQuotaError || isKeyMissing)) {
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
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const results = [];
  const seen = new Set();
  let m = null;

  while ((m = linkRe.exec(text)) !== null && results.length < limit * 2) {
    const rawTitle = String(m[1] || '').trim();
    const rawUrl = String(m[2] || '').trim();
    if (!rawTitle || !rawUrl) continue;
    if (rawTitle.includes('Image') || rawTitle.startsWith('![') || rawTitle.includes('DuckDuckGo')) continue;
    const decodedUrl = decodeDuckRedirect(rawUrl);
    if (!decodedUrl || seen.has(decodedUrl)) continue;
    seen.add(decodedUrl);
    results.push({
      title: stripHtml(rawTitle).replace(/\s+/g, ' ').trim(),
      url: decodedUrl,
      snippet: ''
    });
  }

  return results.slice(0, limit);
};

const isNoiseUrl = (url) => {
  const u = String(url || '').toLowerCase();
  return /facebook\.com|douyin\.com|tiktok\.com|xiaohongshu\.com|weibo\.com|youtube\.com|bilibili\.com|instagram\.com/.test(u);
};

const searchWeb = async (query, limit = 8) => {
  const q = String(query || '').trim();
  if (!q) return [];

  // Prefer html.duckduckgo.com: duckduckgo.com/html often returns anti-bot 202 page.
  const urls = [
    `https://html.duckduckgo.com/html/?kl=cn-zh&q=${encodeURIComponent(q)}`,
    `https://duckduckgo.com/html/?kl=cn-zh&q=${encodeURIComponent(q)}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9'
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseDuckResults(html, limit);
      const cleaned = parsed.filter((x) => !isNoiseUrl(x.url));
      if (cleaned.length > 0) return cleaned;
    } catch {
      // try next endpoint
    }
  }

  // Fallback: fetch DDG result page through r.jina.ai to bypass anti-bot response pages.
  try {
    const sourceUrl = `http://duckduckgo.com/html/?kl=cn-zh&q=${encodeURIComponent(q)}`;
    const jinaUrl = `https://r.jina.ai/${sourceUrl}`;
    const res = await fetch(jinaUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    if (res.ok) {
      const md = await res.text();
      const parsed = parseDuckResultsFromMarkdown(md, limit);
      const cleaned = parsed.filter((x) => !isNoiseUrl(x.url));
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    // ignore fallback error
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

const buildWebContextForQuery = async (query, maxResults = 5, deepCrawl = false) => {
  const results = await searchWeb(query, maxResults);
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
  let remaining = maxTotal;
  for (const kind of INTEL_QUOTA_KINDS) {
    if (remaining <= 0) break;
    const take = Math.min(raw[kind] || 0, remaining);
    quota[kind] = take;
    remaining -= take;
  }
  return quota;
};

const expandIndustries = (industries) => {
  const aliases = {
    '塑编': ['塑料编织', '塑料编织制品', '塑料编织制品制造业', '编织袋', '集装袋'],
    '塑料编织制品制造业': ['塑料编织', '塑料编织制品', '塑料编织制品制造业', '编织袋', '集装袋'],
    '食包': ['食品包装', '食品包装材料', '包装材料'],
    '药材': ['中药材', '药品', '医药', '医疗器械'],
    '印刷': ['印刷业', '包装印刷', '彩印'],
    '食品': ['食品生产', '食品加工', '食品制造'],
    '餐饮': ['餐饮业', '餐饮服务']
  };
  return industries.flatMap((x) => [x, ...(aliases[x] || [])]);
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

const LOW_VALUE_HOST_RE = /(?:^|\.)(11467\.com|1688\.com|aiqicha\.baidu\.com|qcc\.com|tianyancha\.com|huangye88\.com|b2b\.baidu\.com|facebook\.com|douyin\.com|tiktok\.com|xiaohongshu\.com|weibo\.com|youtube\.com|bilibili\.com|jobui\.com|docin\.com|renrendoc\.com|wenku\.baidu\.com|made-in-china\.com)$/i;
const HIGH_VALUE_HOST_RE = /(?:^|\.)(gov\.cn|wenzhou\.gov\.cn|zj\.gov\.cn|zjlg\.gov\.cn|zjpy\.gov\.cn|ccgp\.gov\.cn|cebpubservice\.com|cninfo\.com\.cn|eastmoney\.com|stcn\.com|sina\.com\.cn|foodmate\.net)$/i;
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

const isHighValueSource = (item) => {
  const title = String(item?.title || '');
  const url = String(item?.url || '');
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }

  if (!host) return false;
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
  const src = decodeURIComponent(String(rawUrl || ''));
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

  const hintsRecent = RECENT_HINT_RE.test(text);
  const years = [];
  let m = null;
  while ((m = YEAR_CANDIDATE_RE.exec(text)) !== null) {
    const y = Number(m[0]);
    if (Number.isFinite(y)) years.push(y);
  }
  YEAR_CANDIDATE_RE.lastIndex = 0;

  const currentYear = todayDate.getUTCFullYear();
  const maxYear = years.length > 0 ? Math.max(...years) : -Infinity;
  const hasCurrentYear = years.includes(currentYear);

  if (years.length > 0 && maxYear < currentYear - 1) return false;
  if (hintsRecent) return true;
  // Undated rescue is only for very recent candidates.
  return hasCurrentYear;
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

const signalRankScore = (s) => {
  const score = Number(s?.score || 0);
  const urgencyBonus = String(s?.urgency || '') === 'high' ? 8 : String(s?.urgency || '') === 'medium' ? 4 : 0;
  return score + urgencyBonus;
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

  const tryAddSignal = (s, acceptedKinds = null) => {
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
    selected.push(normalized);
    selectedKeySet.add(key);
    const bucket = quotaBucketKind(normalized.kind);
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
      tryAddSignal(s, null);
    }
  };

  if (selected.length < maxCount) fillAny(primary);
  if (selected.length < maxCount) fillAny(secondary);
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
7) 覆盖面：政策/标准、行业动态、企业动态、招采机会都要覆盖，不要只给政策。
8) 必须给出可执行转化建议（推荐动作要具体到48小时内可执行）。
9) 时效规则：政策/招采/标准仅保留近90天；行业/企业/活动仅保留近30天。超出时效不要输出。
`;
};

const runIntelFetch = async ({ regions, industries, limit }) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const iso = now.toISOString();
  const quota = resolveIntelKindQuota(limit);

  const expandedIndustries = expandIndustries(industries);
  const regionQuery = (regions.length > 0 ? regions : ['温州', '苍南', '平阳', '龙港']).join(' ');
  const industryQuery = (expandedIndustries.length > 0 ? expandedIndustries : ['食品', '包装', '印刷', '餐饮', '医药']).join(' ');
  const currentYear = today.slice(0, 4);
  const currentMonth = String(Number(today.slice(5, 7)) || 1);
  const recencyHint = `${currentYear} ${currentYear}年${currentMonth}月 今日 近日 最新`;

  const queryPlans = [
    { kindHint: 'policy', q: `${regionQuery} ${industryQuery} site:gov.cn 政策 通知 公告 公示 ${recencyHint}` },
    { kindHint: 'tender', q: `${regionQuery} ${industryQuery} 招标 招采 采购 交易中心 ${recencyHint}` },
    { kindHint: 'standard', q: `${regionQuery} ${industryQuery} 标准 监管 市场监督 管理局 ${recencyHint}` },
    { kindHint: 'policy', q: `${regionQuery} ${industryQuery} 专项资金 项目申报 指南 ${recencyHint}` },
    { kindHint: 'industry', q: `${regionQuery} ${industryQuery} 行业 动态 新闻 趋势 市场 ${recencyHint}` },
    { kindHint: 'company', q: `${regionQuery} ${industryQuery} 企业 扩产 投资 融资 上市 并购 中标 订单 ${recencyHint}` }
  ];

  const grouped = await Promise.all(
    queryPlans.map(async ({ kindHint, q }) => ({
      kindHint,
      items: await buildWebContextForQuery(q, 3)
    }))
  );

  // Round-robin merge to keep source diversity across policy/industry/company/tender queries.
  const merged = [];
  const seen = new Set();
  const maxPool = Math.max(16, Math.min(28, limit * 2));
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

  const rawSources = merged;
  const preferredSources = rawSources.filter(isHighValueSource);
  const targetSourceCount = Math.max(8, Math.min(16, limit + 4));
  const sourceList = (() => {
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
        if (isExplicitLowValueSource(item)) continue;
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
      const hintMatcher = (item) => acceptedHints.includes(normalizeSignalKind(item?._queryKindHint));
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
  if (sourceList.length === 0) {
    return { signals: [], modelUsed: DEFAULT_MODEL, empty: true };
  }

  const inferKind = (text, kindHint = '') => {
    const hint = normalizeSignalKind(kindHint);
    if (['policy', 'industry', 'company', 'tender', 'standard'].includes(hint)) return hint;
    const t = String(text || '');
    if (/招标|招采|采购/.test(t)) return 'tender';
    if (/标准|规范|国标|行标/.test(t)) return 'standard';
    if (/政策|通知|办法|条例|监管|公示/.test(t)) return 'policy';
    if (/扩产|投产|并购|融资|上市|中标|订单|企业|公司|集团|股份|有限公司/.test(t)) return 'company';
    if (/行业|市场|产业|趋势|景气|价格|需求|供给/.test(t)) return 'industry';
    if (/发布会|论坛|活动|会议/.test(t)) return 'event';
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
      if (isExplicitLowValueSource(s)) continue;
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
      const industriesText = (industries.length > 0 ? industries : ['重点行业']).join('、');
      const { hints, actions } = buildOpportunityHints(kind, serviceCategory, s.title, industriesText);
      const baseScore = kind === 'tender' ? 82 : kind === 'policy' ? 78 : kind === 'standard' ? 76 : kind === 'company' ? 72 : kind === 'industry' ? 68 : 62;
      const urgencyBonus = urgency === 'high' ? 8 : urgency === 'medium' ? 4 : 0;
      out.push({
        id: `SIG-${Date.now()}-${out.length}`,
        title: String(s.title || `情报-${out.length + 1}`).slice(0, 180),
        sourceName: host,
        sourceUrl: toHttpUrl(s.url),
        publishedAt: String(publishedMeta?.date || ''),
        summary: String((s.snippet || s.excerpt || '').slice(0, 120)) || '基于联网检索自动生成的情报条目。',
        content: String((s.excerpt || s.snippet || '').slice(0, 900)),
        kind,
        regions: regions.length > 0 ? regions : ['温州', '苍南', '平阳', '龙港'],
        industries: industries.length > 0 ? industries : ['食品', '包装', '印刷', '餐饮', '医药'],
        departments: [],
        tags: appendPublishedAtTag([], publishedMeta),
        deadline: '',
        serviceCategory,
        serviceItemCode: '',
        opportunityHypothesis: hints,
        recommendedActions: actions,
        score: Math.min(95, Math.max(50, baseScore + urgencyBonus - out.length * 2)),
        urgency,
        status: 'new',
        ownerUserId: '',
        convertedTo: {},
        createdAt: iso,
        updatedAt: iso
      });
      if (out.length >= Math.max(limit * 2, 30)) break;
    }
    return out.filter((x) => x.sourceUrl);
  };

  const fallbackSignalsRaw = fallbackFromSources();
  const fallbackStrictFreshness = filterSignalsByFreshness(fallbackSignalsRaw, today);
  const fallbackRescueFreshness = fallbackStrictFreshness.droppedUndated > 0
    ? filterSignalsByFreshness(fallbackSignalsRaw, today, { allowUndated: true, undatedFallbackYmd: today })
    : { fresh: [], droppedStale: 0, droppedUndated: 0, adoptedUndated: 0 };
  const fallbackStrictSet = new Set(fallbackStrictFreshness.fresh.map(normalizeSignalKey));
  const maxUndatedSupplement = Math.max(2, Math.floor(limit * 0.3));
  const needUndatedSupplement = fallbackStrictFreshness.fresh.length < Math.max(4, Math.floor(limit * 0.4));
  const fallbackUndatedPool = (needUndatedSupplement
    ? fallbackRescueFreshness.fresh.filter((s) => !fallbackStrictSet.has(normalizeSignalKey(s)))
    : []
  ).slice(0, maxUndatedSupplement);
  const balancedFallbackSignals = pickSignalsByQuota({
    primarySignals: fallbackStrictFreshness.fresh,
    fallbackSignals: fallbackUndatedPool,
    limit,
    quota
  });
  const fallbackRescuedUndated = balancedFallbackSignals.filter((s) => Array.isArray(s?.tags) && s.tags.includes('日期待核验')).length;

  const prompt = buildIntelPrompt({
    regions,
    industries: expandedIndustries,
    today,
    limit,
    sources: sourceList
  });

  let completion = null;
  try {
    completion = await withTimeout(
      requestAI({
        requestedModel: DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        jsonMode: false,
        temperature: 0.2
      }),
      15000,
      'INTEL_LLM_TIMEOUT'
    );
  } catch {
    return {
      signals: balancedFallbackSignals,
      modelUsed: 'web-fallback',
      empty: balancedFallbackSignals.length === 0,
      droppedStale: fallbackStrictFreshness.droppedStale,
      droppedUndated: Math.max(0, fallbackStrictFreshness.droppedUndated - fallbackRescuedUndated),
      rescuedUndated: fallbackRescuedUndated
    };
  }

  const list = parseIntelList(completion?.text || '');
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
      regions: Array.isArray(x?.regions) ? x.regions.map(String).filter(Boolean) : regions,
      industries: Array.isArray(x?.industries) ? x.industries.map(String).filter(Boolean) : industries,
      departments: Array.isArray(x?.departments) ? x.departments.map(String).filter(Boolean) : [],
      tags: appendPublishedAtTag(Array.isArray(x?.tags) ? x.tags.map(String).filter(Boolean) : [], publishedMeta),
      deadline: x?.deadline ? String(x.deadline).slice(0, 10) : '',
      serviceCategory: x?.serviceCategory ? String(x.serviceCategory) : '',
      serviceItemCode: x?.serviceItemCode ? String(x.serviceItemCode) : '',
      opportunityHypothesis: Array.isArray(x?.opportunityHypothesis) ? x.opportunityHypothesis.map(String).filter(Boolean) : [],
      recommendedActions: Array.isArray(x?.recommendedActions) ? x.recommendedActions.map(String).filter(Boolean) : [],
      score,
      urgency,
      status: 'new',
      ownerUserId: '',
      convertedTo: {},
      createdAt: iso,
      updatedAt: iso
    };
  }).filter((x) => x.sourceUrl && x.title);

  const modelStrictFreshness = filterSignalsByFreshness(modelSignalsRaw, today);
  const modelRescueFreshness = modelStrictFreshness.droppedUndated > 0
    ? filterSignalsByFreshness(modelSignalsRaw, today, { allowUndated: true, undatedFallbackYmd: today })
    : { fresh: [], droppedStale: 0, droppedUndated: 0, adoptedUndated: 0 };
  const modelStrictSet = new Set(modelStrictFreshness.fresh.map(normalizeSignalKey));
  const strictTotalForDecision = modelStrictFreshness.fresh.length + fallbackStrictFreshness.fresh.length;
  const modelUndatedPool = (strictTotalForDecision < Math.max(4, Math.floor(limit * 0.5))
    ? modelRescueFreshness.fresh.filter((s) => !modelStrictSet.has(normalizeSignalKey(s)))
    : []
  ).slice(0, maxUndatedSupplement);

  const signals = pickSignalsByQuota({
    primarySignals: modelStrictFreshness.fresh,
    fallbackSignals: [...fallbackStrictFreshness.fresh, ...modelUndatedPool, ...fallbackUndatedPool],
    limit,
    quota
  });
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
      rescuedUndated: fallbackRescuedUndated
    };
  }

  return { signals, modelUsed: completion.modelUsed, empty: false, droppedStale, droppedUndated, rescuedUndated };
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
    return res.status(500).json({ ok: false, error: 'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)' });
  }

  res.json({
    ok: true,
    provider: API_KEY ? 'moonshot-kimi' : 'google-gemini',
    fallback: GEMINI_API_KEY ? 'google-gemini' : 'none',
    keyLoaded: true,
    defaultModel: DEFAULT_MODEL,
    geminiModel: GEMINI_DEFAULT_MODEL
  });
});

app.get('/api/ai/selftest', async (req, res) => {
  try {
    if (!hasAnyAIKey()) return res.status(500).json({ ok: false, error: 'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)' });

    const requestedModel = String(req.query.model || '').trim();
    const rawMode = String(req.query.raw || '').trim() === '1';

    const result = await requestAI({
      requestedModel: requestedModel || DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      disableFallback: rawMode
    });

    res.json({ ok: true, model: result.modelUsed, text: result.text });
  } catch (error) {
    const e = normalizeAIError(error);
    res.status(toHttpStatus(e.code, e.message)).json({ ok: false, error: e.message, code: e.code });
  }
});

app.post('/api/ai/generate', async (req, res) => {
  try {
    if (!hasAnyAIKey()) return res.status(500).json({ error: 'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)' });

    const { model, prompt, config } = req.body;
    const messages = convertHistoryToMessages(prompt);
    const result = await requestAI({
      requestedModel: model || DEFAULT_MODEL,
      messages,
      jsonMode: String(config?.responseMimeType || '').includes('application/json')
    });

    res.json({ text: result.text, model: result.modelUsed });
  } catch (error) {
    const e = normalizeAIError(error);
    console.error('AI API Error:', e.message);
    res.status(toHttpStatus(e.code, e.message)).json({ error: e.message, code: e.code });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    if (!hasAnyAIKey()) return res.status(500).json({ error: 'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)' });

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

    res.json({
      text: result.text,
      model: result.modelUsed,
      groundingMetadata: sources.length > 0 ? toGroundingMetadata(sources) : undefined
    });
  } catch (error) {
    const e = normalizeAIError(error);
    console.error('Chat API Error:', e.message);
    res.status(toHttpStatus(e.code, e.message)).json({ error: e.message, code: e.code });
  }
});

app.post('/api/intel/fetch', async (req, res) => {
  try {
    const regions = normalizeList(req.body?.regions);
    const industries = normalizeList(req.body?.industries);
    const limit = Number(req.body?.limit || 20);
    const timeoutMs = Number(process.env.INTEL_FETCH_TIMEOUT_MS || 30000);
    const today = new Date().toISOString().slice(0, 10);

    if (!hasAnyAIKey()) {
      return res.status(500).json({ ok: false, signals: [], source: 'no-key', error: 'AI Key 未配置 (KIMI_API_KEY or GEMINI_API_KEY)' });
    }

    const { signals, modelUsed, empty, droppedStale = 0, droppedUndated = 0, rescuedUndated = 0 } = await withTimeout(
      runIntelFetch({ regions, industries, limit }),
      timeoutMs,
      `INTEL_FETCH_TIMEOUT(${timeoutMs}ms)`
    );

    if (empty) {
      const store = readIntelStore();
      const cachedSignals = Array.isArray(store?.signals) ? store.signals : [];
      const cacheFreshness = filterSignalsByFreshness(cachedSignals.filter(isUsableSignal), today);
      const usableCached = cacheFreshness.fresh;
      if (usableCached.length > 0) {
        return res.status(200).json({
          ok: false,
          stale: true,
          signals: usableCached,
          source: 'cache',
          error: `本次联网检索未提取到可用结构化结果，已回退最近缓存（${store.lastRunAt || '未知时间'}）`,
          droppedStale: Number(droppedStale || 0) + Number(cacheFreshness.droppedStale || 0),
          droppedUndated: Number(droppedUndated || 0) + Number(cacheFreshness.droppedUndated || 0),
          rescuedUndated: Number(rescuedUndated || 0)
        });
      }

      return res.status(200).json({
        ok: false,
        stale: false,
        signals: [],
        source: 'error',
        error: '本次联网检索没有提取到可用行业情报（已执行时效过滤），请缩小范围后重试。',
        droppedStale,
        droppedUndated,
        rescuedUndated
      });
    }

    writeIntelStore({ lastRunAt: new Date().toISOString(), regions, industries, signals });
    res.json({
      ok: true,
      signals,
      model: modelUsed,
      source: 'server',
      droppedStale,
      droppedUndated,
      rescuedUndated,
      freshnessPolicy: {
        policy: INTEL_RECENCY_DAYS.policy,
        tender: INTEL_RECENCY_DAYS.tender,
        standard: INTEL_RECENCY_DAYS.standard,
        industry: INTEL_RECENCY_DAYS.industry,
        company: INTEL_RECENCY_DAYS.company,
        event: INTEL_RECENCY_DAYS.event
      }
    });
  } catch (error) {
    const e = normalizeAIError(error);
    const store = readIntelStore();
    const cachedSignals = Array.isArray(store?.signals) ? store.signals : [];
    const today = new Date().toISOString().slice(0, 10);
    const cacheFreshness = filterSignalsByFreshness(cachedSignals.filter(isUsableSignal), today);
    const usableCached = cacheFreshness.fresh;
    const isTimeout = String(e.message || '').includes('INTEL_FETCH_TIMEOUT');

    if (isTimeout && usableCached.length > 0) {
      return res.status(200).json({
        ok: false,
        stale: true,
        signals: usableCached,
        source: 'cache',
        error: `抓取超时，已回退到最近一次缓存（${store.lastRunAt || '未知时间'}）`,
        droppedStale: Number(cacheFreshness.droppedStale || 0),
        droppedUndated: Number(cacheFreshness.droppedUndated || 0)
      });
    }

    res.status(200).json({ ok: false, signals: [], error: e.message, code: e.code, source: 'error' });
  }
});

app.get('/api/intel/latest', (req, res) => {
  const store = readIntelStore();
  res.json({ ok: true, ...store });
});

app.post('/api/state/sync', async (req, res) => {
  try {
    const datasets = req.body?.datasets;
    if (!datasets || typeof datasets !== 'object') {
      return res.status(400).json({ ok: false, error: 'datasets 不能为空且必须是对象' });
    }

    const meta = {
      source: String(req.body?.source || 'frontend'),
      actorUserId: String(req.body?.actorUserId || ''),
      clientId: String(req.body?.clientId || ''),
      appVersion: String(req.body?.appVersion || '')
    };

    const result = await upsertStateBatch(datasets, meta);
    const health = await getStateHealth();
    res.json({ ok: true, written: result.written, mode: health.mode, latestUpdateAt: health.latestUpdateAt });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'state sync failed' });
  }
});

app.get('/api/state/sync', async (req, res) => {
  try {
    const keysRaw = String(req.query?.keys || '').trim();
    const keys = keysRaw ? keysRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const result = await getStateBatch(keys);
    const health = await getStateHealth();
    res.json({ ok: true, mode: health.mode, datasets: result.datasets, metadata: result.metadata });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'state fetch failed', datasets: {} });
  }
});

app.get('/api/state/health', async (req, res) => {
  try {
    const health = await getStateHealth();
    res.json({ ok: true, ...health });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'state health failed' });
  }
});

app.get('/', (req, res) => {
  res.send('✅ 信义后端服务 (Kimi 网关) 运行正常！请保持此窗口开启。');
});

const scheduleIntelJob = () => {
  const enabledRaw = String(process.env.INTEL_CRON_ENABLED ?? '').trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(enabledRaw)) return;

  const hour = Number(process.env.INTEL_CRON_HOUR || 9);
  const minute = Number(process.env.INTEL_CRON_MINUTE || 0);
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
