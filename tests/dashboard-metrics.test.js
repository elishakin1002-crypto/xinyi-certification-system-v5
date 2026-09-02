// 工作台指标口径回归测试。
//
// ── 为什么要有这个文件 ──────────────────────────────────────────
// 2026-08-24 实测发现：销售视角的工作台**每一个指标都是 0**，
// 而同一页下方的风险列表有真实数据。根因是「这条是不是我的」原来只按姓名匹配，
// 完全不认 ownerUserId——也就是不认认领/指派机制。
// 销售认领了线索，工作台照样显示 0，归属做了等于没做。
//
// 这类 bug 有个共同特征：**不报错，只是数字变成 0**。
// 没人会怀疑一个 0，只会以为「这个月确实没干活」。所以必须用测试钉住。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/*
  dashboardMetrics 是 TypeScript，测试用 node:test 跑不了 .ts。
  用 tsc 单文件转译代价太高，这里改成**读源码做结构断言**：
  验的是「口径有没有退回姓名匹配」，不是运行时数值。
  运行时数值由 tests/role-scenarios.test.js 那套端到端场景覆盖。
*/
const fs = require('node:fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../services/dashboardMetrics.ts'), 'utf8');

test('归属判定必须优先看 ownerUserId，不能只按姓名', () => {
  assert.ok(SRC.includes('const ownedByUser'), '缺少统一的归属判定助手');
  const fn = SRC.slice(SRC.indexOf('const ownedByUser'), SRC.indexOf('const normalizeName'));
  assert.ok(/ownerUserId/.test(fn), 'ownedByUser 必须检查 ownerUserId');
  assert.ok(/owner === uid/.test(fn), '有 ownerUserId 时要以它为准，而不是继续比姓名');
});

test('销售的「我的线索」不能拿线索联系人姓名当负责人', () => {
  /*
    原来的写法：String(lead.name || '') === me
    lead.name 是**客户联系人**的姓名（周老板、陈某…），
    拿它和员工姓名比对没有任何业务含义，只会在重名时偶然命中。
  */
  assert.ok(!/String\(lead\.name \|\| ''\) === me/.test(SRC),
    '又把 lead.name（联系人姓名）当成归属在比了');
});

test('销售的线索、合同都要走统一归属判定', () => {
  const sales = SRC.slice(SRC.indexOf('const buildSalesMetrics'), SRC.indexOf('const buildConsultantMetrics'));
  assert.ok(/myLeadSet[\s\S]{0,200}ownedByUser/.test(sales), '我的线索没走 ownedByUser');
  assert.ok(/myContracts[\s\S]{0,200}ownedByUser/.test(sales), '我的合同没走 ownedByUser');
});

test('比率指标分母为 0 时显示「暂无数据」，不显示 0.0%', () => {
  /*
    本月一条新线索都没有时，转化率是**未定义**，不是 0。
    显示 0.0% 会让老板以为销售一单没转化，实际是根本没有线索进来——
    两个信号指向完全不同的处理动作。
  */
  assert.ok(SRC.includes('const rate ='), '缺少 rate 助手');
  const fn = SRC.slice(SRC.indexOf('const rate ='), SRC.indexOf('const rate =') + 260);
  assert.ok(/暂无数据/.test(fn), '分母为 0 时必须显示「暂无数据」');
  /*
    只匹配**卡片定义**（title: '…'），不能拿指标名直接 indexOf——
    上面 rate 助手的注释里就提到了「销售转化率」，
    indexOf 会先命中那段注释，测出来的结论跟代码无关。
    （今天第四次被注释骗：health-ui、绕过检测、AI 标称检查，现在轮到测试自己。）
  */
  for (const m of ['销售转化率', '项目延误率', '本周日志覆盖率']) {
    const re = new RegExp(`title: '${m}[^']*',\\s*value: (\\w+)\\(`);
    const hit = SRC.match(re);
    assert.ok(hit, `找不到卡片定义：${m}`);
    assert.equal(hit[1], 'rate', `${m} 用的是 ${hit[1]}()，分母为 0 时会显示 0.0%`);
  }
});

test('本周日志覆盖率的分子必须限定在在制项目内', () => {
  /*
    分子若不限定，会把已完结项目、乃至已删除项目的日志算进来，
    而分母是在制项目数——两者不是同一个总体。
    实测这个偏差把真实的 6.3% 显示成了 18.8%。
  */
  const i = SRC.indexOf('const weekLogProjects');
  assert.ok(i > 0);
  const block = SRC.slice(i, i + 400);
  assert.ok(/activeProjectIds\.has/.test(block),
    '分子没有和在制项目取交集，会把已完结/已删除项目的日志算进来');
});
