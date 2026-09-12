// 客户页的证书上传也用 compact —— 别把它改坏了（原本正常的还正常）
const { chromium } = require('@playwright/test');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.goto('http://localhost:3000/#/customers');
  await p.waitForTimeout(1800);
  for (let i=0;i<2;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.locator('tbody tr').first().click();
  await p.waitForTimeout(1800);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g,' ');
  console.log(errs.length === 0 ? '✅ 客户详情没有报错' : '❌ 报错：' + errs[0]);
  console.log(/证书|上传/.test(txt) ? '✅ 客户详情正常渲染（含上传相关内容）' : '⚠️ 没看到上传相关内容');
  await p.screenshot({ path: '.artifacts/customer-detail.png' });
  await b.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
