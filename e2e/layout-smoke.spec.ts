/*
  布局闸门 —— 「好看」里能量化的那部分，不靠肉眼。

  ══════════════════════════════════════════════════════════════
  为什么有这个文件（2026-09-20）
  ══════════════════════════════════════════════════════════════

  金恩来 2026-09-19 连着三轮指同一类问题：
  「手机大小的尺寸下智能识别的布局跳到屏幕外面去了」
  「手工录入按钮和智能识别按钮的大小都不统一」

  两次都是我改完只在桌面看了一眼就交差。而这两件事**都是可以量的**：
    · 跑出屏幕 = 页面能横向滚动（scrollWidth > clientWidth）
    · 大小不统一 = 两个元素的 boundingBox 宽高不一样

  能量的东西就不该靠人看。tests/design-system.test.js 管"用没用规范"，
  这个文件管"排出来是不是真的没毛病"。

  ── 为什么只有两条 ────────────────────────────────────────────

  故意只挑**误报率极低**的两条。像素级的视觉回归（截图比对）在这个
  阶段会天天因为无关改动变红，然后被人加跳过 —— 那比没有更糟。
  这两条不一样：横向溢出和尺寸不一致，红了就一定是真问题。
*/
import { expect, Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.setItem('xinyi_disable_onboarding', '1'); });
});

/** 页面能不能横向滚动。0 = 没有东西跑到屏幕外面 */
const overflowOf = (page: Page) => page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

const PAGES = [
  { path: '/#/dashboard', name: '工作台' },
  { path: '/#/leads', name: '线索管理' },
  { path: '/#/customers', name: '客户管理' },
  { path: '/#/contracts', name: '合同管理' },
  { path: '/#/projects', name: '项目管理' },
  { path: '/#/finance', name: '财务中心' }
];

for (const p of PAGES) {
  test(`手机 375px 下「${p.name}」不许横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(p.path);
    await expect(page.locator('body')).toContainText(p.name);
    /*
      留 1px 容差：有些浏览器在小数宽度上会差半个像素，
      卡死在 0 会变成偶尔红一次的假故障 —— 那种比没有更费人。
    */
    expect(await overflowOf(page), `${p.name} 在手机上跑出屏幕了`).toBeLessThanOrEqual(1);
  });
}

test('客户详情里，并排的两个动作必须一样大', async ({ page }) => {
  /*
    2026-09-19 实测过的那一对：
      手工录入 = 普通按钮 160x34
      智能识别 = 虚线投放卡片 400x60
    并排摆着，形状尺寸层级全不一样。修好之后两个都是 160x34。

    这条钉的不是"必须 160x34"（宽度以后可能改），
    而是**并排的同级动作必须长得一样**。
  */
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.goto('/#/customers');
  await page.getByRole('button', { name: /新建客户/ }).click();

  const detail = page.locator('div.fixed.inset-0').filter({ hasText: '客户关系档案' }).filter({ hasText: '跟进记录' });
  await expect(detail).toBeVisible();
  await detail.getByText('认证证书与监管周期').scrollIntoViewIfNeeded();

  const manual = await detail.getByRole('button', { name: /手工录入/ }).first().boundingBox();
  const smart = await detail.getByText('智能识别').first().boundingBox();

  expect(manual, '找不到「手工录入」').not.toBeNull();
  expect(smart, '找不到「智能识别」').not.toBeNull();
  expect(Math.abs((manual!.width) - (smart!.width)), '两个按钮宽度不一致').toBeLessThanOrEqual(2);
  expect(Math.abs((manual!.height) - (smart!.height)), '两个按钮高度不一致').toBeLessThanOrEqual(2);
});
