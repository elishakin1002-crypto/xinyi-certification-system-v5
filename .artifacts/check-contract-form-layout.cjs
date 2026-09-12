// 合同弹窗的尺寸与下拉可见性。2026-09-12 金恩来：
// 「合同录入区域是不是搞的太大了，下面服务项目的下拉框常常显示不全，要拖到下面」
const { chromium } = require('@playwright/test');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };
(async () => {
  const H = Number(process.env.H || 900);
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: H } });
  p.on('dialog', d => d.accept());
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

  // 上传区高度
  // 量真正的上传控件本身（带 border-dashed 的那个），别顺着 parentElement 乱爬 ——
  // 上一版爬了 4 层量到整个弹窗，报出 718px，差点让我以为没改生效
  const upH = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, div'))
      .find(n => /border-dashed/.test(n.className || '') && /上传合同文件/.test(n.textContent || ''));
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  });
  check(upH > 0 && upH < 90, `上传区收窄了（原来约 180px）`, `实测 ${upH}px`);

  // 「客户名称」这个重复输入框没了
  const dupInputs = await p.locator('label:text-is("客户名称")').count();
  check(dupInputs === 0, '「客户名称」不再是第二个要填的框');

  // 服务项目下拉：打开后必须整块在视口内
  const field = p.getByText('点这里从标准目录选，可多选');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await p.waitForTimeout(600);
  const box = await p.locator('input[placeholder*="iso9001"]').first().evaluate(el => {
    const panel = el.closest('div.absolute') || el.parentElement.parentElement;
    const r = panel.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight };
  });
  const fullyVisible = box.top >= 0 && box.bottom <= box.vh;
  check(fullyVisible, `下拉整块都在屏幕内，不用再往下拖`,
    `面板 ${box.top}~${box.bottom}，视口高 ${box.vh}`);

  await p.screenshot({ path: `.artifacts/contract-form-${H}.png` });
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
