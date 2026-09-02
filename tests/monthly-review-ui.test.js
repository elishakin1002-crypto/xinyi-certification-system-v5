// 月度经营判断的前端部分。
//
// 后端快照早就写好了（server/services/monthlyReview.js，6 条测试守着），
// **但页面上一直没接**——算好的东西没人看得见，等于没做。
// 这批用例分两类：① 收拾模型返回值的纯逻辑 ② 页面是不是真的接上了。
//
// 第 ② 类不是形式主义：知识检索模块曾经写好放了三个月没接线，
// AI 一直在用无关文档回答，没有任何报错。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

/** 去掉注释再扫代码——被自己写的注释骗过四次了 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const loadNormalize = () => {
  const src = read('src/modules/review/normalize.ts');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
};

test('没有数字依据的建议必须被丢掉', () => {
  /*
    提示词里写了「每条建议必须指回具体数字」，但**提示词只是请求，不是保证**。
    模型照样会返回「加强客户维护」这种条目，而它和有依据的条目长得一模一样。
    只要有一条是编的，另外两条老板也不会再信——所以宁可只剩一条。
  */
  const { normalizeJudgement } = loadNormalize();
  const r = normalizeJudgement({
    period: '2026-08',
    actions: [
      { title: '催回逾期最久的三笔', why: '逾期回款 5 笔共 8.6 万，最久一笔 422 天', firstStep: '本周打电话', urgency: 'high' },
      { title: '加强客户维护', firstStep: '多联系', urgency: 'medium' },       // 没有 why
      { title: '', why: '有依据但没标题', urgency: 'low' },                     // 没有 title
    ],
  });
  assert.equal(r.actions.length, 1, '没有依据的条目没被丢掉');
  assert.equal(r.actions[0].title, '催回逾期最久的三笔');
  assert.equal(r.droppedCount, 2, '丢掉的条数要报出来');
});

test('丢掉多少条必须显示出来，不能静默吞掉', () => {
  // 静默丢弃会让人以为模型只给了这么多，从而误判「数据不够」
  const { normalizeJudgement } = loadNormalize();
  const r = normalizeJudgement({ actions: [{ title: 'A' }, { title: 'B' }] });
  assert.equal(r.actions.length, 0);
  assert.equal(r.droppedCount, 2);
});

test('超过三条的部分丢掉——凑数的建议比不给更浪费注意力', () => {
  const { normalizeJudgement } = loadNormalize();
  const five = Array.from({ length: 5 }, (_, i) => ({ title: `第${i}条`, why: `依据${i}` }));
  const r = normalizeJudgement({ actions: five });
  assert.equal(r.actions.length, 3, '没有卡住三条上限');
  assert.equal(r.droppedCount, 2);
});

test('模型返回垃圾时不能炸，要给出空结果', () => {
  const { normalizeJudgement } = loadNormalize();
  for (const junk of [null, undefined, {}, { actions: '不是数组' }, { actions: [null, 3] }]) {
    const r = normalizeJudgement(junk, '2026-08');
    assert.equal(r.actions.length, 0);
    assert.equal(r.period, '2026-08', '拿不到 period 时要用兜底值');
    assert.ok(Array.isArray(r.cannotJudge));
  }
});

test('连续零签约的月数要能算出来', () => {
  /*
    单看柱状图，连着几个月为零并不显眼——柱子没有就是一片空白，眼睛会略过。
    实测信义的数据：2025-12、2026-01 连续两个月零签约，
    2026-03 之后连续六个月零签约。这恰恰是最该被看见的信号。
  */
  const { longestZeroStreak } = loadNormalize();
  assert.equal(longestZeroStreak([{ deals: 3 }, { deals: 0 }, { deals: 0 }, { deals: 1 }, { deals: 0 }]), 2);
  assert.equal(longestZeroStreak([{ deals: 1 }, { deals: 2 }]), 0);
  assert.equal(longestZeroStreak([{ deals: 0 }, { deals: 0 }, { deals: 0 }]), 3);
  assert.equal(longestZeroStreak([]), 0, '空数组不能炸');
});

test('战略页真的接了这个组件，不是白写一个模块', () => {
  const src = stripComments(read('pages/Strategy.tsx'));
  assert.match(src, /import MonthlyReview from '\.\.\/components\/MonthlyReview'/, '没有引入组件');
  assert.match(src, /<MonthlyReview\b/, '组件没有被渲染');
});

test('默认落在经营判断，不是 SWOT', () => {
  /*
    SWOT/BCG 上线至今一次都没被用过（strategic_insight 为空、strategic_tasks 0 条）。
    把能用的东西放在默认位置是这次改动的重点——
    如果默认还是 SWOT，等于新功能藏在第二个标签页后面。
  */
  const src = stripComments(read('pages/Strategy.tsx'));
  const m = src.match(/useState<'review' \| 'analysis' \| 'execution'>\('(\w+)'\)/);
  assert.ok(m, '标签页状态的类型或初值变了');
  assert.equal(m[1], 'review', '默认标签页不是本月经营判断');
});

test('打开页面不能自动调 AI——那是一打开就花钱', () => {
  /*
    文档摘要踩过这个坑：用户点开预览就同步调 AI，点一下花一次钱还要等。
    这里 useEffect 里只能拉快照（不花钱），askAI 必须挂在按钮的 onClick 上。
  */
  const src = stripComments(read('components/MonthlyReview.tsx'));

  const effect = src.match(/useEffect\(\(\)\s*=>\s*\{[^}]*\}\s*,\s*\[load\]\)/);
  assert.ok(effect, '找不到那个只拉快照的 useEffect');
  assert.ok(!/askAI/.test(effect[0]), 'useEffect 里调了 AI——打开页面就会花钱');

  assert.match(src, /onClick=\{askAI\}/, 'AI 判断没有挂在按钮上');
});

test('每条建议的依据要显式渲染出来', () => {
  // 老板能顺着数字回去核对，才敢照着做。只显示结论等于要他凭信任
  const src = read('components/MonthlyReview.tsx');
  assert.match(src, /依据/, '没有把依据标出来');
  assert.match(src, /\{a\.why\}/, '依据字段没有被渲染');
});

test('收进战役时要把依据一起带走', () => {
  /*
    只存标题的话，过两周回头看这条战役，谁也说不清当初是哪个数字让它进来的——
    那时它和拍脑袋定的目标就没区别了。
  */
  const src = stripComments(read('pages/Strategy.tsx'));
  const fn = src.slice(src.indexOf('const adoptMonthlyAction'), src.indexOf('useEffect('));
  assert.ok(fn.length > 0, '找不到收进战役的函数');
  assert.match(fn, /impact:\s*action\.why/, '依据没有被带进战役记录');
  assert.ok(!/deadline:\s*'20\d\d-/.test(fn), '截止日写死了——写死的日期会随时间悄悄变成过期数据');
});

test('后端接口只返回事实，不含推断', () => {
  /*
    分开的好处是出了问题分得清是数据错还是模型错：
    快照可以被逐条核对，模型的话不行。
  */
  const src = read('server/app.js');
  const route = src.slice(src.indexOf("app.get('/api/review/monthly'"));
  const body = route.slice(0, route.indexOf('\n});'));
  assert.match(body, /buildSnapshot/, '没有取快照');
  assert.ok(!/generateJSON|aiService|callModel/.test(body), '接口里直接调了模型——推断该留给前端显式触发');
});
