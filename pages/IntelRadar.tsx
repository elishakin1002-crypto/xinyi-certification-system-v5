import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { INTEL_INDUSTRIES, INTEL_REGIONS } from '../constants';
import { MarketSignal } from '../types';
import { intelService } from '../services/intelService';
import { intelConfigService, type IntelConfig } from '../services/intelConfigService';
import { Calendar, CheckCircle2, FileText, Filter, Flame, Loader2, PlusCircle, Radar, RefreshCw, Search, Settings2, Sparkles, Target, XCircle } from 'lucide-react';
import { dataService } from '../services/dataService';
import { MARKET_SIGNAL_STATUS } from '../src/constants/status.ts';
import { useLocation } from 'react-router-dom';

const badgeClass = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
    active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
  }`;

const kindLabel: Record<MarketSignal['kind'], string> = {
  policy: '政策',
  industry: '行业',
  company: '企业',
  tender: '招采',
  standard: '标准',
  event: '活动'
};

const urgencyPill = (u: MarketSignal['urgency']) => {
  if (u === 'high') return 'bg-red-50 text-red-700 border-red-100';
  if (u === 'medium') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-gray-50 text-gray-600 border-gray-200';
};

const industryLabel = (value: string) => (value === '塑料编织制品制造业' ? '塑编' : value);
const LOW_VALUE_HOST_RE = /(?:^|\.)(11467\.com|1688\.com|aiqicha\.baidu\.com|qcc\.com|tianyancha\.com|huangye88\.com|b2b\.baidu\.com|facebook\.com|douyin\.com|tiktok\.com|xiaohongshu\.com|weibo\.com|youtube\.com|bilibili\.com|jobui\.com|docin\.com|renrendoc\.com|wenku\.baidu\.com|made-in-china\.com)$/i;
const LOW_VALUE_TITLE_RE = /顺企网|爱企查|黄页|企业信息查询|公司详情|厂家|工厂|阿里巴巴|排行榜|公司排名|企业排名|下载|文档|资料库|模板|百科|供应商|制造商|名录/;
const HIGH_VALUE_KEYWORD_RE = /政策|通知|公告|公示|监管|办法|条例|标准|国标|行标|招标|招采|采购|项目申报|专项资金|行业|市场|产业|动态|新闻|趋势|扩产|投产|并购|融资|上市|中标|订单/;
const RECENT_HINT_RE = /最新|近日|近期|今日|昨天|本周|本月|刚刚|发布|公示|公告|通知|招标|招采|采购|截止|开标|投标|中标|签约|开工|落地|投产|扩产|融资|并购/;
const YEAR_CANDIDATE_RE = /(?:19|20)\d{2}/g;
const HOMEPAGE_PATH_RE = /^\/(?:(?:index|home|main|default)(?:\.[a-z0-9]+)?)?$/i;
const LIST_PAGE_PATH_RE = /^\/(?:index|channel|col|list|node|zwgk|xxgk|xwzx)(?:\/|$)/i;
const UI_REGION_ALIAS_MAP: Record<string, string[]> = {
  温州: ['温州', '温州市', 'wenzhou', 'wz.gov.cn', '66wz.com'],
  苍南: ['苍南', '苍南县', 'cangnan'],
  平阳: ['平阳', '平阳县', 'pingyang', 'zjpy.gov.cn'],
  龙港: ['龙港', '龙港市', 'longgang', 'zjlg.gov.cn']
};
const LATIN_TOKEN_RE = /^[a-z0-9_.-]+$/i;

type SortMode = 'fetched_desc' | 'score_desc' | 'published_desc';
const UI_RECENT_DAYS = 90;
const UI_TIME_ZONE = 'Asia/Shanghai';
const toTime = (raw?: string) => {
  const ts = new Date(String(raw || '')).getTime();
  return Number.isFinite(ts) ? ts : 0;
};
const toLocalYmd = (date: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: UI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
const toLocalYmdHm = (iso: string) => {
  const ts = new Date(String(iso || '')).getTime();
  if (!Number.isFinite(ts)) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: UI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .format(new Date(ts))
    .replace(' ', ' ');
};
const isWithinDays = (dateText: string, days: number) => {
  const ts = toTime(dateText);
  if (!ts) return false;
  const now = Date.now();
  const diff = Math.floor((now - ts) / (24 * 3600 * 1000));
  return diff >= 0 && diff <= days;
};

const isUsableSignal = (s: MarketSignal) => {
  const title = String(s?.title || '');
  const url = String(s?.sourceUrl || '');
  const kind = String(s?.kind || '');
  if (!title || !url) return false;
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  if (!host || LOW_VALUE_HOST_RE.test(host)) return false;
  if (LOW_VALUE_TITLE_RE.test(title)) return false;
  const merged = `${title} ${s?.summary || ''} ${s?.content || ''}`;
  const geoText = `${title} ${s?.summary || ''} ${s?.content || ''} ${s?.sourceName || ''} ${url}`;
  const matchedRegions = Array.from(INTEL_REGIONS).filter((region) => {
    const aliases = [region, ...(UI_REGION_ALIAS_MAP[region] || [])];
    return aliases.some((alias) => {
      if (LATIN_TOKEN_RE.test(alias)) {
        return new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(geoText.toLowerCase());
      }
      return geoText.includes(alias);
    });
  });
  if (matchedRegions.length === 0) return false;

  const undatedRescue = Array.isArray(s?.tags) && s.tags.includes('日期待核验');
  if (undatedRescue) {
    const recencyText = `${title} ${s?.content || ''} ${url}`;
    if (RECENT_HINT_RE.test(recencyText)) return true;
    const years = (recencyText.match(YEAR_CANDIDATE_RE) || []).map(Number).filter(Number.isFinite);
    const currentYear = new Date().getFullYear();
    if (!years.includes(currentYear)) return false;
  }
  if (['policy', 'tender', 'standard'].includes(kind)) return true;
  if (HIGH_VALUE_KEYWORD_RE.test(merged)) return true;
  const score = Number(s?.score || 0);
  return ['industry', 'company', 'event'].includes(kind) && score >= 60;
};

const getPublishedTimeStatus = (s: MarketSignal): 'ok' | 'confirm' | 'verify' => {
  const tags = Array.isArray(s?.tags) ? s.tags : [];
  if (tags.includes('日期待核验')) return 'verify';
  if (tags.includes('发布时间待确认')) return 'confirm';
  return 'ok';
};

const renderPublishedTime = (s: MarketSignal) => {
  const status = getPublishedTimeStatus(s);
  const date = String(s?.publishedAt || '').slice(0, 10) || '-';
  if (status === 'verify') return `原文时间待核验（当前显示 ${date}）`;
  if (status === 'confirm') return `原文发布时间 ${date}（待确认）`;
  return `原文发布时间 ${date}`;
};

const isLikelyHomepageUrl = (rawUrl?: string) => {
  try {
    const u = new URL(String(rawUrl || '').trim());
    const path = String(u.pathname || '/').toLowerCase();
    if (HOMEPAGE_PATH_RE.test(path)) return true;
    if (LIST_PAGE_PATH_RE.test(path) && !u.search) return true;
    if (path.endsWith('/index.html') || path.endsWith('/index.htm')) return true;
    return false;
  } catch {
    return true;
  }
};

const buildOriginalOpenUrl = (signal: MarketSignal) => {
  const raw = String(signal?.sourceUrl || '').trim();
  if (!raw) return '#';
  if (!isLikelyHomepageUrl(raw)) return raw;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    const q = `site:${host} ${String(signal?.title || '').trim()}`.trim();
    return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  } catch {
    return raw;
  }
};

const IntelRadar = () => {
  const { marketSignals, upsertMarketSignals, updateMarketSignal, convertSignalToFollowUpProject, addKnowledgeDoc, addReminder } = useApp();
  const location = useLocation();
  const [regions, setRegions] = useState<string[]>(Array.from(INTEL_REGIONS));
  const [industries, setIndustries] = useState<string[]>(Array.from(INTEL_INDUSTRIES));
  const [statusFilter, setStatusFilter] = useState<MarketSignal['status'] | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchSource, setFetchSource] = useState<'server' | 'cache' | null>(null);
  const [isArchivingDigest, setIsArchivingDigest] = useState(false);
  const [fetchError, setFetchError] = useState<string>('');
  const [fetchNotice, setFetchNotice] = useState<string>('');
  const [lastRunAt, setLastRunAt] = useState<string>('');
  const [latestFetchIds, setLatestFetchIds] = useState<string[]>([]);
  const [latestOnly, setLatestOnly] = useState<boolean>(false);
  const [recentOnly, setRecentOnly] = useState<boolean>(true);

  // 情报源设置面板
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [cfgKeywords, setCfgKeywords] = useState<string>('');
  const [cfgSourceUrls, setCfgSourceUrls] = useState<string>('');
  const [cfgLimit, setCfgLimit] = useState<number>(20);
  const [cfgSaving, setCfgSaving] = useState<boolean>(false);
  const [cfgSavedAt, setCfgSavedAt] = useState<string>('');
  useEffect(() => {
    intelConfigService.getConfig().then((c) => {
      setCfgKeywords((c.keywords || []).join('\n'));
      setCfgSourceUrls((c.sourceUrls || []).join('\n'));
      setCfgLimit(c.limit || 20);
      if (Array.isArray(c.regions) && c.regions.length) setRegions(c.regions);
      if (Array.isArray(c.industries) && c.industries.length) setIndustries(c.industries);
      if (c.updatedAt) setCfgSavedAt(c.updatedAt);
    }).catch(() => {});
  }, []);
  const saveIntelConfig = async () => {
    setCfgSaving(true);
    try {
      const toLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const saved = await intelConfigService.saveConfig({
        regions, industries,
        keywords: toLines(cfgKeywords),
        sourceUrls: toLines(cfgSourceUrls),
        limit: Number(cfgLimit) || 20,
      } as IntelConfig);
      setCfgSavedAt(saved.updatedAt || new Date().toISOString());
    } catch (e) {
      alert('保存失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCfgSaving(false);
    }
  };
  const [sortMode, setSortMode] = useState<SortMode>('published_desc');
  const [backendHealth, setBackendHealth] = useState<{
    ok: boolean;
    error?: string;
    keyLoaded?: boolean;
    keyLength?: number;
    keys?: Record<string, boolean>;
    provider?: string;
    fallback?: string;
  } | null>(null);
  const [detailMode, setDetailMode] = useState<'quick' | 'full'>('quick');
  const likelyBackendIssue = /端口|后端|HTTP|连接|KIMI|Failed to fetch|代理/i.test(fetchError || '');
  const visibleSignals = useMemo(() => marketSignals.filter(isUsableSignal), [marketSignals]);
  const latestFetchSet = useMemo(() => new Set(latestFetchIds), [latestFetchIds]);
  const hasHistoricalFallback = visibleSignals.length > 0 && latestFetchIds.length === 0;
  const showBlockingFetchError = Boolean(fetchError) && (likelyBackendIssue || visibleSignals.length === 0);
  const showingHistoricalOnly = hasHistoricalFallback && (Boolean(fetchError) || fetchSource === 'cache');
  const historicalFallbackNotice = fetchNotice || '本次联网抓取未返回新增可用情报，当前展示最近缓存/历史情报。';

  const checkBackend = async () => {
    const targets = [
      '/api/ai/health',
      String(import.meta.env.VITE_API_BASE_URL || '').trim() ? `${String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')}/api/ai/health` : '',
      'http://127.0.0.1:3101/api/ai/health',
      'http://127.0.0.1:3001/api/ai/health'
    ].filter(Boolean);
    try {
      let lastError = '后端异常';
      for (const url of targets) {
        const res = await fetch(url, { credentials: 'include' });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        const code = Number(data?.code);
        const payload = data && typeof data?.data === 'object' ? data.data : data;
        const ok = Number.isFinite(code) ? code === 0 : Boolean(data?.ok);
        if (!res.ok || !ok) {
          lastError = String(data?.message || data?.error || `后端异常（HTTP ${res.status}）`);
          const envelopeMissing = !Number.isFinite(code) && typeof data?.ok !== 'boolean';
          if ([404, 405, 502, 503, 504].includes(res.status) || envelopeMissing) {
            continue;
          }
          setBackendHealth({ ok: false, error: lastError });
          return;
        }
        setBackendHealth({
          ok: true,
          keyLoaded: Boolean(payload?.keyLoaded) || Object.values(payload?.keys || {}).some(Boolean),
          keyLength: Number(payload?.keyLength || 0),
          keys: payload?.keys || undefined,
          provider: payload?.provider || undefined,
          fallback: payload?.fallback || undefined
        });
        return;
      }
      setBackendHealth({ ok: false, error: lastError });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'Failed to fetch');
      setBackendHealth({ ok: false, error: msg });
    }
  };
  const selected = useMemo(() => visibleSignals.find(s => s.id === selectedId) || null, [visibleSignals, selectedId]);
  const selectedOpenUrl = useMemo(() => selected ? buildOriginalOpenUrl(selected) : '#', [selected]);
  const selectedOpenNeedsSearch = useMemo(
    () => Boolean(selected && isLikelyHomepageUrl(selected.sourceUrl)),
    [selected]
  );
  useEffect(() => {
    // When switching signals, default to quick view to keep scanning fast.
    setDetailMode('quick');
  }, [selectedId]);

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = visibleSignals
      .filter(s => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter(s => (regions.length === 0 ? true : s.regions.some(r => regions.includes(r))))
      .filter(s => (industries.length === 0 ? true : s.industries.some(i => industries.includes(i))))
      .filter(s => (recentOnly ? isWithinDays(s.publishedAt, UI_RECENT_DAYS) : true))
      .filter(s => {
        if (!q) return true;
        const hay = `${s.title} ${s.summary} ${(s.tags || []).join(' ')} ${(s.serviceCategory || '')}`.toLowerCase();
        return hay.includes(q);
      });

    if (latestOnly && latestFetchSet.size > 0) {
      list = list.filter(s => latestFetchSet.has(s.id));
    }

    return list.sort((a, b) => {
      if (sortMode === 'score_desc') {
        if (b.score !== a.score) return b.score - a.score;
        return toTime(b.publishedAt) - toTime(a.publishedAt);
      }
      if (sortMode === 'published_desc') {
        const d = toTime(b.publishedAt) - toTime(a.publishedAt);
        if (d !== 0) return d;
        return b.score - a.score;
      }
      const aFetched = Math.max(toTime(a.updatedAt), toTime(a.createdAt));
      const bFetched = Math.max(toTime(b.updatedAt), toTime(b.createdAt));
      const d = bFetched - aFetched;
      if (d !== 0) return d;
      return b.score - a.score;
    });
  }, [visibleSignals, statusFilter, regions, industries, query, latestOnly, latestFetchSet, sortMode, recentOnly]);

  const stats = useMemo(() => {
    const total = visibleSignals.length;
    const today = toLocalYmd(new Date());
    const todayCount = visibleSignals.filter(s => {
      const ts = toTime(s.createdAt);
      if (!ts) return false;
      return toLocalYmd(new Date(ts)) === today;
    }).length;
    const high = visibleSignals.filter(s => s.urgency === 'high' && s.status !== MARKET_SIGNAL_STATUS.CONVERTED && s.status !== MARKET_SIGNAL_STATUS.IGNORED).length;
    const converted = visibleSignals.filter(s => s.status === MARKET_SIGNAL_STATUS.CONVERTED).length;
    return { total, todayCount, high, converted };
  }, [visibleSignals]);

  const fetchToday = async () => {
    setIsFetching(true);
    setFetchError('');
    setFetchNotice('正在抓取今日情报，请稍候...');
    try {
      const result = await intelService.fetchDailySignals({ regions, industries, limit: Number(cfgLimit) || 20 });
      setFetchSource(result.source || 'server');
      if (!result.ok) {
        if (result.signals.length > 0) {
          upsertMarketSignals(result.signals);
          const thisIds = result.signals.map(s => s.id).filter(Boolean);
          setLatestFetchIds(thisIds);
          setLatestOnly(thisIds.length > 0);
          setRecentOnly(true);
          setSortMode('published_desc');
          if (!selectedId && result.signals.length > 0) setSelectedId(result.signals[0].id);
          const dropTip = (result.droppedStale || 0) + (result.droppedUndated || 0) > 0
            ? `（已过滤超时效 ${Number(result.droppedStale || 0)} 条、无日期 ${Number(result.droppedUndated || 0)} 条）`
            : '';
          const geoTip = (result.droppedGeo || 0) + (result.droppedGeoConflict || 0) > 0
            ? `；已过滤跨区域 ${Number(result.droppedGeo || 0)} 条（冲突 ${Number(result.droppedGeoConflict || 0)} 条）`
            : '';
          const rescuedTip = (result.rescuedUndated || 0) > 0 ? `；其中 ${Number(result.rescuedUndated || 0)} 条为“日期待核验”补位` : '';
          setFetchNotice((result.error || `本次联网抓取失败，已回退缓存（${result.signals.length} 条）。`) + dropTip + geoTip + rescuedTip);
          return;
        }
        const latest = await intelService.fetchLatestSignals();
        if (latest.ok && latest.signals.length > 0) {
          upsertMarketSignals(latest.signals);
          setLatestFetchIds([]);
          setLatestOnly(false);
          setRecentOnly(true);
          setSortMode('published_desc');
          if (!selectedId) setSelectedId(latest.signals[0].id);
          if (latest.lastRunAt) setLastRunAt(latest.lastRunAt);
          setFetchError('');
          setFetchSource('cache');
          setFetchNotice(`本次联网抓取未返回新增可用情报，已展示最近缓存/历史情报（${latest.signals.length} 条）。`);
          return;
        }
        setLatestFetchIds([]);
        setLatestOnly(false);
        setFetchError(result.error || '抓取失败，请检查后端与 API Key。');
        setFetchNotice('');
        checkBackend();
        return;
      }
      if (result.signals.length === 0) {
        const latest = await intelService.fetchLatestSignals();
        if (latest.ok && latest.signals.length > 0) {
          upsertMarketSignals(latest.signals);
          setLatestFetchIds([]);
          setLatestOnly(false);
          setRecentOnly(true);
          setSortMode('published_desc');
          if (!selectedId) setSelectedId(latest.signals[0].id);
          if (latest.lastRunAt) setLastRunAt(latest.lastRunAt);
          setFetchSource('cache');
          setFetchNotice(`抓取完成但本次没有新增可用情报，已展示最近缓存/历史情报（${latest.signals.length} 条）。`);
          return;
        }
        setFetchError('抓取成功但没有结果：请调整区域/行业关键词后再试。');
        return;
      }
      upsertMarketSignals(result.signals);
      const thisIds = result.signals.map(s => s.id).filter(Boolean);
      setLatestFetchIds(thisIds);
      setLatestOnly(thisIds.length > 0);
      setRecentOnly(true);
      setSortMode('published_desc');
      const dropTip = (result.droppedStale || 0) + (result.droppedUndated || 0) > 0
        ? `；已过滤超时效 ${Number(result.droppedStale || 0)} 条、无日期 ${Number(result.droppedUndated || 0)} 条`
        : '';
      const geoTip = (result.droppedGeo || 0) + (result.droppedGeoConflict || 0) > 0
        ? `；已过滤跨区域 ${Number(result.droppedGeo || 0)} 条（冲突 ${Number(result.droppedGeoConflict || 0)} 条）`
        : '';
      const rescuedTip = (result.rescuedUndated || 0) > 0 ? `；补位“日期待核验” ${Number(result.rescuedUndated || 0)} 条` : '';
      setFetchNotice(`抓取完成：返回 ${result.signals.length} 条情报（来源：${result.source === 'cache' ? '缓存回退' : '联网检索'}），已切换为“仅看本次抓取”+“近${UI_RECENT_DAYS}天”${dropTip}${geoTip}${rescuedTip}。`);
      const latestAfter = await intelService.fetchLatestSignals();
      if (latestAfter.ok && latestAfter.lastRunAt) setLastRunAt(latestAfter.lastRunAt);
      const today = new Date().toISOString().split('T')[0];
      const lastNotice = dataService.get<string>('intel_last_notice', '');
      if (today !== lastNotice) {
        addReminder({
          title: `📡 情报雷达今日已更新`,
          content: `今日新增 ${result.signals.length} 条情报，已完成抓取与评分。建议优先处理高紧急信号。`,
          date: today,
          type: 'opportunity',
          linkType: 'intel',
          linkId: today,
          forRole: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
        });
        dataService.set('intel_last_notice', today);
      }
      if (result.signals.length > 0) setSelectedId(result.signals[0].id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || '未知错误');
      setFetchError(`抓取异常：${msg}`);
      setFetchNotice('');
      checkBackend();
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    const loadLatest = async () => {
      checkBackend();
      const latest = await intelService.fetchLatestSignals();
      if (!latest.ok) return;
      if (latest.signals.length > 0) {
        upsertMarketSignals(latest.signals);
        if (!selectedId) setSelectedId(latest.signals[0].id);
      }
      if (latest.lastRunAt) setLastRunAt(latest.lastRunAt);

      const lastNotice = dataService.get<string>('intel_last_notice', '');
      const runDate = (latest.lastRunAt || '').slice(0, 10);
      if (runDate && runDate !== lastNotice) {
        addReminder({
          title: `📡 情报雷达今日已更新`,
          content: `自动抓取已完成。点击进入情报雷达查看详情并转化为项目。`,
          date: runDate,
          type: 'opportunity',
          linkType: 'intel',
          linkId: runDate,
          forRole: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
        });
        dataService.set('intel_last_notice', runDate);
      }
    };
    loadLatest();
  }, []);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some(item => item.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    const state: any = location.state || {};
    const openDetailId = String(state.openDetailId || '').trim();
    if (!openDetailId) return;
    const direct = visibleSignals.find(signal => signal.id === openDetailId);
    if (direct) {
      setSelectedId(direct.id);
      window.history.replaceState({}, document.title);
      return;
    }
    const byDate = /^\d{4}-\d{2}-\d{2}$/.test(openDetailId)
      ? visibleSignals.find(signal => String(signal.publishedAt || '').startsWith(openDetailId) || String(signal.createdAt || '').startsWith(openDetailId))
      : null;
    if (byDate) {
      setSelectedId(byDate.id);
      window.history.replaceState({}, document.title);
      return;
    }
    if (visibleSignals.length > 0) {
      setSelectedId(visibleSignals[0].id);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, visibleSignals]);

  const archiveDailyDigest = async () => {
    const today = new Date().toISOString().split('T')[0];
    const top = filtered.slice(0, 10);
    if (top.length === 0) return;
    setIsArchivingDigest(true);
    try {
      const content = `# 情报雷达日报（${today}）\n\n` + top.map((s, idx) => {
        const regionsText = (s.regions || []).join('、') || '-';
        const industriesText = (s.industries || []).map(industryLabel).join('、') || '-';
        const svc = s.serviceCategory || '待识别';
        const link = s.sourceUrl && s.sourceUrl !== '#' ? s.sourceUrl : '';
        const full = (s.content || '').trim();
        const actions = Array.isArray(s.recommendedActions) && s.recommendedActions.length > 0 ? s.recommendedActions : [];
        const hypo = Array.isArray(s.opportunityHypothesis) && s.opportunityHypothesis.length > 0 ? s.opportunityHypothesis : [];
        return `## ${idx + 1}. ${s.title}\n- 类型：${kindLabel[s.kind]} | 紧急度：${s.urgency} | 评分：${s.score}\n- 区域：${regionsText}\n- 行业：${industriesText}\n- 可能服务：${svc}\n- 摘要：${s.summary}\n${full ? `\n### 详情\n${full}\n` : ''}\n${hypo.length > 0 ? `### 可转化假设\n${hypo.map(x => `- ${x}`).join('\n')}\n` : ''}\n${actions.length > 0 ? `### 推荐动作\n${actions.map(x => `- ${x}`).join('\n')}\n` : ''}\n${link ? `- 原文：${link}\n` : ''}\n`;
      }).join('\n');

      await addKnowledgeDoc({
        id: `DOC-INTEL-DIGEST-${Date.now()}`,
        title: `情报雷达日报｜${today}`,
        category: 'Other',
        format: 'Markdown',
        size: '3 KB',
        updatedAt: today,
        content,
        summary: `今日情报 Top ${top.length}（区域：${regions.join('、')}；行业：${industries.map(industryLabel).join('、')}）。`,
        // 情报日报是新闻资讯，不是可复用知识。进 RAG 只会污染检索结果、还要花钱做摘要（P0-13）
        aiVisible: false,
        source: 'system',
        autoGenerated: true,
        linkType: 'other',
        linkId: 'intel-digest',
        linkTitle: '情报雷达日报',
        tags: ['情报雷达', '日报', ...regions.map(r => `region:${r}`), ...industries.map(i => `industry:${i}`)],
        accessRoles: ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE'],
        accessUserIds: []
      });
      alert('✅ 已归档到知识中心（可搜索“情报雷达日报”或标签）。');
    } finally {
      setIsArchivingDigest(false);
    }
  };

  const markIgnored = (id: string) => updateMarketSignal(id, { status: MARKET_SIGNAL_STATUS.IGNORED });
  const markTriaged = (id: string) => updateMarketSignal(id, { status: MARKET_SIGNAL_STATUS.TRIAGED });

  return (
    <div className="flex flex-col h-auto lg:h-[calc(100vh-64px)] animate-in fade-in duration-300 overflow-y-auto lg:overflow-hidden">
      <div className="p-4 lg:p-6 pb-0 flex-none space-y-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">情报雷达</h1>
            <p className="text-sm text-gray-500 mt-1">
              把"政策/行业/企业/招采/标准"变成可转化机会。下方为全部可用情报的总览，右侧列表按左边筛选条件显示。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchToday}
              disabled={isFetching}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center border shadow-sm transition-all active:scale-95 ${
                isFetching ? 'bg-gray-100 text-gray-400 border-gray-200' : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isFetching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              抓取今日情报
            </button>
            <button
              onClick={archiveDailyDigest}
              disabled={isArchivingDigest || filtered.length === 0}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center border shadow-sm transition-all active:scale-95 ${
                (isArchivingDigest || filtered.length === 0)
                  ? 'bg-gray-100 text-gray-400 border-gray-200'
                  : 'bg-white text-gray-800 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {isArchivingDigest ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              归档日报
            </button>
            <button
              onClick={() => setShowConfig((v) => !v)}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center border shadow-sm transition-all active:scale-95 ${
                showConfig ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-800 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Settings2 className="w-4 h-4 mr-2" />
              情报源设置
            </button>
            {fetchSource && (
              <span className="text-xs text-gray-400">
                来源：{fetchSource === 'cache' ? '缓存回退' : '联网检索'}
              </span>
            )}
            {lastRunAt && (
              <span className="text-xs text-gray-400">
                最近自动抓取：{toLocalYmdHm(lastRunAt)}
              </span>
            )}
          </div>
        </div>

        {showBlockingFetchError && (
          <div className="bg-amber-50 border border-amber-100 text-amber-800 rounded-2xl p-4 text-sm font-bold">
            {fetchError}
            {likelyBackendIssue ? (
              <div className="text-xs font-medium text-amber-700 mt-2">
                请确保后端已启动：`npm run start`（端口 3001），并在服务端环境变量中配置模型密钥。
              </div>
            ) : (
              <div className="text-xs font-medium text-amber-700 mt-2">
                建议先缩小行业/区域范围后重试；系统已自动尝试结构化重试与缓存回退。
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-amber-700">
                后端自检：{backendHealth?.ok
                  ? `OK（${backendHealth.fallback || backendHealth.provider || (backendHealth.keys ? Object.keys(backendHealth.keys).filter(k => backendHealth.keys?.[k]).join(' / ') : `KeyLoaded=${String(backendHealth.keyLoaded)}`)}）`
                  : (backendHealth?.error ? `失败（${backendHealth.error}）` : '未检查')}
              </div>
              <button
                onClick={checkBackend}
                className="px-3 py-1.5 rounded-lg text-xs font-black border border-amber-200 bg-white text-amber-800 hover:bg-amber-50"
              >
                检查后端
              </button>
            </div>
          </div>
        )}
        {!showBlockingFetchError && (fetchNotice || (fetchError && hasHistoricalFallback)) && (
          <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-2xl p-4 text-sm font-bold">
            {historicalFallbackNotice}
          </div>
        )}

        {showConfig && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-black text-gray-900 flex items-center gap-2"><Settings2 className="w-4 h-4" /> 情报源设置</div>
              <div className="text-xs text-gray-400">{cfgSavedAt ? `上次保存：${toLocalYmdHm(cfgSavedAt)}` : '未保存'}</div>
            </div>
            <div className="text-xs text-gray-500 -mt-2">配置抓取范围与情报源；抓取例程（天眼查企业信号 + 联网政策/行情）会按此设置运行。区域/行业沿用下方过滤器的选择。</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-600">关键词模板（每行一个，用于联网检索政策/招采/动态）</label>
                <textarea
                  value={cfgKeywords}
                  onChange={(e) => setCfgKeywords(e.target.value)}
                  rows={5}
                  placeholder={'招标 认证\n抽检 不合格\n出口 欧盟 合规\n新建 扩产'}
                  className="mt-1 w-full text-sm border border-gray-200 rounded-xl p-2 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600">自定义情报源 URL / RSS（每行一个，政府/招投标/行业协会官网）</label>
                <textarea
                  value={cfgSourceUrls}
                  onChange={(e) => setCfgSourceUrls(e.target.value)}
                  rows={5}
                  placeholder={'https://www.ccgp-zhejiang.gov.cn/\nhttps://www.samr.gov.cn/'}
                  className="mt-1 w-full text-sm border border-gray-200 rounded-xl p-2 font-mono"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="text-xs font-bold text-gray-600">单次抓取条数</label>
              <input
                type="number" min={1} max={50} value={cfgLimit}
                onChange={(e) => setCfgLimit(Number(e.target.value))}
                className="w-24 text-sm border border-gray-200 rounded-lg px-2 py-1.5"
              />
              <div className="flex-1" />
              <button
                onClick={saveIntelConfig}
                disabled={cfgSaving}
                className={`px-4 py-2 rounded-xl text-sm font-bold border ${cfgSaving ? 'bg-gray-100 text-gray-400 border-gray-200' : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'}`}
              >
                {cfgSaving ? '保存中…' : '保存设置'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-blue-200 transition-colors">
            <div className="p-3 bg-blue-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><Radar className="w-6 h-6 text-blue-600" /></div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-gray-900">{stats.total}</div>
              <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">可用情报总数</div>
            </div>
          </div>
          {/* 原来是「今日新增」，历史数据下恒为 0；换成"当前筛选命中"，直接和右侧列表条数对上 */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-emerald-200 transition-colors">
            <div className="p-3 bg-emerald-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><Sparkles className="w-6 h-6 text-emerald-600" /></div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-gray-900">{filtered.length}</div>
              <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">当前筛选命中</div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center group hover:border-amber-200 transition-colors">
            <div className="p-3 bg-amber-50 rounded-xl mr-4 group-hover:scale-110 transition-transform"><Flame className="w-6 h-6 text-amber-600" /></div>
            <div className="min-w-0">
              <div className="text-2xl font-black text-gray-900">{stats.high}</div>
              <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">高紧急</div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-5 rounded-2xl shadow-lg flex items-center text-white">
            <div className="p-3 bg-white/20 rounded-xl mr-4"><Target className="w-6 h-6" /></div>
            <div className="min-w-0">
              <div className="text-2xl font-black">{stats.converted}</div>
              <div className="text-xs opacity-80 font-bold uppercase tracking-tight">已转化为线索</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-visible lg:overflow-hidden p-4 lg:p-6 pt-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto lg:h-full">
          <div className="lg:col-span-1 space-y-4 lg:overflow-y-auto lg:pr-2">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center text-sm font-black text-gray-900">
                  <Filter className="w-4 h-4 mr-2 text-gray-500" /> 过滤条件
                </div>
                <button
                  onClick={() => { setRegions(Array.from(INTEL_REGIONS)); setIndustries(Array.from(INTEL_INDUSTRIES)); setStatusFilter('all'); setQuery(''); setLatestOnly(false); setRecentOnly(true); setSortMode('published_desc'); }}
                  className="text-xs font-bold text-gray-500 hover:text-gray-700"
                >
                  重置
                </button>
              </div>

              <div className="mb-4">
                <div className="text-xs font-bold text-gray-400 uppercase mb-2">状态</div>
                <div className="flex flex-wrap gap-2">
                  {(['all', MARKET_SIGNAL_STATUS.NEW, MARKET_SIGNAL_STATUS.TRIAGED, MARKET_SIGNAL_STATUS.CONVERTED, MARKET_SIGNAL_STATUS.IGNORED] as const).map(s => (
                    <button key={s} className={badgeClass(statusFilter === s)} onClick={() => setStatusFilter(s)}>
                      {s === 'all' ? '全部' : s === MARKET_SIGNAL_STATUS.NEW ? '未处理' : s === MARKET_SIGNAL_STATUS.TRIAGED ? '已分拣' : s === MARKET_SIGNAL_STATUS.CONVERTED ? '已转化' : '已忽略'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <div className="text-xs font-bold text-gray-400 uppercase mb-2">区域</div>
                <div className="flex flex-wrap gap-2">
                  {Array.from(INTEL_REGIONS).map(r => (
                    <button key={r} className={badgeClass(regions.includes(r))} onClick={() => setRegions(prev => toggle(prev, r))}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <div className="text-xs font-bold text-gray-400 uppercase mb-2">行业</div>
                <div className="flex flex-wrap gap-2">
                  {Array.from(INTEL_INDUSTRIES).map(i => (
                    <button key={i} className={badgeClass(industries.includes(i))} onClick={() => setIndustries(prev => toggle(prev, i))}>
                      {industryLabel(i)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold text-gray-400 uppercase mb-2">搜索</div>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="标题/摘要/标签/服务类目"
                    className="w-full bg-white border border-gray-200 rounded-xl py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <div className="text-sm font-black text-gray-900 flex items-center">
                <Sparkles className="w-4 h-4 mr-2 text-indigo-600" /> 贾维斯建议（下一步）
              </div>
              <div className="text-xs text-gray-500 mt-2 leading-relaxed">
                这里的提醒不放“全部内容”，只放可执行建议：先处理高紧急信号 → 一键生成跟进项目 → 成交后自动生成 PDCA 复盘。
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 h-auto lg:h-full lg:overflow-y-auto lg:pr-2 flex flex-col gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex-none">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-black text-gray-900">信号列表</div>
                  <button
                    onClick={() => setRecentOnly(prev => !prev)}
                    className={`text-[11px] font-black px-2.5 py-1 rounded-lg border ${
                      recentOnly
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {recentOnly ? `近${UI_RECENT_DAYS}天` : '不限时间'}
                  </button>
                  {latestFetchIds.length > 0 && (
                    <button
                      onClick={() => setLatestOnly(prev => !prev)}
                      className={`text-[11px] font-black px-2.5 py-1 rounded-lg border ${
                        latestOnly
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {latestOnly ? `本次抓取 ${latestFetchIds.length} 条` : '显示全部历史'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-gray-400">共 {filtered.length} 条</div>
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 font-bold text-gray-600"
                  >
                    <option value="fetched_desc">按入库时间</option>
                    <option value="score_desc">按评分</option>
                    <option value="published_desc">按原文发布时间</option>
                  </select>
                </div>
              </div>
              {showingHistoricalOnly && (
                <div className="px-5 py-2.5 text-xs font-bold text-blue-700 bg-blue-50 border-b border-blue-100">
                  本次抓取未返回新增可用情报，当前列表展示的是最近缓存/历史情报。
                </div>
              )}
              <div className="divide-y divide-gray-100 max-h-[60vh] lg:max-h-none overflow-y-auto lg:overflow-visible">
                {filtered.length === 0 ? (
                  <div className="p-10 text-center text-gray-400 text-sm">
                    暂无情报。点击右上角“抓取今日情报”开始。
                  </div>
                ) : (
                  filtered.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${selectedId === s.id ? 'bg-indigo-50/50' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {latestFetchSet.has(s.id) && (
                              <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                                本次抓取
                              </span>
                            )}
                            <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-gray-50 text-gray-600 border border-gray-200">
                              {kindLabel[s.kind]}
                            </span>
                            <span className={`text-[10px] font-black px-2 py-1 rounded-lg border ${urgencyPill(s.urgency)}`}>
                              {s.urgency === 'high' ? '高紧急' : s.urgency === 'medium' ? '中紧急' : '低紧急'}
                            </span>
                            {s.serviceCategory && (
                              <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {s.serviceCategory}
                              </span>
                            )}
                          </div>
                          <div className="font-black text-gray-900 truncate">{s.title}</div>
                          <div className="text-xs text-gray-500 mt-1 line-clamp-2">{s.summary}</div>
                          <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-gray-400">
                            <span className="inline-flex items-center"><Calendar className="w-3 h-3 mr-1" />{renderPublishedTime(s)}</span>
                            <span className="inline-flex items-center">系统入库 {String(s.createdAt || '').slice(0, 10) || '-'}</span>
                            <span className="inline-flex items-center"><Target className="w-3 h-3 mr-1" />评分 {s.score}</span>
                            {s.deadline && <span className="inline-flex items-center"><Flame className="w-3 h-3 mr-1 text-red-500" />截止 {s.deadline}</span>}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {s.status === MARKET_SIGNAL_STATUS.CONVERTED ? (
                            <span className="text-[10px] font-black px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-100 inline-flex items-center">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> 已转化
                            </span>
                          ) : s.status === MARKET_SIGNAL_STATUS.IGNORED ? (
                            <span className="text-[10px] font-black px-2 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-200 inline-flex items-center">
                              <XCircle className="w-3 h-3 mr-1" /> 已忽略
                            </span>
                          ) : (
                            <span className="text-[10px] font-black px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 inline-flex items-center">
                              <PlusCircle className="w-3 h-3 mr-1" /> 待处理
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {selected && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="font-black text-gray-900 truncate">{selected.title}</div>
                  <a
                    href={selectedOpenUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                  >
                    {selectedOpenNeedsSearch ? '检索并打开原文' : '打开原文'}
                  </a>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-gray-500">
                      详情视图：
                      <button
                        onClick={() => setDetailMode('quick')}
                        className={`ml-2 px-2.5 py-1 rounded-lg border text-xs font-black ${
                          detailMode === 'quick' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        精简
                      </button>
                      <button
                        onClick={() => setDetailMode('full')}
                        className={`ml-2 px-2.5 py-1 rounded-lg border text-xs font-black ${
                          detailMode === 'full' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        完整
                      </button>
                    </div>
                    <div className="text-xs text-gray-400">
                      {selected.content ? `详情 ${selected.content.length} 字` : '无详情字段（将使用摘要）'}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                      {kindLabel[selected.kind]} · {selected.sourceName}
                    </span>
                    <span className={`text-[11px] font-black px-3 py-1.5 rounded-full border ${urgencyPill(selected.urgency)}`}>
                      紧急度：{selected.urgency}
                    </span>
                    <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                      评分：{selected.score}
                    </span>
                    <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                      {renderPublishedTime(selected)}
                    </span>
                    <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                      系统入库：{String(selected.createdAt || '').slice(0, 10) || '-'}
                    </span>
                  </div>

                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {detailMode === 'full' ? (selected.content || selected.summary) : selected.summary}
                  </div>
                  {selectedOpenNeedsSearch && (
                    <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                      当前来源链接是网站首页，已自动切换为“站内标题检索直达”，避免你手动二次搜索。
                    </div>
                  )}

                  {detailMode === 'full' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        <div className="text-xs font-black text-gray-400 uppercase">可转化假设</div>
                        <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">
                          {(selected.opportunityHypothesis || []).length > 0 ? (selected.opportunityHypothesis || []).map(x => `• ${x}`).join('\n') : '—'}
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        <div className="text-xs font-black text-gray-400 uppercase">推荐动作</div>
                        <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">
                          {(selected.recommendedActions || []).length > 0 ? (selected.recommendedActions || []).map(x => `• ${x}`).join('\n') : '—'}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <div className="text-xs font-black text-gray-400 uppercase">区域</div>
                      <div className="text-sm font-bold text-gray-800 mt-1">{selected.regions.join('、') || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <div className="text-xs font-black text-gray-400 uppercase">行业</div>
                      <div className="text-sm font-bold text-gray-800 mt-1">{selected.industries.map(industryLabel).join('、') || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <div className="text-xs font-black text-gray-400 uppercase">服务映射</div>
                      <div className="text-sm font-bold text-gray-800 mt-1">{selected.serviceCategory || '待识别'}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => { void convertSignalToFollowUpProject(selected.id); }}
                      disabled={selected.status === MARKET_SIGNAL_STATUS.CONVERTED}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                        selected.status === MARKET_SIGNAL_STATUS.CONVERTED
                          ? 'bg-gray-100 text-gray-400 border-gray-200'
                          : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      一键生成跟进项目
                    </button>
                    <button
                      onClick={() => markTriaged(selected.id)}
                      className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      标记已分拣
                    </button>
                    <button
                      onClick={() => markIgnored(selected.id)}
                      className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      忽略
                    </button>
                  </div>

                  {selected.convertedTo?.projectId && (
                    <div className="text-xs text-gray-500">
                      已转化为项目：<span className="font-mono">{selected.convertedTo.projectId}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntelRadar;
