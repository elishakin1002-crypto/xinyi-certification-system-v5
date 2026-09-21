/*
  工作台每张卡的链接，那头必须有人接。

  ══════════════════════════════════════════════════════════════
  为什么需要它（2026-09-21）
  ══════════════════════════════════════════════════════════════

  Codex 实地走查发现三张卡**点了等于没点**：

    总助「待指派负责人 1」  → 地址带 filter=unassigned，页面仍显示默认 3 个项目
    总助「三天内到期任务 3」→ 地址带 filter=duesoon，同样不筛
    顾问「今天要做」        → 地址带 task=today，点进去显示 8 个项目

  链路是三段：
    ① 卡片发一个 URL（services/dashboardMetrics.ts）
    ② 有人把 URL 翻译成 focus（src/modules/dashboardNavigation.ts）
    ③ 落地页按 focus 筛选（pages/Projects.tsx 等）

  **中间任何一段断了，都是静悄悄的** —— 页面照样打开、照样显示东西，
  只是显示的不是你点的那个。人第一反应是"这个数字算错了"，
  而真相是筛选根本没生效。

  顾问那张「今天要做」是我 2026-09-20 自己加的 ——
  我只做了第①段就以为完事了。所以这条测试盯的是**我自己**最容易犯的错。

  ── 怎么查 ────────────────────────────────────────────────────

  静态对账：把①里所有卡片 URL 的查询参数抽出来，
  逐个确认②里有对应的解析分支。抓不到第③段（那要真的点，归 e2e），
  但①→②这一段断掉是最常见的，而且这一段可以精确检查。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* 注释里写着示例 URL 是正常的，抹白保行号 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i) + ' '.repeat(l.length - i); })
    .join('\n');

/**
 * 不需要 focus 的参数 —— 它们不是"筛选意图"，写清为什么。
 */
const NOT_A_FOCUS = {
  owner: '只是标记"看我的还是看全部"，本身不决定筛什么',
  projectId: '定位到某一条，不是筛选',
  persona: '切看板视角，不传给落地页',
  q: '搜索词，落地页自己读',
  month: 'created_month 的附属参数',
  range: 'logs 的附属参数',
  metric: 'logs 的附属参数',
  period: '已在 created_week 分支里处理',
  tab: '切页签（财务页的回款/结算），不是筛选条件 —— 页面自己读，不走 focus',
  analysis: '财务页用通配分支接（else if (analysis) focus = { type: \'analysis\', analysis }），具体值不逐个列'
};

test('工作台卡片发出的每个筛选参数，路由解析里都要有人接', () => {
  const metrics = stripComments(read('services/dashboardMetrics.ts'));
  const nav = stripComments(read('src/modules/dashboardNavigation.ts'));

  /*
    抽出所有 `route: \`...?a=b&c=d\`` 里的 键=值。
    只看有字面值的（${} 拼出来的动态值没法静态对账，那类靠 e2e）。
  */
  const pairs = new Set();
  for (const m of metrics.matchAll(/route:\s*`[^`]*\?([^`]*)`/g)) {
    for (const kv of m[1].split('&')) {
      const [k, v] = kv.split('=');
      if (!k || !v || v.includes('${')) continue;
      if (NOT_A_FOCUS[k]) continue;
      pairs.add(`${k}=${v}`);
    }
  }

  const missing = [];
  for (const kv of pairs) {
    const [k, v] = kv.split('=');
    /*
      解析器里有两种写法，都要认：

        params.get('filter') === 'churn'        直接比
        const filter = params.get('filter')...  先取变量，再 `filter === 'churn'`

      第一版我只认前一种，于是把**财务页那五个其实接了的参数**
      报成"没人接"—— 一个查"链路断没断"的工具自己误报。
      （查之前先看看被查的代码有几种写法，这条又栽了一次。）
    */
    const direct = new RegExp(`params\\.get\\(['"]${k}['"]\\)\\s*===\\s*['"]${v}['"]`);
    const viaVar = new RegExp(`const\\s+${k}\\s*=\\s*String\\(params\\.get\\(['"]${k}['"]\\)`);
    const compared = new RegExp(`\\b${k}\\s*===\\s*['"]${v}['"]`);
    const ok = direct.test(nav) || (viaVar.test(nav) && compared.test(nav));
    if (!ok) missing.push(`  · ${kv}`);
  }

  assert.deepEqual(
    missing.sort(), [],
    '\n\n工作台卡片发出了这些参数，但 src/modules/dashboardNavigation.ts 里没人解析：\n\n'
    + missing.sort().join('\n')
    + '\n\n后果是**点了等于没点** —— 页面照样打开、照样显示东西，'
    + '\n只是显示的不是你点的那个，而且没有任何提示。'
    + '\n人第一反应会是"这个数字算错了"，其实是筛选压根没生效。'
    + '\n\n加卡片时要顺着链路走到底：卡片发 URL → 解析成 focus → 落地页按 focus 筛。'
    + '\n确实不需要 focus 的参数，写进 NOT_A_FOCUS 并说明理由。\n'
  );
});

test('解析出来的每个 focus 类型，项目页都要真的筛', () => {
  /*
    第②→③段。解析器认得一个 focus，但落地页没写对应的筛选分支，
    同样是"点了没反应"——而且更隐蔽，因为地址栏和焦点标签都对。
  */
  const nav = stripComments(read('src/modules/dashboardNavigation.ts'));
  const projects = stripComments(read('pages/Projects.tsx'));

  // 只看跳到项目页那一段里声明的 focus 类型
  const block = nav.slice(nav.indexOf("pathname === '/projects'"), nav.indexOf("pathname === '/contracts'"));
  const types = [...new Set([...block.matchAll(/type:\s*'([a-z_0-9]+)'/g)].map((m) => m[1]))];

  const notHandled = types.filter((t) => !new RegExp(`dashboardFocus\\.type === '${t}'`).test(projects));
  assert.deepEqual(
    notHandled, [],
    `\n\n这些 focus 类型项目页没有对应的筛选分支：${notHandled.join(', ')}\n`
    + '地址栏和焦点标签都会显示正确，但列表根本没筛 —— 比参数没人接更隐蔽。\n'
  );
});
