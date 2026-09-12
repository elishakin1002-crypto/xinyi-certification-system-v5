// 「我的登录设备」按设备归并 —— 拿库里真实的 11 条会话验，不是造数据。
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
  await p.evaluate(() => {
    const uid = JSON.parse(localStorage.getItem('current_user_id') || 'null');
    const ps = JSON.parse(localStorage.getItem('user_profiles_v1') || '[]');
    const me = ps.find(x => x.id === uid) || ps[0] || {};
    [...(me.roles || []), me.activeRole].filter(Boolean)
      .forEach(r => localStorage.setItem(`onboard_seen_${uid}_${r}`, '99'));
  });
  await p.goto('http://localhost:3000/#/my-devices');
  await p.waitForTimeout(2500);

  // 接口返回多少条会话
  const raw = await p.evaluate(async () => {
    const r = await fetch('/api/auth/sessions', { credentials: 'include' }).then(x => x.json());
    return (r.data?.sessions || r.sessions || []).length;
  });
  const rows = await p.locator('main li').count();
  const txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
  console.log(`接口返回会话数: ${raw}`);
  console.log(`页面渲染行数  : ${rows}`);
  console.log(`${rows < raw ? '✅' : '❌'} 归并${rows < raw ? '生效' : '没生效'}`);
  console.log(`${/这台上有 \d+ 次登录/.test(txt) ? '✅' : '⚠️'} 有写清每台压着几次登录`);
  console.log(`${!/常用设备/.test(txt) ? '✅' : '❌'} 页面上不再出现「常用设备」`);
  console.log(`${/14 天免登录/.test(txt) ? '✅' : '⚠️'} 改成了「14 天免登录」`);
  await p.screenshot({ path: '.artifacts/my-devices.png' });
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
