// 财务口径：应收和实收分开，两个「回款率」各答一个问题。
//
// ── 为什么（2026-09-18）────────────────────────────────────────
//
// 金恩来：「写着本月已收，实际上算的是上月的应收款，容易让人误解。」
// 又：「我不专业，不懂财务，你要以成熟先进的做法为参考。」
//
// 财务上有标准答案，两套记账基础：
//   权责发生制 按**应收到期日**归月 → 本月应收（看账龄催收）
//   收付实现制 按**实际到账日**归月 → 本月实收（看现金流）
// 改之前写的是「已收 && 到期日在本月」——**两个都不是**，
// 八月到期九月才收到的钱记在八月，财务拿它对银行流水永远对不上。
//
// 而「回款率」行业里也是两个指标：
//   合同回款率 = 已收 ÷ 合同总额     → 这单收了多少（进度）
//   期间回款率 = 已收 ÷ 已到期应收   → 该收的收上来没有（催收效果）
// 只看前者会误判：昨天刚签的合同 0% 是正常的，钱还没到期。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const build = (rel, name) => {
  const out = path.join(os.tmpdir(), `${name}-${process.pid}.cjs`);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'),
    [path.join(root, rel), '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`], { stdio: 'pipe' });
  return { mod: require(out), out };
};
const cb = build('src/modules/cashBasis.ts', 'cb');
const glo = build('src/modules/glossary.ts', 'glo');
test.after(() => { for (const f of [cb.out, glo.out]) { try { fs.unlinkSync(f); } catch {} } });

const 合同 = (amount, rs) => ({ amount, receivables: rs });

test('本月实收按**到账日**算，不是按到期日', () => {
  /*
    八月到期、九月收到的钱，应该记在九月。
    改之前记在八月 —— 八月账上并没有进这笔钱。
  */
  const cs = [合同(10000, [
    { amount: 6000, status: 'paid', dueDate: '2026-08-20', paidAt: '2026-09-03' },
    { amount: 4000, status: 'paid', dueDate: '2026-09-10', paidAt: '2026-09-10' },
  ])];
  assert.equal(cb.mod.receivedInMonth(cs, '2026-09'), 10000, '九月真进了 10000');
  assert.equal(cb.mod.receivedInMonth(cs, '2026-08'), 0, '八月一分没进 —— 那笔是九月才到账的');
  assert.equal(cb.mod.dueAndReceivedInMonth(cs, '2026-08'), 6000, '按到期月算是另一个问题，也要能算');
});

test('没记到账日的不硬塞进任何一个月，但要能数出来有几笔', () => {
  /*
    2026-09-18 之前的数据没有 paidAt。猜成到期日就是在重犯原来的错。
    所以它们不进任何一个月，界面单独提示有几笔 ——
    让人知道这个数字缺了什么，而不是给一个看起来完整的金额。
  */
  const cs = [合同(5000, [{ amount: 5000, status: 'paid', dueDate: '2026-08-01' }])];
  assert.equal(cb.mod.receivedInMonth(cs, '2026-08'), 0);
  assert.equal(cb.mod.receivedInMonth(cs, '2026-09'), 0);
  assert.equal(cb.mod.paidWithoutPaidAt(cs), 1, '数不出来的话界面就没法提示');
});

test('回款率的分母是合同总额，计划没录全要暴露出来', () => {
  // 合同 10 万，只录了 6 万的回款节点，收到 6 万
  const cs = [合同(100000, [{ amount: 60000, status: 'paid', dueDate: '2026-08-01', paidAt: '2026-08-01' }])];
  const r = cb.mod.collectionProgress(cs);
  assert.equal(r.rate, 0.6, '拿计划总额当分母会算成 100% —— 那 4 万就没人跟了');
  assert.equal(r.planGap, 40000, '缺口要能算出来，界面才提示得了');
  assert.equal(cb.mod.collectionProgress([]).rate, null, '没有合同时返回 null，不返回 0（0 会被当成"一分没收"）');
});

test('催收率只看已到期的 —— 刚签的合同不该显得像催收出了问题', () => {
  const 今天 = '2026-09-18';
  const cs = [合同(100000, [
    { amount: 30000, status: 'paid', dueDate: '2026-08-01', paidAt: '2026-08-05' },
    { amount: 30000, status: 'unpaid', dueDate: '2026-09-01' },   // 到期没收
    { amount: 40000, status: 'unpaid', dueDate: '2026-12-01' },   // 还没到期
  ])];
  const r = cb.mod.collectionOnDue(cs, 今天);
  assert.equal(r.due, 60000, '未到期的 4 万不该进分母');
  assert.equal(r.received, 30000);
  assert.equal(r.overdue, 30000, '这个数才是催收要盯的');
  assert.equal(r.rate, 0.5);

  // 全部未到期时返回 null —— 不能显示 0%（像催收失败）也不能显示 100%（像全收齐了）
  const 新签 = [合同(50000, [{ amount: 50000, status: 'unpaid', dueDate: '2026-12-01' }])];
  assert.equal(cb.mod.collectionOnDue(新签, 今天).rate, null);
});

test('「已到期」和「逾期」必须用同一条规矩：截止日当天不算迟到', () => {
  /*
    这个系统早就定过这条，而且两处都在用（任务的 isOverdue、
    应收的 isReceivableOverdue）。第一版我写成 `<=`，
    于是今天刚到期的钱当场被算成"该收没收到" ——
    同一个系统里两套迟到标准，财务会问"今天到期的凭什么算我没收"。
  */
  const 今天 = '2026-09-18';
  const 今天到期 = [合同(10000, [{ amount: 10000, status: 'unpaid', dueDate: 今天 }])];
  assert.equal(cb.mod.collectionOnDue(今天到期, 今天).due, 0,
    '今天到期的不该进「已到期」—— 和 isReceivableOverdue 的规矩对齐');
  assert.equal(glo.mod.isReceivableOverdue({ status: 'unpaid', dueDate: 今天 }, 今天), false,
    '两处规矩必须一致，否则同一笔钱在两张卡上一个算迟到一个不算');

  const 昨天到期 = [合同(10000, [{ amount: 10000, status: 'unpaid', dueDate: '2026-09-17' }])];
  assert.equal(cb.mod.collectionOnDue(昨天到期, 今天).due, 10000);
  assert.equal(glo.mod.isReceivableOverdue({ status: 'unpaid', dueDate: '2026-09-17' }, 今天), true);
});

test('没填到期日的不算逾期 —— 没约定就没有迟到', () => {
  const cs = [合同(10000, [{ amount: 10000, status: 'unpaid', dueDate: '' }])];
  assert.equal(cb.mod.collectionOnDue(cs, '2026-09-18').due, 0,
    '空字符串在字符串比较里永远小于任何日期 —— 这个坑踩过，别再踩');
});
