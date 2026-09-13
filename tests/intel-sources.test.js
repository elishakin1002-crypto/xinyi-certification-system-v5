// 「抓取今日情报」不能是一个装好就是坏的按钮。
//
// 2026-09-13 金恩来：「目前情报雷达，抓取今日情报总是提示没有抓取到任何东西」。
//
// 真因有三个，叠在一起：
//  1. sourceUrls 从来没配过（空数组），但界面只说「没抓到东西」，
//     不说「你一个源都没配」—— 把可操作的原因换成了无从下手的现象。
//  2. 就算配了，60 字的门槛太低：政府网站的列表页条目大多是脚本异步加载的，
//     直抓回来只剩一排栏目名（实测 91 字），照样算「抓到了」。
//  3. 我改 constants.ts 把情报雷达开给系统管理员和销售，
//     **却没改服务端那份角色表** —— 菜单看得见，点什么都 403。
//     这正是 CLAUDE.md 里点名的「权限有三份定义」最高频 bug。
//
// 这组测试把三件事分别钉住。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const {
  DEFAULT_INTEL_SOURCE_URLS,
  REJECTED_SOURCES,
  MIN_SOURCE_TEXT,
  MAX_SOURCES_PER_RUN
} = require(path.join(root, 'server/intelSources.js'));

/** 扫源码先去注释 —— 被淘汰的域名就写在注释里，不去掉会自己打自己 */
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

const appSrc = stripComments(fs.readFileSync(path.join(root, 'server/app.js'), 'utf8'));

test('默认情报源不能是空的 —— 空的就等于这个按钮永远返回「没抓到」', () => {
  assert.ok(DEFAULT_INTEL_SOURCE_URLS.length > 0, '默认清单空了');
  assert.ok(
    DEFAULT_INTEL_SOURCE_URLS.length <= MAX_SOURCES_PER_RUN,
    `配了 ${DEFAULT_INTEL_SOURCE_URLS.length} 个，但一次只取前 ${MAX_SOURCES_PER_RUN} 个，多出来的静悄悄没人抓`
  );
});

test('每条都得是能直接 fetch 的绝对地址', () => {
  for (const url of DEFAULT_INTEL_SOURCE_URLS) {
    assert.match(url, /^https?:\/\/[^\s]+$/, `不是可抓取的地址：${url}`);
  }
  assert.equal(
    new Set(DEFAULT_INTEL_SOURCE_URLS).size,
    DEFAULT_INTEL_SOURCE_URLS.length,
    '有重复的源 —— 重复的那个会白抓一次，还占掉一个名额'
  );
});

test('试过不能用的源不许加回来', () => {
  /*
    这七个都是实抓验过的：不是纯前端渲染（抓回来 7 个字）、
    就是对非浏览器 UA 返回 550、就是域名压根不存在。
    看着都像"官网"，所以很容易有人凭印象又加一遍。
  */
  const hosts = DEFAULT_INTEL_SOURCE_URLS.map((u) => new URL(u).host);
  for (const { host, why } of REJECTED_SOURCES) {
    assert.ok(!hosts.includes(host), `${host} 是试过不能用的：${why}`);
  }
});

test('三个属地政府的域名不能写错 —— 写错了不报错，只是永远抓不到', () => {
  /*
    苍南/平阳/龙港的政府网站都不是"拼音.gov.cn"。
    我第一轮就按直觉写了 cangnan / pingyang / longgang，三个全是 ENOTFOUND ——
    而抓取失败是静默的（fetchTextWithTimeout 出错返回空串），
    所以错了也只是"今天没情报"，不会有任何人知道。
  */
  const hosts = DEFAULT_INTEL_SOURCE_URLS.map((u) => new URL(u).host);
  assert.ok(hosts.includes('www.cncn.gov.cn'), '苍南县政府（www.cncn.gov.cn）不在清单里');
  assert.ok(hosts.includes('www.zjpy.gov.cn'), '平阳县政府（www.zjpy.gov.cn）不在清单里');
  assert.ok(hosts.includes('www.zjlg.gov.cn'), '龙港市政府（www.zjlg.gov.cn）不在清单里');
});

test('要覆盖「认证规则」和「招标」两类源 —— 少了哪类，情报雷达就偏科', () => {
  /*
    对一家做体系认证咨询的公司，情报只有两种真正值钱：
    规则变了（认监委/CNAS），和 有人要买（招标公告里写「须具备 ISO9001」）。
    只剩政府要闻的话，抓回来全是领导活动，看着满满当当，一条商机也没有。
  */
  const hosts = DEFAULT_INTEL_SOURCE_URLS.map((u) => new URL(u).host);
  assert.ok(
    hosts.some((h) => h.includes('cnca') || h.includes('cnas')),
    '认证规则类的源（认监委 / CNAS）一个都没有'
  );
  assert.ok(
    hosts.some((h) => h.includes('ggzy') || h.includes('ccgp')),
    '招标采购类的源（公共资源交易 / 政府采购网）一个都没有'
  );
});

test('面板没填时要落到默认清单上，不能落到空数组', () => {
  assert.match(
    appSrc,
    /cfg\.sourceUrls\?\.length \? cfg\.sourceUrls : DEFAULT_INTEL_SOURCE_URLS/,
    '抓取时没有回落到默认清单 —— 面板没填过就又变成「一个源都没有」'
  );
  assert.ok(
    !/sourceUrls:\s*cfg\.sourceUrls \|\| \[\]/.test(appSrc),
    '/api/intel/config 又把 sourceUrls 默认成空数组了'
  );
});

test('空壳页要被判为「没抓到」，60 字的门槛拦不住它', () => {
  assert.ok(
    MIN_SOURCE_TEXT >= 300,
    `门槛是 ${MIN_SOURCE_TEXT} 字。实测只有导航栏的空壳页能抓到 91 字，门槛低于它等于没有门槛`
  );
  assert.ok(
    !/text\.length >= 60/.test(appSrc),
    '源码里还留着 60 字的门槛'
  );
});

test('抓不到时要说清是哪几个源没抓到', () => {
  /*
    以前一律是「没有提取到可用行业情报，请缩小范围后重试」，
    而真因往往是某个源改版了 —— 缩多少次范围都没用。
  */
  assert.match(appSrc, /sourceReport/, '没有把每个源的抓取结果带出来');
  assert.match(appSrc, /deadSources/, '没有挑出抓空的源');
  assert.ok(
    !/'本次联网检索没有提取到可用行业情报（已执行时效过滤），请缩小范围后重试。'/.test(appSrc),
    '还在用那句「请缩小范围后重试」—— 它把人引向错误的方向'
  );
});

test('AI 提取超时要说是超时，不许说成「没有可用情报」', () => {
  /*
    生产实跑发现的：11 个源全部抓到正文，AI 一条没提出来，整个请求 15.5 秒 ——
    正好卡在 INTEL_LLM_TIMEOUT_MS 的 15000ms 上。
    而返回给用户的是「没有提取到可用行业情报，请缩小范围后重试」。
    人照着做（缩范围）不会有任何改善，因为根本不是范围的问题。
  */
  assert.ok(
    !/INTEL_LLM_TIMEOUT_MS \|\| 15000/.test(appSrc),
    'AI 提取还是只给 15 秒 —— 实测这一步就要十几秒，等于稳定超时'
  );
  assert.match(appSrc, /reasonText/, '超时/空结果的真实原因没有往上传');
  assert.match(
    appSrc,
    /reason: 'llm-timeout',\s*sourceReport,/,
    '超时分支没有把每个源的抓取结果一起带出来 —— 会让人以为是源坏了'
  );
});

test('服务端的角色表要和菜单权限对得上 —— 否则看得见、点不动', () => {
  /*
    金恩来要求情报雷达只对 系统管理员/销售/总经理/总助 开放。
    菜单那份（constants.ts 的 NAV_INTEL）和这份必须一起动。
    只改一处的症状是 403，而 403 在界面上长得像「功能坏了」。
  */
  const constants = fs.readFileSync(path.join(root, 'constants.ts'), 'utf8');
  const navIntelRoles = constants
    .split('\n')
    .filter((line) => line.includes('NAV_INTEL'))
    .map((line) => line.trim().split(':')[0].trim());

  assert.deepEqual(
    navIntelRoles.sort(),
    ['ADMIN', 'MANAGER', 'SALES', 'SYS_ADMIN'].sort(),
    '菜单里能看见情报雷达的角色变了，服务端那份也要跟着改'
  );

  assert.match(
    appSrc,
    /const INTEL_VIEW_ROLES = \[[^\]]*'SYS_ADMIN'[^\]]*\]/,
    '服务端的抓取角色表里没有 SYS_ADMIN —— 系统管理员会看得见菜单、点抓取 403'
  );
  assert.match(
    appSrc,
    /const INTEL_VIEW_ROLES = \[[^\]]*'SALES'[^\]]*\]/,
    '服务端的抓取角色表里没有 SALES —— 销售会看得见菜单、点抓取 403'
  );
  assert.ok(
    !/requireSessionRoles\(\['ADMIN', 'MANAGER'\], 'INTEL_/.test(appSrc),
    '还有情报接口写死成只给 ADMIN/MANAGER'
  );
});

test('改情报源是公司级设置，不开给销售', () => {
  /*
    看和抓可以开给销售，改源不行：
    一个销售把清单改成自己关心的几个网站，全公司的情报就跟着偏了。
  */
  const m = appSrc.match(/const INTEL_CONFIG_ROLES = \[([^\]]*)\]/);
  assert.ok(m, '找不到 INTEL_CONFIG_ROLES');
  assert.ok(!m[1].includes('SALES'), '改情报源开给销售了');
});

test('情报提取不能用思考模型 —— 它跑不完', () => {
  /*
    生产实跑量过（2 个源的小样本）：
      deepseek-v4-flash  10.2s，reasoning 3055 字
      deepseek-chat       2.3s，reasoning 0 字，输出质量一样
    真实请求要喂 11 个源要 20 条结果，v4-flash 连 45 秒都跑不完。

    这行原来的注释写着「思考模型太慢」—— 意思是对的，模型选错了。
    所以这条不是钉住某个模型名，是钉住「别再选回思考模型」。
  */
  const THINKING_MODELS = ['deepseek-v4-flash', 'deepseek-reasoner', 'kimi-k2-thinking'];
  const m = appSrc.match(/INTEL_LLM_MODEL \|\| '([^']+)'/);
  assert.ok(m, '找不到情报提取用的默认模型');
  assert.ok(
    !THINKING_MODELS.includes(m[1]),
    `情报提取用了思考模型 ${m[1]} —— 实测跑不完，结果永远是空`
  );
});
