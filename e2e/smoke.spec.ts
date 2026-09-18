import { expect, Page, test } from '@playwright/test';
/*
  分类名从**定义处**取，不在测试里写死中文。

  2026-09-08 这一类从「交付项目」改名成「客户项目」，而这条断言还写着
  「交付项目」，整整十天没人知道 —— 因为那段时间 e2e 根本跑不起来。
  写死文案的断言就是这样：改名的人不会想到去翻 e2e 目录。
*/
import { PROJECT_CATEGORY_META } from '../src/modules/projectCategory';
/*
  客户名占位符同理：真实的值是「营业执照全称，例如：…」，
  而这里原来写着「请输入客户名称」—— 一个界面上根本不存在的字符串。
  e2e/core-flows.spec.ts 早就从常量取了，这份没跟上。
*/
import { CUSTOMER_NAME_PLACEHOLDER } from '../src/modules/customerIdentity';

/*
  ── 每个用例先把新手引导按掉（2026-09-18 补）─────────────────────

  e2e 每次都是全新的 localStorage，于是「新手引导」判定为没看过、
  自动铺一层全屏遮罩（`.fixed.inset-0 z-[70]`）—— 后面所有点击全部超时。

  core-flows.spec 2026-09-14 已经为此加过同样一行，**smoke 和 auth 漏了**。
  之前没暴露，是因为这两个 spec 更早就挂在登录页上了
  （playwright.config 没覆盖 VITE_AUTH_REQUIRED，继承了 .env.local）——
  一个问题盖住另一个问题。

  下面那条 tests/e2e-hygiene.test.js 会保证新写的 spec 不会再漏。
*/
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('xinyi_disable_onboarding', '1');
  });
});


const ignoredConsolePatterns = [
  /favicon/i,
  /cdn.*source map/i,
  /Failed to load resource/i
];

const ignoredRequestHosts: string[] = [];

/**
 * 这些域名以前是白名单——CDN 拉不到就当没看见。
 *
 * 现在反过来：Tailwind、xlsx、pdf.js、字体全部改成从自己服务器发，
 * **再出现对这些域名的请求就是回归**。国内访问它们时快时慢，
 * 白名单会让「同事那边页面白板」这类问题在测试里完全看不出来。
 */
const forbiddenExternalHosts = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

const collectPageErrors = (page: Page) => {
  const consoleErrors: string[] = [];
  const failedLocalRequests: string[] = [];
  const externalRequests: string[] = [];

  // 监听 request 而不是 requestfailed —— 关键是「有没有发出去」，
  // 不是「有没有失败」。在网好的机器上跑测试，外部请求会成功，
  // 只盯失败的话这条回归永远抓不到。
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (forbiddenExternalHosts.includes(host)) {
      externalRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (ignoredConsolePatterns.some((pattern) => pattern.test(text))) return;
    consoleErrors.push(text);
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (ignoredRequestHosts.includes(url.hostname)) return;
    failedLocalRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
  });

  return {
    assertClean() {
      expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
      expect(failedLocalRequests, `Unexpected failed local requests:\n${failedLocalRequests.join('\n')}`).toEqual([]);
      expect(
        externalRequests,
        `页面又去请求外部 CDN 了，国内访问会时快时慢甚至白板。\n` +
        `这些资源应该从 public/vendor/ 或 public/fonts/ 本地发：\n${externalRequests.join('\n')}`
      ).toEqual([]);
    }
  };
};

test('dashboard loads and core navigation is present', async ({ page }) => {
  const pageErrors = collectPageErrors(page);

  await page.goto('/#/dashboard');
  await expect(page.locator('body')).toContainText('工作台');
  await expect(page.getByRole('link', { name: /线索管理/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /客户管理/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /合同管理/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /项目管理/ })).toBeVisible();

  pageErrors.assertClean();
});

test('core business routes render their entry pages', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const expectProjectsApiRead = process.env.VITE_PROJECTS_API_READ_ENABLED === '1';
  let projectsApiReads = 0;
  await page.route('**/api/projects**', async (route) => {
    if (route.request().method() === 'GET') {
      projectsApiReads += 1;
    }
    await route.continue();
  });

  const routes = [
    { path: '/#/leads', title: '线索公海' },
    { path: '/#/customers', title: '客户管理' },
    { path: '/#/contracts', title: '合同管理' },
    /*
      2026-09-18 修：这里原来写「交付工作台」，而页面标题早就是「项目管理」。
      过时的断言之所以九天没人发现，见本文件里「线索能转成客户」那条上面的说明
      —— CI 两周没跑、本机 e2e 又跑不起来。
    */
    { path: '/#/projects', title: '项目管理' },
    { path: '/#/finance', title: '财务中心' }
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator('body')).toContainText(route.title);
  }

  if (expectProjectsApiRead) {
    await expect.poll(() => projectsApiReads).toBeGreaterThanOrEqual(1);
  }
  pageErrors.assertClean();
});

test('project create can use API write gray rollout', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const stamp = Date.now();
  const projectName = `E2E项目写入-${stamp}`;
  const expectProjectsApiRead = process.env.VITE_PROJECTS_API_READ_ENABLED === '1';
  const expectProjectsApiWrite = process.env.VITE_PROJECTS_API_WRITE_ENABLED === '1';
  let projectsApiReads = 0;
  let projectsApiWrites = 0;
  let projectTransactionWrites = 0;
  let sawServiceItemTransaction = false;
  let sawTaskLogTransaction = false;
  let sawCompletionTransaction = false;
  let sawReopenTransaction = false;

  await page.route('**/api/projects**', async (route) => {
    if (route.request().method() === 'GET') {
      projectsApiReads += 1;
    }
    if (route.request().method() === 'POST' && /\/api\/projects(?:[?#]|$)/.test(route.request().url())) {
      projectsApiWrites += 1;
    }
    if (route.request().method() === 'POST' && /\/api\/projects\/transaction(?:[?#]|$)/.test(route.request().url())) {
      projectTransactionWrites += 1;
      const body = route.request().postDataJSON() as any;
      const transactionProjects = Array.isArray(body?.datasets?.projects_v8) ? body.datasets.projects_v8 : [];
      const transactionProject = transactionProjects.find((item: any) => item?.name === projectName);
      if (
        Array.isArray(transactionProject?.serviceItems) &&
        transactionProject.serviceItems.length > 0 &&
        Array.isArray(transactionProject?.tasks) &&
        transactionProject.tasks.some((task: any) => typeof task?.serviceItemId === 'string' && task.serviceItemId)
      ) {
        sawServiceItemTransaction = true;
      }
      sawTaskLogTransaction = Array.isArray(body?.datasets?.project_work_logs_v1);
      if (
        Array.isArray(body?.datasets?.customers_v8) &&
        Array.isArray(body?.datasets?.reminders_v8) &&
        Array.isArray(body?.datasets?.projects_v8)
      ) {
        sawCompletionTransaction = true;
      }
      if (
        transactionProject?.status === 'Active' &&
        !transactionProject?.completionRecord &&
        Array.isArray(body?.datasets?.customers_v8) &&
        Array.isArray(body?.datasets?.reminders_v8)
      ) {
        sawReopenTransaction = true;
      }
    }
    await route.continue();
  });

  await page.route('**/api/state/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: 0, message: 'e2e state sync intercepted', data: { written: 0 } })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#/projects');
  if (expectProjectsApiRead) {
    await expect.poll(() => projectsApiReads).toBeGreaterThanOrEqual(1);
  }

  await page.getByRole('button', { name: /新建项目/ }).click();
  const form = page.locator('form');
  await form.locator('input').first().fill(projectName);
  /*
    「这活给谁做？」是必填 —— 不选的话浏览器原生校验会拦住提交，
    而那个气泡**不在 DOM 里**，表现出来就是"点了确认立项没反应"。
    我 2026-09-18 手工验收时也被这个绊了两次，以为极速立项坏了。

    这里选「不涉及客户」（政府交办/内部建设那一档），
    走的是不需要挑客户的最短路径。它是个 label 包着的单选，不是按钮。
  */
  await form.getByText('不涉及客户', { exact: true }).click();
  await form.getByRole('button', { name: /确认立项/ }).click();

  if (expectProjectsApiWrite) {
    await expect.poll(() => projectsApiWrites).toBeGreaterThanOrEqual(1);
  }
  await expect(page.locator('body')).toContainText(projectName);

  await page.getByPlaceholder('搜索项目…').fill(projectName);
  await page.locator('tr').filter({ hasText: projectName }).click();
  /*
    ── 这一段 2026-09-18 收敛了（原来有 50 行，逐步点到"重新打开项目"）──

    原来的链条是：展开项目 → 添加服务项 → 切任务状态 → 补录金额 →
    标记完成 → 重新打开。**它现在一步都走不通**，而且不是产品坏了：

      · 「交付任务流水线」这个区块名早就不在页面上（0 处）
      · 「添加服务项」只在**从合同立项、带服务项**的项目上出现，
        极速立项建的项目没有这一段
      · 补录金额这一步也已经被架空 —— 2026-09-18 起立项会带上合同金额

    一个选择器一个选择器地补不是正确做法：**测试和产品差了几个版本，
    补出来的也只是"能跑通"，不再对应任何人真正会走的路。**
    而且这条测试的 gray-rollout 断言（expectProjectsApiWrite 那些）
    在当前 e2e 配置下全是关的，等于没有断言。

    所以收敛成它现在**真能验、而且值得验**的那一段：
    极速立项建得出来、列表里找得到、展开后关键操作在。

    删掉那部分的覆盖去哪了：
      · 建客户→建合同→建项目 三步串联  → e2e/core-flows.spec.ts «2»
      · 任务状态切换（含刷新不回退）    → 2026-09-18 真环境验收 + 服务端测试
      · 项目完成级联                    → server/services/completeProject 的测试
      · 立项带金额                      → tests/contract-to-project-amount.test.js
  */
  await expect(page.locator('body')).toContainText(projectName);
  await page.getByPlaceholder('搜索项目…').fill(projectName);
  await page.locator('tr').filter({ hasText: projectName }).first().click();
  /*
    展开后只断言"这一行还在、能展开"。
    不断言里面有哪些按钮 —— 项目详情的操作按钮是**按归属和权限显示**的，
    而 smoke 跑在关鉴权的配置下，默认用户不拥有任何项目。
    在这里断言按钮，测的其实是"默认用户碰巧有什么权限"，
    那不是这条用例要回答的问题。
    按权限显示哪些按钮，由 102 格的权限矩阵体检负责（npm run health:permissions）。
  */
  await expect(page.locator('tr').filter({ hasText: projectName }).first()).toBeVisible();

  pageErrors.assertClean();
});

test('contract entry links customer, delivery project, and receivable ledger', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const stamp = Date.now();
  const customerName = `E2E闭环客户-${stamp}`;
  const contractTitle = `${customerName} 服务合同`;
  const contractNo = `E2E-${stamp}`;
  const contactName = `测试联系人-${stamp}`;
  const receivableNode = '首付款';
  const expectContractsApiRead = process.env.VITE_CONTRACTS_API_READ_ENABLED === '1';
  const expectContractsApiWrite = process.env.VITE_CONTRACTS_API_WRITE_ENABLED === '1';
  let contractsApiReads = 0;
  let contractTransactionWrites = 0;

  await page.route('**/api/contracts**', async (route) => {
    if (route.request().method() === 'GET') {
      contractsApiReads += 1;
    }
    if (route.request().method() === 'POST' && /\/api\/contracts\/transaction(?:[?#]|$)/.test(route.request().url())) {
      contractTransactionWrites += 1;
    }
    await route.continue();
  });

  await page.route('**/api/state/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: 0, message: 'e2e state sync intercepted', data: { written: 0 } })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#/contracts');
  if (expectContractsApiRead) {
    await expect.poll(() => contractsApiReads).toBeGreaterThanOrEqual(1);
  }
  await page.getByRole('button', { name: /录入合同/ }).click();

  /*
    ── 为什么这一段 2026-09-18 重写（按 data-testid 取，不按位置数）──

    原来是 `form.locator('input[type="text"]').nth(4)` 这样按**出现顺序**数框。
    这条测试因此静悄悄地和表单脱节了，直到这次 CI 真跑起来才暴露：

      · 「客户名称」那个框是**条件渲染**的（只有选「不绑定客户」才出现），
        所以框的**总数会随状态变化** —— nth(n) 指向谁，取决于你点了什么；
      · 原来的第 5 个框「服务项」，在今天的表单里已经不存在了；
      · 点的按钮写的是「添加款项节点」，界面上其实是「添加回款节点」。

    三处都属于同一个毛病：**测试按「看起来像」来取元素**
    （CLAUDE.md 二点五之一），别人改表单它就错，而且错得没有任何声音。
    判据那条写得很准：「这条规则要不要随着别人写新代码而更新？」——
    按位置取元素，要。所以改成显式锚点 data-testid，
    pages/Contracts.tsx 里一一对应。
  */
  const form = page.locator('form');
  await form.getByTestId('contract-title').fill(contractTitle);
  await form.getByTestId('contract-no').fill(contractNo);

  /*
    客户要**真的建出来**，不能只在合同上写个名字 ——
    后面 /#/customers 那条断言要的就是「客户档案里确实多了一家」。
    走的是界面上真实的那条路：找不到 → 直接新建 → 创建并选中。
  */
  await form.getByRole('button', { name: /直接新建客户/ }).click();
  await form.getByTestId('contract-new-customer-name').fill(customerName);
  await form.getByRole('button', { name: /创建并选中/ }).click();

  /*
    服务项目是**提交必填**（handleSubmit 里会 alert 拦下来），
    2026-09-12 从一个自由文本框换成了「从 111 条标准目录多选」。
    老测试还在往那个已经不存在的文本框里填「ISO 9001 认证服务」——
    填不进去，于是整条主线两周没被验过。

    这里不挑具体哪一项（挑了就等于把目录内容钉进测试，目录一改又要来修），
    只取第一条 —— 这条测试要证的是「合同能不能录进去并串起客户/项目/应收」，
    不是「目录里有没有 ISO 9001」。
  */
  await form.getByTestId('service-picker-box').click();
  await form.getByTestId('service-picker-option').first().click();
  /*
    下拉是靠一层铺满屏幕的 data-dismiss-layer 收起的；不收起来，它会挡住后面所有的点击。
    必须**限定在这个选择器里面**取那一层 —— 录入合同的弹窗自己也有一层，
    页面上同时有两个，不限定的话 Playwright 直接报 strict mode violation。
  */
  await form.getByTestId('service-picker').locator('[data-dismiss-layer="1"]').click();

  await form.getByTestId('contract-contact').fill(contactName);
  await form.getByTestId('contract-sign-date').fill('2026-05-01');
  await form.getByTestId('contract-amount').fill('12000');
  await form.getByTestId('contract-payment-method').fill('分期付款');

  await form.getByRole('button', { name: /添加回款节点/ }).click();
  await form.getByTestId('receivable-node').fill(receivableNode);
  await form.getByTestId('receivable-amount').fill('12000');
  await form.getByTestId('receivable-due').fill('2026-05-20');

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await form.getByRole('button', { name: /确认录入并生成/ }).click();
  if (expectContractsApiWrite) {
    await expect.poll(() => contractTransactionWrites).toBeGreaterThanOrEqual(1);
  }

  await expect(page.locator('body')).toContainText(contractNo);
  await expect(page.locator('body')).toContainText(customerName);

  await page.goto('/#/customers');
  await expect(page.locator('body')).toContainText(customerName);

  await page.goto('/#/projects');
  await expect(page.locator('body')).toContainText(customerName);
  await expect(page.locator('body')).toContainText(PROJECT_CATEGORY_META.Delivery.label);

  await page.goto('/#/finance');
  await expect(page.locator('body')).toContainText(customerName);
  await expect(page.locator('body')).toContainText(receivableNode);
  const receivableRow = page.locator('tr').filter({ hasText: customerName }).filter({ hasText: receivableNode });
  await receivableRow.getByRole('button', { name: /确认到账/ }).click();
  if (expectContractsApiWrite) {
    await expect.poll(() => contractTransactionWrites).toBeGreaterThanOrEqual(2);
  }
  /*
    「已核销」是**手机卡片**当年的说法，2026-09-16 已经统一成桌面的「已到账」
    （同一个状态两个词，财务分不清是不是同一件事）。
    这条 e2e 还写着旧词，同样是那两周没人跑它的产物。

    不另外抽常量：tests/receivable-status-label.test.js 已经把这件事钉死了 ——
    它明确断言「已核销」不许再出现。文案要是再改，那条先红。
  */
  await expect(receivableRow).toContainText('已到账');

  pageErrors.assertClean();
});

/*
  ── 这条测试 2026-09-18 重写 ──────────────────────────────────

  原来测的是「生成跟进项目」，而那个功能 **2026-09-09 被刻意删掉了** ——
  它会在没人点任何按钮的情况下自动建项目、把线索锁成「已转化」
  （见 context/AppContext.tsx 里那段说明）。删得对，但**测试没跟着改**。

  之所以九天没人发现：CI 最后一次运行是 2026-09-04（而且是红的），
  本机 e2e 又因为继承 .env.local 的鉴权开关全挂在登录页 ——
  两个问题互相掩盖，安全网整整两周是断的。

  现在改成测**真实存在的那条路**：线索 → 转为客户。
  那是销售真正要走的一步（2026-09-18 才补上前端入口）。
*/
test('线索能转成客户 —— 销售主线的第一个交接点', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const stamp = Date.now();
  const leadCompany = `E2E线索客户-${stamp}`;
  const contactName = `线索联系人-${stamp}`;

  await page.route('**/api/state/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: 0, message: 'e2e state sync intercepted', data: { written: 0 } })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#/leads');
  await page.getByRole('button', { name: /新增线索/ }).click();

  const createLeadForm = page.locator('form').filter({ hasText: '保存线索' });
  await createLeadForm.locator('input').nth(0).fill(leadCompany);
  await createLeadForm.locator('input').nth(1).fill(contactName);
  await createLeadForm.locator('input').nth(2).fill('13800000000');
  await createLeadForm.getByRole('button', { name: /保存线索/ }).click();

  await expect(page.locator('body')).toContainText(leadCompany);
  await page.locator('tr').filter({ hasText: leadCompany }).click();

  /*
    smoke 这一档跑的是**灰度开关全关**的配置（见 playwright.config.ts），
    线索只存在于前端内存里、服务端没有 —— 所以这里只能验到"入口在不在"
    和"确认文案说没说清后果"，验不了服务端级联那一段。

    完整链路（建客户 + 线索标记已转化 + 客户管理立刻看得到）由两处兜着：
      · tests/lead-to-customer-chain.test.js（钉住接口、前端调用、重拉、文案）
      · 真环境手工复验（2026-09-18，三看全过）
    e2e 覆盖不到生产的 PG 路径，这一条记在 docs/上线前验收总计划.md。
  */
  const 转客户 = page.getByRole('button', { name: /转为客户/ });
  await expect(转客户).toBeVisible();

  // 不可撤销的动作必须先确认，而且确认框要说清后果
  let 确认文案 = '';
  page.once('dialog', async d => { 确认文案 = d.message(); await d.dismiss(); });
  await 转客户.click();
  await page.waitForTimeout(1200);
  expect(确认文案, '转客户没有确认框 —— 这是不可撤销的动作').toContain('转成客户');
  expect(确认文案, '确认框没说清这一步不能撤销').toContain('不能撤销');
  expect(确认文案, '确认框没说清转完之后东西去哪了').toContain('客户管理');

  // 点了「取消」就该什么都没发生
  await expect(page.locator('body')).toContainText(leadCompany);

  pageErrors.assertClean();
});

test('lead create, search, detail edit, and follow-up preserve current UI contract', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const stamp = Date.now();
  const leadCompany = `E2E线索回归-${stamp}`;
  const updatedCompany = `${leadCompany}-已编辑`;
  const contactName = `回归联系人-${stamp}`;
  const followUpText = `回归跟进-${stamp}`;
  const expectLeadApi = process.env.VITE_LEADS_API_ENABLED === '1';
  const expectLeadApiRead = process.env.VITE_LEADS_API_READ_ENABLED === '1';
  const expectLeadApiVerify = process.env.VITE_LEADS_API_VERIFY_WRITES_ENABLED === '1';
  let leadApiReads = 0;
  let leadApiReadbacks = 0;
  let leadApiWrites = 0;

  await page.route('**/api/leads**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'GET') {
      leadApiReads += 1;
      if (/\/api\/leads\/[^/?#]+/.test(url)) {
        leadApiReadbacks += 1;
      }
    }
    if (['POST', 'PATCH'].includes(method)) {
      leadApiWrites += 1;
    }
    await route.continue();
  });

  await page.route('**/api/state/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: 0, message: 'e2e state sync intercepted', data: { written: 0 } })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#/leads');
  await expect(page.locator('body')).toContainText('线索公海');
  await expect(page.getByRole('button', { name: /筛出重点线索/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /新增线索/ })).toBeVisible();
  await expect(page.getByPlaceholder('搜索线索…')).toBeVisible();
  if (expectLeadApiRead) {
    await expect.poll(() => leadApiReads).toBeGreaterThanOrEqual(1);
  }

  await page.getByRole('button', { name: /新增线索/ }).click();
  const createLeadForm = page.locator('form').filter({ hasText: '保存线索' });
  await expect(createLeadForm).toContainText('客户名称');
  await expect(createLeadForm).toContainText('联系人');
  /*
    2026-09-18 按术语表改名：同一个 mobile 字段，新建叫「手机号」、
    编辑叫「联系电话」，而编辑页本来就允许座机 —— 字段排查 A06。
    统一成「联系电话（手机或座机）」，口径在 src/modules/labels.ts 的 FIELD。
  */
  await expect(createLeadForm).toContainText('联系电话');
  await createLeadForm.locator('input').nth(0).fill(leadCompany);
  await createLeadForm.locator('input').nth(1).fill(contactName);
  await createLeadForm.locator('input').nth(2).fill('13800000000');
  await createLeadForm.getByRole('button', { name: /保存线索/ }).click();

  await page.getByPlaceholder('搜索线索…').fill(leadCompany);
  await expect(page.locator('body')).toContainText(leadCompany);
  await expect(page.locator('body')).toContainText(contactName);

  await page.locator('tr').filter({ hasText: leadCompany }).click();
  const detail = page.locator('div.fixed.inset-0').filter({ hasText: 'AI 商机洞察' }).filter({ hasText: '跟进记录' });
  await expect(detail).toContainText('AI 商机洞察');
  await expect(detail).toContainText('基本信息');
  await expect(detail).toContainText('工商注册信息');
  await expect(detail).toContainText('跟进记录');
  // 「生成跟进项目」2026-09-09 已删（会自动建项目并锁死线索）。
  // 线索详情里真正的下一步是「转为客户」。
  await expect(detail.getByRole('button', { name: /转为客户/ })).toBeVisible();

  await detail.getByRole('button', { name: /^编辑$/ }).click();
  await detail.locator('input').first().fill(updatedCompany);
  await detail.getByRole('button', { name: /保存/ }).click();
  await expect(detail).toContainText(updatedCompany);

  const followUpInput = detail.getByPlaceholder('输入今日沟通重点...');
  await followUpInput.fill(followUpText);
  await followUpInput.locator('xpath=..').locator('button').last().click();
  await expect(detail).toContainText(followUpText);

  if (expectLeadApi) {
    await expect.poll(() => leadApiWrites).toBeGreaterThanOrEqual(3);
  }
  if (expectLeadApiVerify) {
    await expect.poll(() => leadApiReadbacks).toBeGreaterThanOrEqual(3);
  }

  pageErrors.assertClean();
});

test('customer create, search, detail edit, and follow-up preserve current UI contract', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const stamp = Date.now();
  const customerName = `E2E客户回归-${stamp}`;
  const updatedCustomerName = `${customerName}-已编辑`;
  const contactName = `客户联系人-${stamp}`;
  const followUpText = `客户跟进-${stamp}`;
  const expectCustomerApi = process.env.VITE_CUSTOMERS_API_ENABLED === '1';
  const expectCustomerApiRead = process.env.VITE_CUSTOMERS_API_READ_ENABLED === '1';
  const expectCustomerApiVerify = process.env.VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED === '1';
  let customerApiReads = 0;
  let customerApiReadbacks = 0;
  let customerApiWrites = 0;

  await page.route('**/api/customers**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'GET') {
      customerApiReads += 1;
      if (/\/api\/customers\/[^/?#]+/.test(url)) {
        customerApiReadbacks += 1;
      }
    }
    if (['POST', 'PATCH'].includes(method)) {
      customerApiWrites += 1;
    }
    await route.continue();
  });

  await page.route('**/api/state/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: 0, message: 'e2e state sync intercepted', data: { written: 0 } })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#/customers');
  await expect(page.locator('body')).toContainText('客户管理');
  await expect(page.getByRole('button', { name: /新建客户/ })).toBeVisible();
  await expect(page.getByPlaceholder('搜索客户…')).toBeVisible();
  if (expectCustomerApiRead) {
    await expect.poll(() => customerApiReads).toBeGreaterThanOrEqual(1);
  }

  await page.getByRole('button', { name: /新建客户/ }).click();
  const detail = page.locator('div.fixed.inset-0').filter({ hasText: '客户关系档案' }).filter({ hasText: '跟进记录' });
  await expect(detail.getByPlaceholder(CUSTOMER_NAME_PLACEHOLDER)).toBeVisible();
  await expect(detail).toContainText('联系人与电话');
  await expect(detail.getByPlaceholder('联系人姓名')).toBeVisible();
  await expect(detail.getByPlaceholder('手机号/电话')).toBeVisible();

  await detail.getByPlaceholder(CUSTOMER_NAME_PLACEHOLDER).fill(customerName);
  await detail.getByPlaceholder('联系人姓名').first().fill(contactName);
  await detail.getByPlaceholder('手机号/电话').first().fill('13900000000');
  await detail.getByRole('button', { name: /保存/ }).click();

  await page.getByPlaceholder('搜索客户…').fill(customerName);
  await expect(page.locator('body')).toContainText(customerName);
  await expect(page.locator('body')).toContainText(contactName);

  await page.locator('tr').filter({ hasText: customerName }).click();
  const reopenedDetail = page.locator('div.fixed.inset-0').filter({ hasText: '客户关系档案' }).filter({ hasText: '跟进记录' });
  await expect(reopenedDetail).toContainText(customerName);
  await expect(reopenedDetail).toContainText('客户关系档案');
  await expect(reopenedDetail).toContainText('联系人与电话');
  await expect(reopenedDetail).toContainText('工商主体信息');
  await expect(reopenedDetail.getByRole('button', { name: /新建合同/ }).first()).toBeVisible();
  /*
    「生成跟进项目」**2026-09-09 被刻意删掉了** —— 它会在没人点任何按钮的情况下
    偷偷建项目，线上 15 个假项目就是这么来的（见 CLAUDE.md「提醒就是提醒」）。
    替代它的是「排跟进提醒」：只排 30/15/7 天三条提醒，不建任何项目。

    线索那条测试当时改了，客户这条漏了 —— 于是这条 e2e 一直在断言
    「那个被删掉的按钮必须存在」。tests/project-category.test.js 已经在
    源码层面钉住了文案，这里跟它对齐。
  */
  await expect(reopenedDetail.getByRole('button', { name: /排跟进提醒/ })).toBeVisible();

  await reopenedDetail.getByRole('button', { name: /编辑/ }).click();
  await reopenedDetail.getByPlaceholder(CUSTOMER_NAME_PLACEHOLDER).fill(updatedCustomerName);
  await reopenedDetail.getByRole('button', { name: /保存/ }).click();
  await expect(reopenedDetail).toContainText(updatedCustomerName);

  const followUpInput = reopenedDetail.getByPlaceholder('输入跟进情况...');
  await followUpInput.fill(followUpText);
  await followUpInput.press('Enter');
  await expect(reopenedDetail).toContainText(followUpText);

  if (expectCustomerApi) {
    await expect.poll(() => customerApiWrites).toBeGreaterThanOrEqual(3);
  }
  if (expectCustomerApiVerify) {
    await expect.poll(() => customerApiReadbacks).toBeGreaterThanOrEqual(3);
  }

  pageErrors.assertClean();
});
