const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(2500);
  console.log('URL', p.url());
  const all = await p.locator('button').evaluateAll(els => els.slice(0, 60).map(e => ({
    al: e.getAttribute('aria-label'), ob: e.getAttribute('data-onboard'),
    t: (e.textContent || '').replace(/\s+/g, '').slice(0, 14),
    vis: e.getClientRects().length > 0,
  })));
  console.log(JSON.stringify(all));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
