// 点头像时右下角不该冒出问号 —— 桌面和手机两个宽度都要验。
//
// 上一轮我只验了「菜单出来了没有」，没验「有没有多出别的东西」。
// 这次两件一起看，而且**先确认修之前真的会冒出来**（不然验了个寂寞）。
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];

let bad = 0;
const check = (ok, label, extra = '') => {
  if (!ok) bad++;
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' —— ' + extra : ''}`);
};

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
  await p.reload();
  await p.waitForTimeout(2000);

  // 右下角那个问号：HelpHub 在「有弹窗打开」时才渲染，带 data-help-ui
  const floatingHelp = () => p.locator('button[data-help-ui="1"]').count();

  const run = async (label, width) => {
    await p.setViewportSize({ width, height: 1000 });
    await p.goto('http://localhost:3000/#/my-tasks');
    await p.waitForTimeout(1200);

    check(await floatingHelp() === 0, `${label}｜没点之前，右下角本来就不该有问号`);

    // 点头像（桌面和手机是两套 DOM 同时存在，必须挑当前**可见**的那一个 ——
    // 上一版栽在这里：选择器取到隐藏的那份，四条全绿其实一下都没点到）
    const avatars = p.locator('button[aria-label^="账号菜单"]');
    const n = await avatars.count();
    let clicked = false;
    for (let i = 0; i < n; i++) {
      const el = avatars.nth(i);
      if (await el.isVisible()) { await el.click(); clicked = true; break; }
    }
    check(clicked, `${label}｜找得到并点得开头像按钮`);
    await p.waitForTimeout(600);

    const menuText = await p.locator('[role="menu"]:visible').first().innerText().catch(() => '');
    check(/退出登录/.test(menuText), `${label}｜菜单里有身份和退出登录`, menuText.replace(/\s+/g, ' ').slice(0, 50));

    const stray = await floatingHelp();
    check(stray === 0, `${label}｜点开头像后，右下角没有多出问号`, `实测 ${stray} 个`);

    // 关掉头像菜单，再验铃铛 —— 它用的是同一层「点空白处关闭」，
    // 所以是同一个 bug 的另一个入口。只验头像等于只修一半。
    const close1 = p.locator('[data-dismiss-layer]:visible');
    if (await close1.count()) await close1.first().click({ force: true }).catch(() => {});
    await p.waitForTimeout(400);

    const bell = p.locator('button[aria-label*="提醒"], button[aria-label*="通知"]');
    let rangBell = false;
    for (let i = 0; i < await bell.count(); i++) {
      const el = bell.nth(i);
      if (await el.isVisible()) { await el.click().catch(() => {}); rangBell = true; break; }
    }
    if (rangBell) {
      await p.waitForTimeout(600);
      const strayBell = await floatingHelp();
      check(strayBell === 0, `${label}｜点开铃铛后，右下角也没有多出问号`, `实测 ${strayBell} 个`);
    } else {
      check(false, `${label}｜找得到铃铛按钮`);
    }

    await p.screenshot({ path: `.artifacts/avatar-${width}.png` });

    // 关掉菜单再进下一轮：那层「点空白处关闭」会挡住一切后续点击。
    // 直接点它本身，不要猜坐标 —— 猜坐标正是上一轮翻车的原因。
    // 有好几层（侧边栏那层常驻但隐藏），要挑当前可见的那一个 ——
    // `.first()` 又会取到隐藏的那份，这是同一天第三次栽在这上面
    const layer = p.locator('[data-dismiss-layer]:visible');
    if (await layer.count()) await layer.first().click({ force: true }).catch(() => {});
    await p.waitForTimeout(400);
  };

  await run('电脑 1440', 1440);
  await run('手机 390', 390);

  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
