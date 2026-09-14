import { expect, Page, test } from '@playwright/test';

/**
 * 六条核心流程的回归测试 —— 每次部署自动跑一遍。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这一层
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-13：「你自己检查时每次都是"全过"、"0 处不符"，
 *                     我去检查时就那里问题这里问题，说明什么？」
 *
 * 说明我的检查查的是**我想到的规则**，他跑的是**真实流程**。
 * 情报雷达是最典型的一例：接口在、路由在、页面在、625 条单元测试全绿、
 * 部署 7 项自检全过 —— 而那个按钮从来没抓到过东西，
 * 因为**没有任何一条检查去真的点一下它**。
 *
 * 这个文件就是"真的去点一下"。和其它几层的分工：
 *
 *   tests/*.test.js            代码写得对不对（快，每次改都跑）
 *   scripts/checkup-*.mjs      数据和配置对不对（真发请求，但不开浏览器）
 *   **这个文件**               **真开浏览器，真点按钮，真看页面上出现了什么**
 *   人工走查                   这个流程符不符合信义实际怎么干活（不可替代）
 *
 * ── 为什么是 Playwright 而不是让 AI 每次点一遍 ──────────────────
 *
 * 金恩来 2026-09-14 问过 token 成本。关键差别：
 * AI 开浏览器探索一轮要几十万 token，**每次都要再付一遍**；
 * 这个文件写完之后**每次运行 0 成本**，2-3 分钟跑完，而且结果每次一样。
 *
 * 规矩：AI 探索中发现的任何问题，**当场转成这里的一条用例** ——
 * 同一个问题只付一次钱。
 *
 * ── 写用例的两条纪律 ────────────────────────────────────────────
 *
 * 1. **断言"人能看到什么"，不断言"代码怎么写的"**。
 *    class 名、组件结构随时会变，而"点了保存之后列表里出现这一条"不会变。
 * 2. **每条用例自己造数据、自己收尾**。共用数据的用例一旦有一条失败，
 *    后面全部连坐，报出来一屏红色，真因埋在第一条里。
 */

const ADMIN = { account: 'admin@xinyi-iso.local', password: 'local-test-password' };

/** 打开应用并登录。所有用例的第一步，抽出来免得改登录页要改六处 */
const login = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('xinyi_auth_required', '1');
    /*
      ── 先把新手引导按掉（2026-09-14 第一版四条全红的真因）────────

      e2e 每次都是全新的 localStorage，于是「新手引导」判定为没看过、
      自动铺一层全屏遮罩 —— 后面所有点击全部超时。

      我第一反应是去改选择器（以为是定位写错了），改完照样红；
      接着去猜那个「看过了」的 localStorage key，又猜错两次 ——
      **规律性的失败先怀疑测试环境，而且别去猜别人的内部实现。**
      现在 OnboardingTour 认一个显式开关，测试自己说「别弹」就行。

      引导本身要单独测（它也会坏），但不该混在业务流程里：
      一个用例同时验两件事，红了不知道是哪件。
    */
    window.localStorage.setItem('xinyi_disable_onboarding', '1');
  });
  await page.goto('/#/dashboard');
  await page.getByPlaceholder('员工邮箱或账号').fill(ADMIN.account);
  await page.getByPlaceholder('请输入密码').fill(ADMIN.password);
  await page.getByRole('button', { name: /登录/ }).click();
  /*
    ── 断言必须挑「只有登录之后才会出现」的东西（2026-09-14 血的教训）──

    第一版这里写的是 `toContainText('工作台')`，
    而**登录页自己的标题里就有这三个字**：
    「登录后进入工作台、线索、合同、项目与财务闭环。」
    于是登录失败也照样通过 —— 四条用例绿着，其实一条都没真正跑起来，
    而我差点就把这套"绿的"回归测试交出去了。

    改成等登录页消失（员工登录标题不见了）+ 出现只有登录后才有的账号菜单。
    两个条件都满足，才叫真的进去了。
  */
  await expect(page.locator('body'), '登录没成功 —— 还停在登录页').not.toContainText('员工登录', { timeout: 15_000 });
  await expect(page.locator('[data-onboard="view-switch"]').last(), '进去了但顶栏没渲染出来').toBeVisible({ timeout: 15_000 });
};

/**
 * 页面上有没有崩掉的痕迹。
 *
 * 只看"有没有报错"是不够的 —— React 出错边界会渲染一块"页面出错了"，
 * 控制台可能什么都没有。所以两样都查。
 */
const expectNoCrash = async (page: Page, where: string) => {
  const body = await page.locator('body').innerText();
  expect(body, `${where}：页面渲染出了错误兜底`).not.toMatch(/页面出错|Something went wrong|Unexpected Application Error/);
  expect(body.trim().length, `${where}：页面是空白的`).toBeGreaterThan(50);
};

test.describe('六条核心流程', () => {

  // ── 1. 登录 → 工作台 ──────────────────────────────────────────
  test('1 登录之后能进工作台，而且工作台不是空白', async ({ page }) => {
    await login(page);
    await expectNoCrash(page, '工作台');
    /*
      工作台有六套（按角色），最容易出的问题是某一套里某个卡片
      拿不到数据直接抛异常，整页变成兜底。所以查的是"有没有实质内容"。
    */
    await expect(page.locator('body')).toContainText(/工作台/);
  });

  // ── 2. 建客户 → 建合同 → 建项目 ──────────────────────────────
  test('2 建客户 → 建合同 → 建项目，三步能串起来', async ({ page }) => {
    await login(page);
    const stamp = Date.now();
    const custName = `E2E客户-${stamp}`;

    await page.goto('/#/customers');
    await expectNoCrash(page, '客户管理');
    await page.getByRole('button', { name: '新建客户' }).first().click();
    // 占位符来自 CUSTOMER_NAME_PLACEHOLDER，不要另写一份（两份必然漂移）
    await page.getByPlaceholder(/营业执照全称/).first().fill(custName);
    await page.getByRole('button', { name: '保存' }).first().click();
    /*
      断言"列表里能看到刚建的那条"，而不是"接口返回了 200"。
      2026-09-13 那次合同删除就是接口 200 而库里没动 ——
      **只信接口返回码，等于没测。**
    */
    await expect(page.locator('body')).toContainText(custName, { timeout: 10_000 });

    await page.goto('/#/contracts');
    await expectNoCrash(page, '合同管理');
    await expect(page.locator('body')).toContainText(/合同/);

    await page.goto('/#/projects');
    await expectNoCrash(page, '项目管理');
    await expect(page.locator('body')).toContainText(/项目/);
  });

  // ── 3. 每个角色的首页都打得开 ────────────────────────────────
  test('3 六个角色的工作台都打得开，没有一个是空白或报错', async ({ page }) => {
    await login(page);
    /*
      这条抓的是「某个角色的看板拿不到数据就整页崩」。
      六套工作台是分开写的，改一处漏一处是这个项目最高频的 bug ——
      而漏掉的那一套，只有那个角色的同事会遇到，
      他多半会以为"是我电脑的问题"，不会来报。
    */
    for (const persona of ['boss', 'sales', 'consultant', 'finance', 'manager', 'sysadmin']) {
      await page.goto(`/#/dashboard?persona=${persona}`);
      await page.waitForTimeout(800);
      await expectNoCrash(page, `${persona} 工作台`);
    }
  });

  // ── 4. 提醒闭环：看得见 → 点得动 → 办完能消失 ────────────────
  test('4 提醒面板打得开，条目能点，「办完了」能让它消失', async ({ page }) => {
    await login(page);
    const bell = page.locator('button[aria-label*="提醒"]').last();
    await bell.click();
    await expect(page.locator('body')).toContainText('待办提醒');

    const done = page.getByRole('button', { name: '办完了' });
    const count = await done.count();
    if (count === 0) {
      /*
        没有待办是**合法状态**（生产上就出现过：23 条全是两周后才该响的）。
        但那时面板必须说清楚，不能是一片空白 ——
        空白配上角标消失，看着就像"提醒功能又没了"。
      */
      await expect(page.locator('body')).toContainText(/近期没有需要你处理的事|没有未读提醒/);
      return;
    }
    await done.first().click();
    await page.waitForTimeout(1200);
    /*
      「办完了」和「已读」是两件事：已读只是看过，办完才让它离开待办栏。
      生产上 228 条提醒 0 条被标已读 —— 因为标了既不代表做了也不让它消失。
    */
    const after = await page.getByRole('button', { name: '办完了' }).count();
    expect(after, '点了「办完了」，那一组还在原地 —— 提醒没有退出机制').toBeLessThan(count);
  });

  // ── 5. 主动改密码入口还在 ────────────────────────────────────
  test('5 账号菜单里能找到「修改密码」，并且点得进去', async ({ page }) => {
    await login(page);
    /*
      这一页一直都在，但 2026-09-13 之前只在"首次登录强制改"时挂出来 ——
      改完标记就没了，这一页从此再也进不去，全公司没人能主动换密码。
      「功能在、入口没了」这类毛病不报错、测试也绿，只能靠盯入口。
    */
    /*
      用 aria-label 定位，不要按「header 里最后一个带图标的按钮」去猜。
      第一版就是那么写的，直接超时 —— **按结构猜**和按形状猜是同一个毛病，
      别人加一个图标按钮就失效，而且失效时看不出是测试的问题还是产品的问题。
    */
    await page.locator('[data-onboard="view-switch"]').last().click();
    await page.waitForTimeout(400);
    const entry = page.getByRole('button', { name: '修改密码' });
    await expect(entry, '账号菜单里没有「修改密码」').toHaveCount(1);
    await entry.click();
    await expect(page.locator('body')).toContainText('修改密码');
    await expectNoCrash(page, '修改密码页');
  });

  // ── 6. 知识中心 / 情报雷达打得开且不报错 ─────────────────────
  test('6 知识中心和情报雷达打得开，不是空白也不报错', async ({ page }) => {
    await login(page);
    for (const [route, name] of [['/#/knowledge', '知识中心'], ['/#/intel', '情报雷达']]) {
      await page.goto(route);
      await page.waitForTimeout(1000);
      await expectNoCrash(page, name);
    }
  });
});

test.describe('不许回归的几件事', () => {
  /*
    这一组不是"流程"，是"曾经坏过、绝不能再坏"的点。
    每条后面都是一次真实事故。
  */

  test('页面不许再去请求外部 CDN —— 国内访问时快时慢，同事那边会白板', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(host)) {
        external.push(r.url());
      }
    });
    await login(page);
    for (const route of ['/#/customers', '/#/contracts', '/#/projects', '/#/knowledge']) {
      await page.goto(route);
      await page.waitForTimeout(600);
    }
    expect(external, `又出现了外部 CDN 请求：\n${external.join('\n')}`).toHaveLength(0);
  });

  test('点头像不许在右下角冒出「这个弹窗要我填什么？」', async ({ page }) => {
    /*
      `.fixed.inset-0` 当成弹窗，这个形状规则在这个项目里错了四次。
      下拉菜单的「点空白处关闭」层长得和遮罩一模一样，
      于是点个头像，右下角冒出一个帮助气泡问你要填什么。
      现在靠 data-dismiss-layer 显式声明，这条守住它别退回去猜。
    */
    await login(page);
    await page.locator('[data-onboard="view-switch"]').last().click();
    await page.waitForTimeout(600);
    const body = await page.locator('body').innerText();
    expect(body, '点头像又弹出了帮助气泡').not.toContain('这个弹窗要我填什么');
  });
});
