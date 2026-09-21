/*
  卡片上的数字，必须等于点进去看到的行数。

  ══════════════════════════════════════════════════════════════
  为什么是 e2e 而不是单元测试（2026-09-21）
  ══════════════════════════════════════════════════════════════

  金恩来：「工作台显示的进行中的项目是 2 个，点击跳转到项目管理后，
    进行中的项目变成 3 个，数量对不上。」

  这条**静态检查抓不到**。我已经把两边的口径统一成一份实现了，
  单元测试也绿，但实际点下去范围还是「与我相关」——
  因为页面里另有一个 useEffect 在挂载时把范围推回默认值，
  盖掉了工作台传来的焦点。而且它用 React 状态做判据，
  在同一次提交里读不到刚设的值，看代码完全看不出问题。

  只有真的点一次才知道。所以这条留成常设 e2e：
  建两个项目 → 看工作台的数 → 点进去 → 数列表 → 两个数必须相等。
*/
import { expect, test } from '@playwright/test';

test('工作台的数字 = 点进去看到的行数', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    window.localStorage.setItem('xinyi_disable_onboarding', '1');
    window.localStorage.setItem('current_user_id', JSON.stringify('U-004'));   // 咨询顾问
  });
  page.on('dialog', d => d.accept());
  await page.setViewportSize({ width: 1400, height: 950 });

  // 建两个项目（步骤照搬 smoke.spec 里已验证过的那段）
  for (const name of ['我负责的项目A', '我负责的项目B']) {
    await page.goto('/#/projects');
    await page.getByRole('button', { name: /新建项目/ }).click();
    const form = page.locator('form');
    await form.locator('input').first().fill(name);
    await form.getByText('不涉及客户', { exact: true }).click();
    await form.getByRole('button', { name: /确认立项/ }).click();
    await page.waitForTimeout(700);
  }

  await page.goto('/#/dashboard');
  await page.waitForTimeout(1200);
  // 直接定位那张卡，从卡里读数字 —— 全页正则容易匹配到别处
  const card = page.locator('a,button,div').filter({ hasText: /^\s*\d+\s*进行中项目\s*$/ }).first();
  const dashN = ((await card.textContent()) || '').match(/(\d+)/)?.[1];
  console.log('工作台 · 进行中项目 =', dashN);

  await card.click();
  await page.waitForTimeout(1200);
  const proj = (await page.locator('body').textContent()) || '';
  const scope = (proj.match(/范围\s*(我负责的|与我相关|全公司)/) || [])[1];
  const total = (proj.match(/共\s*(\d+)\s*个项目/) || [])[1];
  console.log('项目管理 · 范围 =', scope);
  console.log('项目管理 · 共 N 个项目 =', total);
  console.log(dashN === total ? '✅ 两个数字一致' : `❌ 对不上：${dashN} vs ${total}`);
  await page.screenshot({ path: '.runtime/n-proj.png' });
  expect(scope, '工作台点进来应落在「我负责的」').toBe('我负责的');
  expect(total, '卡片数字和列表条数必须一致').toBe(dashN);
});
