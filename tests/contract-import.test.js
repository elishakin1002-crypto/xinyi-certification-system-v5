// 历史合同批量导入。
//
// 核心约束只有一条：**历史合同不建项目。**
// 历史合同是已经做完的事，顺手建项目会在项目列表里凭空多出几百个
// 「进行中」的僵尸项目，把在制项目数、派活看板、项目延误率全部污染 ——
// 而这些数字正是用来判断「现在忙不忙」的。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

const load = () => {
  const src = read('src/modules/contractImport.ts');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', js)(mod.exports, mod, () => ({}));
  return mod.exports;
};

test('历史合同不建项目 —— 而且不是靠勾选框', () => {
  /*
    新建合同表单默认勾着「同时创建交付项目」，那对新签合同是对的。
    但靠人记得每次去取消那个勾不行：几百条里漏一次就要手工清理。
    所以这条路在代码层面就没有建项目的可能。
  */
  const src = read('pages/Contracts.tsx');
  const fn = src.slice(src.indexOf('const runImport = async'), src.indexOf('const runImport = async') + 1600);
  assert.match(fn, /\}, false\);\s*\/\/ ← 第二个参数 false：历史合同不建项目/,
    '导入时没有显式关掉建项目');
  assert.doesNotMatch(fn, /createProject/,
    '导入路径里出现了 createProject —— 它不该有这个选项');
});

test('缺关键字段的行报错，绝不当成 0 或今天', () => {
  /*
    一条金额为 0 的合同混进台账，比一条导入失败的记录危险得多：
    前者会安静地把统计做错，后者只是让人回去改一行。
  */
  const { buildImportPlan } = load();
  const plan = buildImportPlan([
    { 客户名称: '甲公司', 合同金额: 12000, 签订日期: '2024-03-05' },
    { 客户名称: '', 合同金额: 5000, 签订日期: '2024-03-06' },
    { 客户名称: '乙公司', 合同金额: '看合同', 签订日期: '2024-03-07' },
    { 客户名称: '丙公司', 合同金额: 8000, 签订日期: '' },
  ], []);

  assert.equal(plan.ready.length, 1);
  assert.equal(plan.problems.length, 3);
  assert.match(plan.problems[0].reason, /客户名称/);
  assert.match(plan.problems[1].reason, /合同金额/);
  assert.match(plan.problems[2].reason, /签订日期/);
  // 报错要指得回原文件的那一行
  assert.deepEqual(plan.problems.map(p => p.rowNo), [3, 4, 5]);
});

test('列名换个叫法也认', () => {
  /*
    同事导出的表格来自老系统、财务台账、手工整理，列名不可能统一。
    要求他们改表头是最容易失败的一步 —— 改错了还以为是系统坏了。

    注意：一份表格只有一行表头，所以这里分两份文件测，
    而不是把两套叫法塞进同一份 —— 那种文件现实里不存在。
  */
  const { buildImportPlan } = load();

  const a = buildImportPlan([
    { 客户: '甲公司', 金额: 12000, 签约日期: '2024/3/5', 合同号: 'HT-001' },
  ], []);
  assert.equal(a.ready.length, 1, `没认出别名：${JSON.stringify(a.problems)}`);
  assert.equal(a.ready[0].contractNo, 'HT-001');
  assert.equal(a.ready[0].signDate, '2024-03-05');

  const b = buildImportPlan([
    { 企业名称: '乙公司', '合同金额（元）': '¥8,500.00', 签订时间: '2024年3月8日' },
  ], []);
  assert.equal(b.ready.length, 1, `没认出别名：${JSON.stringify(b.problems)}`);
  assert.equal(b.ready[0].amount, 8500);
  assert.equal(b.ready[0].signDate, '2024-03-08');
});

test('第一行某格是空的，也不能把整列弄丢', () => {
  /*
    sheet_to_json 对空单元格是直接不给这个 key 的。
    表头只从第一行取的话，第一行恰好没填合同编号，
    那一列就从表头里消失 —— 整份文件的编号全被忽略、
    判重退化成模糊匹配，而这一切不会有任何报错。
  */
  const { buildImportPlan } = load();
  const plan = buildImportPlan([
    { 客户名称: '甲公司', 合同金额: 1000, 签订日期: '2024-01-01' },              // 没填编号
    { 客户名称: '乙公司', 合同金额: 2000, 签订日期: '2024-01-02', 合同编号: 'HT-9' },
  ], []);
  assert.equal(plan.ready.length, 2);
  assert.equal(plan.ready[1].contractNo, 'HT-9', '第二行的合同编号被丢了');
});

test('Excel 的日期序列号要换算，不能当字符串用', () => {
  /*
    Excel 里日期常常是从 1900 起算的序列号（比如 45000）。
    直接当字符串用会写进一个 1970 年的日期，而且没人会发现。
  */
  const { parseDate } = load();
  assert.equal(parseDate(45000), '2023-03-15');
  assert.equal(parseDate('2024-03-05'), '2024-03-05');
  assert.equal(parseDate('2024/3/5'), '2024-03-05');
  assert.equal(parseDate(''), '');
});

test('判重：有编号按编号，没编号按客户+金额+日期', () => {
  /*
    历史台账里没有合同编号的行不少。完全不判重的话，
    同一份表格导两次就会出现两套一模一样的合同 ——
    而这种重复在金额统计上是直接翻倍的。
  */
  const { buildImportPlan } = load();
  const existing = [
    { contractNo: 'HT-001', customerName: '甲公司', amount: 12000, signDate: '2024-03-05' },
    { contractNo: '', customerName: '乙公司', amount: 8000, signDate: '2024-04-01' },
  ];
  const plan = buildImportPlan([
    { 合同编号: 'HT-001', 客户名称: '甲公司（改过名）', 合同金额: 99999, 签订日期: '2024-03-05' },
    { 客户名称: '乙公司', 合同金额: 8000, 签订日期: '2024-04-01' },
    { 客户名称: '丙公司', 合同金额: 3000, 签订日期: '2024-05-01' },
  ], existing);

  assert.equal(plan.duplicates.length, 2);
  assert.equal(plan.ready.length, 1);
  assert.equal(plan.ready[0].customerName, '丙公司');
});

test('同一个文件里自己重复也要挡住', () => {
  const { buildImportPlan } = load();
  const plan = buildImportPlan([
    { 客户名称: '甲公司', 合同金额: 1000, 签订日期: '2024-01-01' },
    { 客户名称: '甲公司', 合同金额: 1000, 签订日期: '2024-01-01' },
  ], []);
  assert.equal(plan.ready.length, 1);
  assert.equal(plan.duplicates.length, 1);
});

test('导入前要先给人看清楚，不是点完才知道', () => {
  /*
    几百条的操作，撤销的成本远高于确认的成本：
    导错了要一条条删，而多看一眼只花三秒。
  */
  const src = read('pages/Contracts.tsx');
  assert.match(src, /可以导入/, '没有显示能导多少条');
  assert.match(src, /重复，跳过/, '没有显示跳过多少条');
  assert.match(src, /读不出来/, '没有显示有问题的行数');
  assert.match(src, /第 \{x\.rowNo\} 行 · \{x\.label\}/,
    '有问题的行没有列出行号和客户名 —— 只说「3 行有问题」等于没说');
  assert.match(src, /这些合同不会生成合同项目/, '没有把「不建项目」写给用户看');
});

test('导入的合同带标记，事后能挑出来', () => {
  const { HISTORY_IMPORT_TAG } = load();
  assert.equal(HISTORY_IMPORT_TAG, '【历史导入】');
  assert.match(read('pages/Contracts.tsx'), /HISTORY_IMPORT_TAG, row\.remarks/,
    '导入的合同没打标记');
});
