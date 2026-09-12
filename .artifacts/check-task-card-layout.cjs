// 任务卡片在宽屏下的排版。金恩来 2026-09-12：「全屏显示下有BUG，排版和显示都有问题」
const { chromium } = require('@playwright/test');
const creds = require('../.runtime/走查账号密码.json').账号['咨询顾问 黄佳佳'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  // 他的屏幕接近 2000 CSS px（截图 2000 宽），按这个验
  const W = Number(process.env.W || 1500);
  const p = await b.newPage({ viewport: { width: W, height: 1100 } });
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
  // 新手引导会盖住一切，点「跳过」关掉（localStorage 那招对这版引导不灵）
  const skip = p.getByText('跳过', { exact: true });
  if (await skip.count()) await skip.first().click().catch(() => {});
  await p.waitForTimeout(500);

  await p.goto('http://localhost:3000/#/projects');
  await p.waitForTimeout(1500);
  const skip2 = p.getByText('跳过', { exact: true });
  if (await skip2.count()) await skip2.first().click().catch(() => {});
  await p.waitForTimeout(400);

  // 展开一个任务最多的项目（进度 11/11 那条任务最多）
  const target = p.locator('tr', { hasText: '温州农丁农产品有限公司' }).first();
  await (await target.count() ? target : p.locator('tbody tr').first()).click();
  await p.waitForTimeout(2000);
  await p.getByText(/任务 · 要做哪些事|任务 · 这个客户要跟哪些事/).first().scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(800);

  const report = await p.evaluate(() => {
    const badges = Array.from(document.querySelectorAll('span'))
      .filter(el => ['核心', '合作', '系统', '辅助'].includes((el.textContent || '').trim())
        && /tracking-tighter/.test(el.className));
    const bad = badges.map((el) => {
      const r = el.getBoundingClientRect();
      const row = el.parentElement;
      const rr = row ? row.getBoundingClientRect() : null;
      // 一个字一行 = 高度远超一行、宽度被压到很窄
      // 只看真的渲染出来的（0×0 是祖先 display:none，不是排版问题）
      if (r.width === 0 && r.height === 0) return null;
      const squashed = r.height > 24 || r.width < 26;
      // 和兄弟节点重叠
      const sibs = row ? Array.from(row.children).filter(x => x !== el) : [];
      const overlap = sibs.some(x => {
        const s = x.getBoundingClientRect();
        return !(s.right <= r.left || s.left >= r.right || s.bottom <= r.top || s.top >= r.bottom);
      });
      const overflow = rr ? (row.scrollWidth > row.clientWidth + 1) : false;
      return { text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), squashed, overlap, overflow };
    });
    const shown = bad.filter(Boolean);
    return { total: shown.length, bad: shown.filter(x => x.squashed || x.overlap || x.overflow), sample: shown.slice(0, 4) };
  });
  console.log(`宽度 ${W}｜卡片数：`, report.total);
  console.log('有问题：', report.bad.length);
  console.log('样例  ：', JSON.stringify(report.sample));
  const sec = p.locator('div').filter({ hasText: /^任务 · / }).first();
  await sec.screenshot({ path: `.artifacts/task-cards-${W}.png` }).catch(async () => {
    await p.screenshot({ path: `.artifacts/task-cards-${W}.png` });
  });
  await b.close();
  process.exit(report.total === 0 ? 2 : (report.bad.length ? 1 : 0));
})().catch(e => { console.error(e.message); process.exit(3); });
