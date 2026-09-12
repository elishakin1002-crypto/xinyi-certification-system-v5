// 合同表单的「服务项目」多选器。2026-09-12
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  let lastDialog = '';
  p.on('dialog', async d => { lastDialog = d.message(); await d.accept(); });
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  const s0 = p.getByText('跳过', { exact: true });
  if (await s0.count()) await s0.first().click().catch(() => {});
  await p.goto('http://localhost:3000/#/contracts');
  await p.waitForTimeout(1500);
  const s1 = p.getByText('跳过', { exact: true });
  if (await s1.count()) await s1.first().click().catch(() => {});

  // 新手引导的遮罩会挡住一切，先确认没有
  for (let i = 0; i < 3; i++) {
    const sk = p.getByText('跳过', { exact: true });
    if (await sk.count()) { await sk.first().click().catch(() => {}); await p.waitForTimeout(400); }
  }
  const openBtn = p.getByRole('button', { name: /录入合同/ }).first();
  if (!(await openBtn.count())) {
    console.log('页面上的按钮：', JSON.stringify((await p.locator('main button, header button').allInnerTexts()).map(t=>t.replace(/\s+/g,'')).filter(Boolean).slice(0,15)));
    await p.screenshot({ path: '.artifacts/contracts-debug.png' });
  }
  await openBtn.click();
  await p.waitForTimeout(1000);

  check(await p.getByText('点这里从标准目录选，可多选').count() > 0, '服务项目不再是自由文本框，默认留空');

  await p.getByText('点这里从标准目录选，可多选').click();
  await p.waitForTimeout(400);
  const search = p.getByPlaceholder(/iso9001/);
  check(await search.count() > 0, '打开后有搜索框');

  await search.fill('iso9001');
  await p.waitForTimeout(400);
  const hit = p.getByRole('button', { name: /ISO 9001 质量管理体系认证/ }).first();
  check(await hit.count() > 0, '打代码 iso9001 能搜到标准项');
  await hit.click();
  await p.waitForTimeout(300);

  await search.fill('14001');
  await p.waitForTimeout(400);
  const hit2 = p.getByRole('button', { name: /ISO 14001/ }).first();
  await hit2.click();
  await p.waitForTimeout(300);

  const chips = await p.locator('span[title="标准目录项"]').count();
  check(chips === 2, '能多选（两项都选上了）', `实际 ${chips} 个`);

  // 目录外的自定义项要被标成「非标准」
  await p.getByPlaceholder(/目录里没有/).fill('厂区绿化养护');
  await p.getByRole('button', { name: /加上/ }).first().click();
  await p.waitForTimeout(400);
  check(await p.getByText('· 非标准').count() > 0, '目录外的条目会标成「非标准」');

  await p.screenshot({ path: '.artifacts/service-picker.png' });
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
