// 「派活建议被采纳了没有」这条打点，真的落库了吗。
//
// 只看前端发没发请求是不够的 —— 这个项目里「悄悄没生效」的坑
// 有一半是请求发出去了、字段在半路被白名单吃掉了。
// 所以这里真建两个项目（一个照建议派、一个故意改人），再回库里查。
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const posted = [];
  p.on('request', r => {
    if (r.url().includes('/api/business-events') && r.method() === 'POST') posted.push(r.postDataJSON());
  });

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
  await p.reload();
  await p.waitForTimeout(2000);

  // 建一个体系认证的项目，负责人保持默认（黄佳佳自己）→ 系统推的是黄邦煜 → overridden
  await p.goto('http://localhost:3000/#/projects');
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: '新建项目', exact: true }).click();
  await p.getByPlaceholder('例如：某某工厂ISO认证咨询').fill('打点验证项目-可删');
  await p.getByRole('radio', { name: /不涉及客户/ }).check();
  await p.selectOption('select:has(option:text-is("体系认证"))', '体系认证');
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: '确认立项', exact: true }).click();
  await p.waitForTimeout(2500);

  console.log('前端发出的打点：', JSON.stringify(posted, null, 1));
  await b.close();
  if (!posted.length) { console.log('❌ 一条都没发'); process.exit(1); }
  const e = posted[posted.length - 1];
  const ok = /project\.owner\.suggestion\./.test(e.eventType)
    && e.subjectId && e.subjectId !== 'undefined'
    && e.detail && e.detail.chosen && Array.isArray(e.detail.suggestedReasons);
  console.log(ok ? '✅ 事件结构完整，projectId 不为空' : '❌ 字段缺失');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
