// 直接看真实 DOM：那一行的 grid 到底有几个格子、各自装了谁。
const { chromium } = require('@playwright/test');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const W = Number(process.env.W || 1440);
  const p = await b.newPage({ viewport: { width: W, height: 900 } });
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

  const info = await p.evaluate(() => {
    const labs = [...document.querySelectorAll('form label')];
    const find = (re) => labs.filter(l => re.test(l.textContent || ''));
    const custAll = find(/关联客户/), svcAll = find(/服务项目/);
    const desc = (l) => {
      const r = l.getBoundingClientRect();
      return { text: (l.textContent||'').trim().slice(0,20), top: Math.round(r.top), left: Math.round(r.left) };
    };
    // 找包着「关联客户」的那个 grid 容器，列出它的直接子元素
    const cust = custAll[0];
    let grid = cust;
    while (grid && !/grid-cols/.test(grid.className || '')) grid = grid.parentElement;
    const kids = grid ? [...grid.children].map(k => {
      const r = k.getBoundingClientRect();
      return {
        文字: (k.textContent || '').replace(/\s+/g,'').slice(0, 18) || '(空)',
        宽: Math.round(r.width), 高: Math.round(r.height),
        top: Math.round(r.top), left: Math.round(r.left)
      };
    }) : [];
    return {
      关联客户标签数: custAll.length, 服务项目标签数: svcAll.length,
      关联客户: custAll.map(desc), 服务项目: svcAll.map(desc),
      grid类名: grid ? grid.className : '(没找到)',
      grid子元素: kids
    };
  });
  console.log('宽度', W, '→', JSON.stringify(info.grid子元素));
  await p.screenshot({ path: `.artifacts/grid-${W}.png` });
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
