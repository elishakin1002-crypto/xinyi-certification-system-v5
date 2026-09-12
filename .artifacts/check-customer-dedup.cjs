// 客户查重：两个入口走一遍，结果必须一致。
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok, label, extra = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' —— ' + extra : ''}`); };

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  let lastDialog = '';
  p.on('dialog', async d => { lastDialog = d.message(); await d.dismiss(); });   // 默认「取消」= 不建

  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  const skip = p.getByText('跳过', { exact: true });
  if (await skip.count()) await skip.first().click().catch(() => {});

  const countNamed = async (name) => {
    await p.goto('http://localhost:3000/#/customers');
    await p.waitForTimeout(1500);
    const s = p.getByText('跳过', { exact: true });
    if (await s.count()) await s.first().click().catch(() => {});
    await p.waitForTimeout(400);
    // 只数表格行里的客户名，别把 div 一起数进去（会重复计数）
    return p.locator('tbody tr').filter({ hasText: new RegExp(`^${name}`) }).count();
  };

  const before = await countNamed('测试1');
  console.log(`客户管理里现有「测试1」：${before} 个`);

  // 从客户管理再建一个同名的
  await p.getByRole('button', { name: /新建客户/ }).first().click();
  await p.waitForTimeout(800);
  // 客户名那一栏用 placeholder 认，别用 .first() 猜 —— 猜错就填到别的框里，
  // 然后弹「请输入客户名称」，看起来像产品问题，其实是探针问题
  await p.getByPlaceholder('请输入客户名称').fill('测试1');
  const save = p.getByRole('button', { name: /保存|确定|创建/ }).first();
  await save.click().catch(() => {});
  await p.waitForTimeout(1200);

  check(/已经有「测试1」/.test(lastDialog), '客户管理建重名时会拦一下并说清后果',
    lastDialog.replace(/\s+/g, ' ').slice(0, 70));

  const after = await countNamed('测试1');
  check(after === before, '点「取消」之后没有多出一个重复客户', `${before} → ${after}`);

  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
