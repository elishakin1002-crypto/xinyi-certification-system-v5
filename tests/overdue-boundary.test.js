// 「今天到期」不算超期。
//
// 2026-09-14 Codex 走查抓到（总助·项目管理）：
//   「刚完成立项的项目不应立即显示为"已超期"」
//
// 复现很简单：新建项目时第一个任务的 offsetDays 是 0（截止日=今天），
// 而原来的判定是 `new Date(deadline).getTime() < Date.now()` ——
// 截止日 '2026-09-14' 解析成当天 00:00:00Z，只要过了零点就小于 now。
// 于是点完「确认立项」，页面立刻出现「已超期」「有任务卡住的项目 1」。
//
// ── 为什么这类 bug 特别值得钉住 ────────────────────────────────
//
// 它不报错、不崩溃，只是把一个正常状态显示成异常。
// 人看见「已超期」会去找自己哪里做错了，找不到就开始不信这个数字 ——
// **而一个不被信任的预警，等于没有预警。**
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `taskFlow-overdue-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/taskFlow.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const { isOverdue } = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

const at = (iso) => new Date(iso).getTime();

test('今天到期 + 现在是当天下午 → 不算超期', () => {
  /*
    这条就是立项那一刻的情形：offsetDays=0，截止日就是今天。
    说好今天交，**今天下班前都不算迟**。
  */
  assert.equal(
    isOverdue({ status: 'Pending', deadline: '2026-09-14' }, at('2026-09-14T14:30:00Z')),
    false,
    '今天到期的任务被判成了已超期 —— 刚立项就报「已超期」'
  );
});

test('今天到期 + 刚过零点 → 也不算超期', () => {
  // 原来的实现在这个时刻就已经判超期了，这是最刺眼的一种
  assert.equal(
    isOverdue({ status: 'Pending', deadline: '2026-09-14' }, at('2026-09-14T00:00:01Z')),
    false
  );
});

test('昨天到期 → 算超期', () => {
  // 别矫枉过正：真超期的必须还能报出来
  assert.equal(
    isOverdue({ status: 'Pending', deadline: '2026-09-13' }, at('2026-09-14T09:00:00Z')),
    true,
    '真的超期了却没报 —— 放得太松，预警失效'
  );
});

test('明天到期 → 不算超期', () => {
  assert.equal(
    isOverdue({ status: 'Pending', deadline: '2026-09-15' }, at('2026-09-14T09:00:00Z')),
    false
  );
});

test('已完成 / 已跳过的，不管多久都不算超期', () => {
  /*
    跳过是**主动的决定**，不是欠账 —— 把它算进超期，
    等于惩罚"如实交代这一步不做"，人下次就不敢跳过了。
  */
  assert.equal(isOverdue({ status: 'Completed', deadline: '2020-01-01' }, at('2026-09-14T09:00:00Z')), false);
  assert.equal(isOverdue({ status: 'Skipped', deadline: '2020-01-01' }, at('2026-09-14T09:00:00Z')), false);
});

test('没有截止日期的不算超期 —— 没约定就没有迟到', () => {
  assert.equal(isOverdue({ status: 'Pending', deadline: '' }, at('2026-09-14T09:00:00Z')), false);
  assert.equal(isOverdue({ status: 'Pending', deadline: undefined }, at('2026-09-14T09:00:00Z')), false);
  assert.equal(isOverdue({ status: 'Pending', deadline: '不是日期' }, at('2026-09-14T09:00:00Z')), false);
});

test('带时刻的截止时间按原值比，不要顺手也推到当天结束', () => {
  /*
    「今天 10:00 前交」和「今天之内交」是两回事。
    只有"光有日期没有时刻"时才理解成"当天结束"。
  */
  assert.equal(
    isOverdue({ status: 'Pending', deadline: '2026-09-14T10:00:00Z' }, at('2026-09-14T11:00:00Z')),
    true,
    '写了具体时刻却还按"当天结束"算 —— 那个时刻就白写了'
  );
});
