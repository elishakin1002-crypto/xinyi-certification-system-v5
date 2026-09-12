// 顾问能不能看到别人录的合同，以及金额有没有照旧遮住。
// 2026-09-12 金恩来：黄佳佳撞到「合同已存在」，却在自己列表里找不到那一份。
const { chromium } = require('@playwright/test');
const book = require('../.runtime/走查账号密码.json').账号;
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };

const login = async (p, who) => {
  const c = book[who];
  await p.goto('http://localhost:3000/#/');
  await p.waitForTimeout(800);
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    const sk = p.getByText('跳过', { exact: true });
    if (await sk.count()) { await sk.first().click().catch(() => {}); await p.waitForTimeout(400); }
  }
};
const gotoContracts = async (p) => {
  await p.goto('http://localhost:3000/#/contracts');
  await p.waitForTimeout(1800);
  for (let i = 0; i < 2; i++) {
    const sk = p.getByText('跳过', { exact: true });
    if (await sk.count()) { await sk.first().click().catch(() => {}); await p.waitForTimeout(400); }
  }
};

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });

  await login(p, '咨询顾问 黄佳佳');
  await gotoContracts(p);

  check(await p.getByRole('button', { name: '全公司', exact: true }).count() > 0,
    '顾问也有「范围」开关（原来根本没有）');

  const relatedRows = await p.locator('tbody tr').count();
  await p.getByRole('button', { name: '全公司', exact: true }).click();
  await p.waitForTimeout(1000);
  const allRows = await p.locator('tbody tr').count();
  check(allRows > relatedRows, '切到「全公司」能看到别人录的合同', `与我相关 ${relatedRows} 行 → 全公司 ${allRows} 行`);

  const txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
  check(/¥ \*\*\*/.test(txt), '金额照旧对顾问遮住（¥ ***）');
  check(!/¥\s?[0-9][0-9,]{2,}/.test(txt), '没有漏出任何真实金额',
    (txt.match(/¥\s?[0-9][0-9,]{2,}/g) || []).slice(0, 3).join(' '));

  await p.screenshot({ path: '.artifacts/contract-scope.png' });

  // 财务应当照旧看得到金额 —— 别把原本正常的改坏了。
  // 换一个干净的浏览器上下文，别在同一个会话里清 localStorage（清不干净，
  // 页面会停在已登录状态，然后找不到登录框 —— 上一版就是这么超时的）
  const ctx2 = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p2 = await ctx2.newPage();
  await login(p2, '财务 金小雁');
  await gotoContracts(p2);
  const ftxt = (await p2.locator('main').innerText()).replace(/\s+/g, ' ');
  console.log('财务看到的金额片段：', (ftxt.match(/¥\s?[0-9][0-9,]*/g) || []).slice(0, 5).join(' · ') || '(一个都没有)');
  console.log('财务页面里有没有 ¥ ***：', /¥ \*\*\*/.test(ftxt));
  check(/¥\s?[0-9]/.test(ftxt), '财务照旧看得到真实金额');

  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
