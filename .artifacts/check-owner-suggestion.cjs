// 派活建议的三档行为验证 —— 2026-09-11 金恩来提的设计问题
//
//   ① 自己建自己的活  → 不打扰（建议默认收起）
//   ② 拿不准派给谁     → 点开才看得到（拉取式）
//   ③ 换掉原来做的人   → 主动拦一下（推送式，只这一种）
//
// 用真账号真登录跑，不 mock 接口 —— 上一版就是因为 mock 了数据，
// groupServiceLine('体系认证')→未分类 这种真实缺陷一点感觉都没有。
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];

const log = (ok, label, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' —— ' + extra : ''}`);

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  let bad = 0;
  const check = (ok, label, extra) => { if (!ok) bad++; log(ok, label, extra); };

  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  // 登录后应用自己会跳一次工作台。HashRouter 改 hash 不会重新加载，
  // 所以 goto 太早会被这一跳盖掉 —— 上一版在这里白报了一次「按钮不存在」。
  await p.waitForTimeout(1500);

  // 新手引导会盖一层 z-[70] 的遮罩，挡住页面上所有点击。
  // 这里按账号关掉它再继续 —— 要验的是派活建议，不是引导。
  await p.evaluate(() => {
    const uid = JSON.parse(localStorage.getItem('current_user_id') || 'null');
    const ps = JSON.parse(localStorage.getItem('user_profiles_v1') || '[]');
    const me = ps.find(x => x.id === uid) || ps[0] || {};
    [...(me.roles || []), me.activeRole].filter(Boolean)
      .forEach(r => localStorage.setItem(`onboard_seen_${uid}_${r}`, '99'));
  });
  await p.reload();
  await p.waitForTimeout(2000);

  const openModal = async () => {
    // 上一场景的弹窗还开着的话，它自己就是遮罩，会挡住「新建项目」。
    // 顺带记一笔：Esc 关不掉这个弹窗（只能点「取消」），已记为待改。
    const cancel = p.getByRole('button', { name: '取消', exact: true });
    if (await cancel.count()) { await cancel.first().click(); await p.waitForTimeout(300); }
    await p.goto('http://localhost:3000/#/projects');
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: '新建项目', exact: true }).click();
    await p.getByPlaceholder('例如：某某工厂ISO认证咨询').waitFor();
  };

  const state = async () => ({
    抢客户提醒: await p.getByText(/以前是[\s\S]*做的 —— 确认要换人吗/).count() > 0,
    建议入口: await p.getByText(/拿不准派给谁？看看建议/).count() > 0,
    建议已展开: await p.locator('details:has-text("拿不准派给谁") [open]').count() > 0
      || (await p.locator('details:has-text("拿不准派给谁")').count() > 0
        && await p.locator('details[open]:has-text("拿不准派给谁")').count() > 0),
    人选可见: await p.getByRole('button', { name: '选他' }).count(),
  });

  // ── 场景 A：体系认证、不关联客户（梁杰建自己的活就是这种）
  await openModal();
  await p.getByPlaceholder('例如：某某工厂ISO认证咨询').fill('走查测试厂A ISO三体系');
  await p.getByRole('radio', { name: /不涉及客户/ }).check();
  await p.locator('select').filter({ hasText: '决定建议谁来做' }).count(); // noop，下面按值选
  await p.selectOption('select:has(option:text-is("体系认证"))', '体系认证');
  await p.waitForTimeout(400);
  const A = await state();
  check(!A.抢客户提醒, 'A｜自己建活不被主动打扰', '没有弹抢客户提醒');
  check(A.建议入口, 'A｜「体系认证」认得出来了', '收起的建议入口出现了（修复前这里是空的）');
  check(!A.建议已展开, 'A｜建议默认收起', '不点开看不到人名');
  check(A.人选可见 === 0, 'A｜收起时人名不外露', `当前可见「选他」按钮 ${A.人选可见} 个`);

  await p.locator('details:has-text("拿不准派给谁") summary').click();
  await p.waitForTimeout(200);
  const names = await p.locator('details:has-text("拿不准派给谁")').innerText();
  check(/黄邦煜|梁杰/.test(names), 'A｜点开后给的是体系认证的人',
    names.replace(/\s+/g, ' ').slice(0, 90));
  await p.locator('details:has-text("拿不准派给谁")').scrollIntoViewIfNeeded();
  await p.waitForTimeout(200);
  await p.screenshot({ path: '.artifacts/owner-suggestion-A.png' });

  // ── 场景 B：老客户 + 以前别人做过的服务（真正该拦的那一次）
  await openModal();
  await p.getByPlaceholder('例如：某某工厂ISO认证咨询').fill('优福包装 QS 复审');
  const cust = p.getByRole('radio', { name: /给客户做|服务某个客户/ });
  if (await cust.count()) await cust.first().check();
  const picker = p.locator('select').filter({ has: p.locator('option:text-matches("优福")') }).first();
  if (await picker.count()) await picker.selectOption({ label: await picker.locator('option:text-matches("优福")').first().innerText() });
  await p.selectOption('select:has(option:text-is("食品相关产品"))', '食品相关产品');
  await p.waitForTimeout(400);
  const B = await state();
  check(B.抢客户提醒, 'B｜换掉原负责人时主动拦一下');
  if (B.抢客户提醒) {
    const t = (await p.getByText(/以前是[\s\S]*做的 —— 确认要换人吗/).first().innerText()).replace(/\s+/g, '');
    check(/商春姿/.test(t), 'B｜提醒里说清以前是谁做的', t);
  }

  await p.getByText(/以前是[\s\S]*做的 —— 确认要换人吗/).first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(200);
  await p.screenshot({ path: '.artifacts/owner-suggestion-B.png' });
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
