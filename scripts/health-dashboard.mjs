#!/usr/bin/env node
/*
  工作台真实性体检：卡片点下去到底有没有反应。

    npm run health:dashboard

  ── 系统实际是怎么跳转的 ────────────────────────────────────────
  卡片路由带查询参数（/projects?risk=high），但**页面不读查询串**。
  中间隔着一层翻译：

    卡片 route
      → openDashboardRoute()
      → buildDashboardRouteTarget()   把参数翻成 { type: 'high_risk', … }
      → navigate(path, { state: { dashboardFocus } })
      → 页面读 location.state.dashboardFocus

  三个地方可能断链，断哪一处结果都一样：**点了不筛选**。

    ① 调用方直接 navigate(card.route) —— 绕过翻译层，参数原样丢在 URL 里没人管
    ② 翻译层不认识这个参数组合   —— 翻不出 focus，state 是空的
    ③ 页面不处理这个 focus 类型   —— 收到了但没用

  第 ① 种最隐蔽：点击有反应、页面也切换了，看起来一切正常。
  只有真想按这个条件找数据的人才会发现列表还是全量——通常就是老板在做判断的时候。

  ── 写这个脚本时踩的坑（留给下一个改它的人）──────────────────
  第一版假设「页面直接读查询参数」，跑去 pages/*.tsx 里搜 params.get('x')，
  结论是「44 张卡全部失效」——**完全错了**，它根本没看见翻译层。
  建立在错误架构假设上的检查器比不检查更糟：它会让人去修没坏的东西。
  改这个脚本前，先把 src/modules/dashboardNavigation.ts 从头读一遍。
*/
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const tryRead = (p) => { try { return read(p); } catch { return null; } };

/**
 * 去掉注释再做代码扫描。
 * 不去注释的话，一句「不能直接 navigate(card.route)」的说明性注释
 * 会被当成真的绕过调用报出来——体检脚本第一次跑就栽在自己写的注释上。
 * 同样的坑 health-ui.mjs 也踩过（它把自己的修复说明当成待修文案）。
 */
const stripComments = (src) => String(src || '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // JSX 注释
  .replace(/\/\*[\s\S]*?\*\//g, '')         // 块注释
  .replace(/^\s*\/\/.*$/gm, '');               // 行注释

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

const issues = [];
const notes = [];
const bad = (title, detail, why) => issues.push({ title, detail, why });
const ok = (title, detail) => notes.push({ title, detail });

const PAGE_BY_ROUTE = {
  '/leads': 'pages/Leads.tsx',
  '/customers': 'pages/Customers.tsx',
  '/contracts': 'pages/Contracts.tsx',
  '/projects': 'pages/Projects.tsx',
  '/finance': 'pages/Finance.tsx',
  '/finance/settlements': 'pages/Finance.tsx',
  '/knowledge': 'pages/Knowledge.tsx',
  '/strategy': 'pages/Strategy.tsx',
  '/ai-center': 'pages/AICenter.tsx',
  '/audit': 'pages/Audit.tsx',
  '/intel': 'pages/IntelRadar.tsx',
};

/** 这些参数是「打开某条记录」，不是筛选条件，翻译层单独处理 */
const RECORD_PARAMS = new Set(['leadId', 'projectId', 'contractId', 'docId', 'customerId']);

const personaOf = (id) => (id.startsWith('boss-') ? '老板'
  : id.startsWith('sales-') ? '销售'
  : id.startsWith('cons-') ? '顾问'
  : id.startsWith('fin-') ? '财务' : '其他');

const parseCards = (src) => {
  const cards = [];
  const re = /\{\s*id:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*,[\s\S]*?route:\s*`?([^`,\n]+)`?\s*\}/g;
  let m;
  while ((m = re.exec(src))) cards.push({ id: m[1], title: m[2], routeExpr: m[3].trim() });
  return cards;
};

const resolveRoute = (expr, routeConsts) => {
  let s = expr.replace(/\$\{APP_ROUTES\.([A-Z_]+)\}/g, (_, k) => routeConsts[k] || `/${k.toLowerCase()}`);
  s = s.replace(/\$\{[^}]+\}/g, 'X').replace(/^['"`]|['"`]$/g, '');
  const [page, query = ''] = s.split('?');
  return { page: page.trim(), params: query ? [...new URLSearchParams(query).keys()] : [] };
};

const reads = (src, name) => new RegExp(`params\\.get\\(\\s*['"\`]${name}['"\`]\\s*\\)`).test(src);

const main = () => {
  const metricsSrc = read('services/dashboardMetrics.ts');
  const navSrc = read('src/modules/dashboardNavigation.ts');
  const routesSrc = read('src/routes/index.ts');

  const routeConsts = {};
  const rc = routesSrc.match(/export const APP_ROUTES[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!rc) {
    bad('读不到路由表', 'src/routes/index.ts 里找不到 APP_ROUTES',
      '没有它就没法判断卡片跳去哪——必须报错，不能带着错误前提往下算');
  } else {
    for (const m of rc[1].matchAll(/([A-Z_]+):\s*'([^']+)'/g)) routeConsts[m[1]] = m[2];
  }

  const cards = parseCards(metricsSrc);
  if (!cards.length) {
    bad('解析不到工作台卡片', 'dashboardMetrics.ts 结构可能变了',
      '解析不到等于没检查——必须报出来，不能静悄悄「全部通过」');
  }

  // ── ① 有没有调用方绕过翻译层 ──
  const dashFiles = ['pages/dashboard/BossDashboard.tsx', 'pages/dashboard/PersonaDashboard.tsx',
    'pages/dashboard/SalesDashboard.tsx', 'pages/dashboard/ConsultantDashboard.tsx',
    'pages/dashboard/FinanceDashboard.tsx', 'pages/dashboard/RiskPanel.tsx', 'pages/Dashboard.tsx'];
  const bypass = [];
  for (const f of dashFiles) {
    const src = tryRead(f);
    if (!src) continue;
    const code = stripComments(src);
    for (const m of code.matchAll(/navigate\((\w+)\.route\)/g)) bypass.push(`${f} → navigate(${m[1]}.route)`);
  }
  if (bypass.length) {
    bad('跳转绕过翻译层（点了不筛选）', bypass.join('\n      '),
      '直接 navigate(x.route) 把查询参数原样丢在 URL 里，而页面读的是 location.state。'
      + '要改成 openDashboardRoute(navigate, x.route)');
  } else {
    ok('跳转调用', `${dashFiles.length} 个工作台文件都走 openDashboardRoute`);
  }

  // ── ② 翻译层认不认识每张卡的参数 ──
  const pageSrc = {};
  const srcOf = (p) => (p in pageSrc ? pageSrc[p] : (pageSrc[p] = tryRead(p)));
  const untranslated = [];
  const unknownPage = [];

  for (const card of cards) {
    const { page, params } = resolveRoute(card.routeExpr, routeConsts);
    const file = PAGE_BY_ROUTE[page];
    if (!file) { unknownPage.push(`[${personaOf(card.id)}] ${card.title} → ${page}`); continue; }
    if (!srcOf(file)) { unknownPage.push(`[${personaOf(card.id)}] ${card.title} → ${file}（文件不存在）`); continue; }

    const filters = params.filter((p) => !RECORD_PARAMS.has(p));
    if (!filters.length) { ok(card.title, `${page}（无筛选参数）`); continue; }

    const miss = filters.filter((p) => !reads(navSrc, p));
    if (miss.length) untranslated.push(`[${personaOf(card.id)}] ${card.title} → ${page}，翻译层未读：${miss.join('、')}`);
    else ok(card.title, `${page} ${filters.join('&')} → 翻译层已处理`);
  }

  if (unknownPage.length) bad('卡片跳向未知页面', unknownPage.join('\n      '), '这些路由没有对应页面，点下去是空白或被重定向');
  if (untranslated.length) {
    bad('翻译层不认识的参数', untranslated.join('\n      '),
      'buildDashboardRouteTarget 翻不出 dashboardFocus，页面收到的 state 是空的，等于没筛选');
  }

  // ── ③ 页面认不认 dashboardFocus ──
  const focusPages = ['pages/Leads.tsx', 'pages/Customers.tsx', 'pages/Contracts.tsx',
    'pages/Projects.tsx', 'pages/Finance.tsx', 'pages/Knowledge.tsx'];
  const noFocus = focusPages.filter((f) => { const s = tryRead(f); return s && !s.includes('dashboardFocus'); });
  if (noFocus.length) {
    bad('页面不处理 dashboardFocus', noFocus.join('、'),
      '翻译层把筛选条件放进了 state，页面却没读——链路最后一环断了');
  } else {
    ok('页面消费', `${focusPages.length} 个页面都处理 dashboardFocus`);
  }

  // ── ④ 标称 AI 但没有调用模型 ──
  /*
    **按标称的位置就近判断，不看整个文件。**

    文件级判断在真假并存时必然失效：Dashboard.tsx 里既有真的 AI 提案队列
    （AiProposalQueue），也有假的晨报徽章，只要文件里出现过任一处真调用，
    假的那处就永远报不出来。自测注入假标称、检查器一声不吭，才发现这点。

    现在的做法：找到每处 AI 标称，在它前后各 60 行的范围内找模型调用或
    AI 承载组件。这是启发式，不是证明——
      · 漏报：调用离标称很远（比如在文件顶部的 hook 里）
      · 误报：附近恰好有不相干的 AI 代码
    比文件级准得多，但发现可疑处仍要人去看一眼代码再下结论。
  */
  /*
    只查**声称 AI 做了某件具体事**的说法，不查泛泛的功能描述。

    「全渠道商机捕获与 AI 智能管理」是页面副标题，说的是这个模块有 AI 能力，
    不是断言某段内容由模型生成——查它只会制造长期的红色输出，
    而一个长期红着的检查等于没有检查。

    查的是这类：某个具体模型「驱动」、「AI 检测到 N 个」、「AI 生成」——
    这些都在断言一次真实发生过的模型调用，应当能在附近找到对应代码。
  */
  const CLAIM_RE = /(Kimi|GPT|Claude|文心|通义)[^\n']{0,14}驱动|AI 检测到|AI 分析出|AI 生成的|由 AI (生成|判断|分析)/g;
  const CALL_RE = /aiService\.|generateJSON|generateDeepStrategic|runDeepAnalysis|IngestionUploader|AIChatWidget|AiProposalQueue/;
  const NEAR = 60;

  const aiClaims = [];
  for (const f of ['pages/Dashboard.tsx', ...focusPages, 'pages/Strategy.tsx']) {
    const src = tryRead(f);
    if (!src) continue;
    const lines = stripComments(src).split('\n');
    lines.forEach((line, i) => {
      CLAIM_RE.lastIndex = 0;
      if (!CLAIM_RE.test(line)) return;
      const near = lines.slice(Math.max(0, i - NEAR), i + NEAR).join('\n');
      if (!CALL_RE.test(near)) {
        aiClaims.push(`${f}:${i + 1}　${line.trim().slice(0, 60)}`);
      }
    });
  }
  if (aiClaims.length) {
    bad('标称 AI 但附近没有模型调用', aiClaims.join('\n      '),
      '界面上说是 AI 生成的，附近代码里找不到任何模型调用或 AI 组件。'
      + '系统可以暂时没有 AI，但不能声称有——用的人会据此下判断。'
      + '（就近判断是启发式，请打开对应行确认一次）');
  } else {
    ok('AI 标称', '每处 AI 标称附近都能找到真实调用');
  }

  // ── 报告 ──
  console.log(`\n${C.b}工作台真实性体检${C.x}　${C.d}共 ${cards.length} 张卡片${C.x}\n`);
  if (!issues.length) {
    console.log(`${C.g}✅ 全部通过（${notes.length} 项检查）${C.x}\n`);
    return;
  }
  console.log(`发现 ${issues.length} 个问题：\n`);
  issues.forEach((i, n) => {
    console.log(`${C.r}${n + 1}. ${i.title}${C.x}`);
    console.log(`      ${i.detail}`);
    console.log(`   ${C.d}→ ${i.why}${C.x}\n`);
  });
  console.log(`${C.d}另有 ${notes.length} 项通过。${C.x}\n`);
  process.exitCode = 1;
};

main();
