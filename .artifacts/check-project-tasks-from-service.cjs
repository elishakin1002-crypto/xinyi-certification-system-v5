// 建项目时选了服务类型 → 任务要来自那个大类的流程；没选 → 不许瞎生成。
// 2026-09-12 金恩来：「只写了个名字，直接就生成了 5 张类似体系相关的任务卡片」
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  const s0 = p.getByText('跳过', { exact: true });
  if (await s0.count()) await s0.first().click().catch(() => {});

  const make = async (name, group) => {
    await p.goto('http://localhost:3000/#/projects');
    await p.waitForTimeout(1200);
    const s = p.getByText('跳过', { exact: true });
    if (await s.count()) await s.first().click().catch(() => {});
    await p.getByRole('button', { name: '新建项目', exact: true }).click();
    await p.getByPlaceholder('例如：某某工厂ISO认证咨询').fill(name);
    if (group) await p.selectOption(`select:has(option:text-is("${group}"))`, group);
    await p.getByRole('radio', { name: /不涉及客户/ }).check();
    await p.getByRole('button', { name: '确认立项', exact: true }).click();
    await p.waitForTimeout(2000);
    // 展开它，读任务标题
    const row = p.locator('tr', { hasText: name }).first();
    await row.click();
    await p.waitForTimeout(1800);
    const txt = await p.locator('main').innerText();
    return txt.replace(/\s+/g, ' ');
  };

  const a = await make(`走查-体系-${Date.now() % 10000}`, '体系认证');
  check(/需求确认与资料清单/.test(a), 'A｜选了「体系认证」→ 生成的是体系认证流程',
    (a.match(/需求确认与资料清单|资料收集与现场辅导|文件编制与完善/g) || []).join('、'));

  const c = await make(`走查-工商-${Date.now() % 10000}`, '工商代理');
  check(!/内审\/管评|认证审核配合|取证确认/.test(c),
    'C｜选了「工商代理」→ 不再硬套体系认证那五张',
    /内审\/管评/.test(c) ? '仍然出现了体系任务' : '没有体系任务');

  const d = await make(`走查-没选-${Date.now() % 10000}`, '');
  const hasIso = /资料收集.*文件编制.*内审\/管评/.test(d);
  check(!hasIso, 'D｜没选服务类型 → 不瞎生成那五张', hasIso ? '还是生成了' : '空的，等人套模板');

  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
