/**
 * 「一个业务页面该有什么」—— 判据只写这一份。
 *
 * ── 为什么抽出来（2026-09-08）────────────────────────────────
 *
 * 判据原来有两份：npm run checkup 里一份，consistency-floor 测试里一份。
 * 我在脚本里把「手机端」的判据改对了（从"数 md: 个数"改成
 * "有表格就必须有窄屏替代"），**却忘了同步测试里那份** ——
 * 于是测试报「Employees 退步了，缺手机端」，而它明明刚加了手机卡片。
 *
 * 这正是这个项目最高频的一类 bug：**同一条规则存在两份副本**
 * （权限三份、persona 映射四份、任务列表三处…）。
 * 抽成一份不是洁癖，是因为**漂移一定会发生，而且发现时已经晚了**。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; }
};

/** 登录和改密码是独立于业务的入口页，不参与业务一致性体检 */
const SKIP = new Set(['Login', 'ChangePassword']);

/**
 * 明确豁免 —— **必须写理由**。
 *
 * 一张必须全绿的清单，最后一定会变成对着清单打钩：
 * 人会为了变绿去加一个没人需要的东西。
 * 所以允许「本来就不适用」，但要求把理由写下来 ——
 * 写不出理由的，就说明它其实是欠账。
 */
const EXEMPT = {
  'Dashboard:样例行': '工作台展示的是汇总数字，不是一行行的记录 —— 没有「一行」可以做样例。它的引导作用由各区块的说明文字承担。',
  'AICenter:样例行': 'AI 配置中心是开关和用量数字，同样没有「一行记录」。',
  'AICenter:新手引导': '只有系统管理员和总经理会进这一页，而这两份引导都已满六步。它的说明放在「本页详解」里，需要时点问号即可。',
  'Glossary:样例行': '字段档案整页都是解释，没有「用户的数据」这一说 —— 每一条本身就是范例，再放一条示例行只会让人以为那是假数据。',
  'Glossary:新手引导': '它本身就是帮助的一部分（从帮助中心「?」的第四项进来）。给它单独加一步引导等于教人"怎么看帮助"，而且六个角色的引导都得各加一步，纯属噪音。入口在帮助中心，那里每个角色的引导都会讲到。',
};

const routeOf = (component) => {
  const app = read('App.tsx');
  const re = new RegExp(`<${component}\\s*/>`);
  for (const frag of app.split('<Route ')) {
    if (!re.test(frag)) continue;
    const m = frag.match(/^\s*path="([^"]+)"/);
    if (m) return m[1];
  }
  return '';
};

const CHECKS = [
  { key: '空状态', has: (src) => /EmptyState/.test(src) },
  { key: '样例行', has: (src) => /SampleRow|SampleTr/.test(src) },
  { key: '本页详解', has: (_s, route) => Boolean(route) && read('src/modules/help/pageGuide.ts').includes(`path: '${route}'`) },
  { key: '新手引导', has: (_s, route) => Boolean(route) && read('src/modules/onboarding/steps.ts').includes(`route: '${route}'`) },
  {
    key: '手机端',
    /*
      这个判据改过两次，两次都是我自己走偏：
        v1「md: 出现次数 ≥ 5」→ 加了正确的手机卡片反而只用两个类名，指标照样红。
           那一刻的诱惑是"再堆几个 md: 让它变绿" —— 那就是对着清单打钩。
        v2「有分流 或 md: ≥ 8」→ 「我的任务」被判红，而它本来就是竖排列表，
           手机上天然没问题、根本不需要分流。
        v3（现在）只看真正的失败模式：**表格在手机上装不下**，
           所以有 <table> 就必须有窄屏替代；没表格的自动通过。

      教训留着：指标定得不对，它会把人推去做错的事。
    */
    has: (src) => !/<table/.test(src) || /md:hidden|hidden\s+md:/.test(src),
  },
  {
    key: '测试',
    has: (_s, _r, name) => fs.readdirSync(path.join(root, 'tests'))
      .filter((f) => f.endsWith('.test.js'))
      .some((f) => read(`tests/${f}`).includes(`pages/${name}.tsx`)),
  },
];

const listPages = () => fs.readdirSync(path.join(root, 'pages'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replace('.tsx', ''))
  .filter((n) => !SKIP.has(n));

/** 返回 { name, route, lines, results, score }，results 里的元素是 true / false / 'exempt' */
const inspect = (name) => {
  const src = read(`pages/${name}.tsx`);
  const route = routeOf(name);
  const results = CHECKS.map((c) => (EXEMPT[`${name}:${c.key}`] ? 'exempt' : Boolean(c.has(src, route, name))));
  return {
    name, route,
    lines: src.split('\n').length,
    results,
    score: results.filter((r) => r === true || r === 'exempt').length,
  };
};

module.exports = { CHECKS, EXEMPT, SKIP, listPages, inspect, read };
