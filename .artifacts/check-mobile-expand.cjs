// 手机/中屏：展开项目详情后，点详情里的东西不许把它折叠掉。
// 2026-09-12 金恩来：「点击添加服务项目或者服务流水，都会自动弹出到上一级界面」
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };

(async () => {
  const W = Number(process.env.W || 750);
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: W, height: 1000 } });
  p.on('dialog', d => d.dismiss());
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  const s0 = p.getByText('跳过', { exact: true });
  if (await s0.count()) await s0.first().click().catch(() => {});
  await p.goto('http://localhost:3000/#/projects');
  await p.waitForTimeout(1500);
  const s1 = p.getByText('跳过', { exact: true });
  if (await s1.count()) await s1.first().click().catch(() => {});
  await p.waitForTimeout(500);

  // 展开第一个项目
  const card = p.locator('div').filter({ hasText: /^负责人: / }).first();
  const head = p.getByText(/^负责人: /).first();
  await head.click();
  await p.waitForTimeout(1200);

  const detailOpen = async () => p.getByText('服务项 · 客户买了什么').count();
  check(await detailOpen() > 0, `${W}px｜点摘要能展开详情`);

  // 详情里的东西点一下，详情必须还在
  const probes = [
    ['添加服务项按钮', p.getByRole('button', { name: /添加服务项/ }).first()],
    ['「任务·要做哪些事」标题', p.getByText('任务 · 要做哪些事').first()],
    ['模板管理按钮', p.getByRole('button', { name: /模板管理/ }).first()],
  ];
  for (const [label, loc] of probes) {
    if (!(await loc.count())) { console.log(`⏭  ${label} 这个项目里没有，跳过`); continue; }
    await loc.click({ trial: false }).catch(() => {});
    await p.waitForTimeout(700);
    const still = await detailOpen() > 0;
    check(still, `${W}px｜点「${label}」之后详情还开着`, still ? '' : '被折叠回列表了');
    if (!still) { await head.click(); await p.waitForTimeout(900); }   // 重新展开再测下一个
  }

  await p.screenshot({ path: `.artifacts/mobile-expand-${W}.png` });
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
