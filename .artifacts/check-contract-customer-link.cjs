// 合同必须落到客户身上 + 当场建客户 + 「用过」的服务名能再选。
const { chromium } = require('@playwright/test');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  let dlg = '';
  p.on('dialog', async d => { dlg = d.message(); await d.accept(); });
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.goto('http://localhost:3000/#/contracts');
  await p.waitForTimeout(1600);
  for (let i=0;i<2;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }

  await p.getByRole('button', { name: /录入合同/ }).first().click();
  await p.waitForTimeout(900);

  // 默认不再是「不绑定」
  const sel = p.locator('select').filter({ has: p.locator('option:text-matches("选一家客户")') }).first();
  check(await sel.count() > 0, '下拉默认变成「— 选一家客户 —」，不再是「不绑定」');
  check(await sel.inputValue() === '', '默认没有预选任何客户');

  // 建客户的口子在
  check(await p.getByText('+ 找不到？直接新建客户').count() > 0, '合同弹窗里有「直接新建客户」入口');

  // 不选客户直接提交要被拦
  await p.locator('input[required]').first().fill('关联校验测试合同');
  // 金额和日期是 required，不填的话浏览器原生校验先拦下，根本走不到我的判断
  // 把所有原生 required 都填上，否则浏览器先拦下，走不到我写的校验
  for (const inp of await p.locator('form input[required]').all()) {
    const t = await inp.getAttribute('type');
    if (t === 'number') await inp.fill('10000').catch(() => {});
    else if (t === 'date') await inp.fill('2026-09-12').catch(() => {});
    else if (!(await inp.inputValue())) await inp.fill('关联校验测试合同').catch(() => {});
  }
  const submit = p.getByRole('button', { name: /确认录入/ }).first();
  await submit.click();
  await p.waitForTimeout(900);
  console.log('   弹窗内容：', (dlg || '(没有弹窗，可能被原生校验拦了)').split('\n')[0]);
  check(/服务项目|落到某一家客户/.test(dlg), '缺服务项目或客户时会被拦下');

  // 当场建客户
  await p.getByText('+ 找不到？直接新建客户').click();
  await p.waitForTimeout(400);
  await p.getByPlaceholder(/营业执照全称/).fill('关联校验测试厂');
  await p.getByRole('button', { name: '创建并选中' }).click();
  await p.waitForTimeout(900);
  const pageTxt = (await p.locator('main, form').first().innerText().catch(() => '')).replace(/\s+/g,' ');
  console.log('   提示区文字：', (pageTxt.match(/(已新建客户|客户档案里已经有)[^。]*。/) || ['(没找到)'])[0]);
  const notice = await p.getByText(/已新建客户|客户档案里已经有/).count();
  check(notice > 0, '建完会说一句结果（新建了 还是 复用了已有的）');
  check(await sel.inputValue() !== '', '新建的客户被自动选中');

  await p.screenshot({ path: '.artifacts/contract-customer-link.png' });
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
