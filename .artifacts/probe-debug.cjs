const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.goto('http://localhost:3000/#/projects');
  await p.waitForTimeout(2500);
  console.log('URL', p.url());
  console.log('角色', await p.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('current_user_id') || 'null');
    const ps = JSON.parse(localStorage.getItem('user_profiles_v1') || '[]');
    const me = ps.find(x => x.id === u) || ps[0];
    return me && { name: me.name, roles: me.roles, activeRole: me.activeRole };
  }));
  const btns = await p.locator('main button, header button').allInnerTexts();
  console.log('按钮', JSON.stringify(btns.map(t => t.replace(/\s+/g, '')).filter(Boolean).slice(0, 40)));
  await p.screenshot({ path: '.artifacts/probe-debug.png', fullPage: false });
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
