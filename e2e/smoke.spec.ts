import { expect, Page, test } from '@playwright/test';

const ignoredConsolePatterns = [
  /favicon/i,
  /cdn\.tailwindcss\.com/i,
  /cdn.*source map/i,
  /Failed to load resource/i
];

const ignoredRequestHosts = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

const collectPageErrors = (page: Page) => {
  const consoleErrors: string[] = [];
  const failedLocalRequests: string[] = [];

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
    { path: '/#/projects', title: '交付工作台' },
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
  await form.getByRole('button', { name: /确认立项/ }).click();

  if (expectProjectsApiWrite) {
    await expect.poll(() => projectsApiWrites).toBeGreaterThanOrEqual(1);
  }
  await expect(page.locator('body')).toContainText(projectName);

  await page.getByPlaceholder('搜索项目...').fill(projectName);
  await page.locator('tr').filter({ hasText: projectName }).click();
  const expandedProject = page.locator('tr').filter({ hasText: '交付任务流水线' });

  await expandedProject.getByRole('button', { name: /添加服务项/ }).click();
  await expandedProject.getByPlaceholder('如：ISO9001 / 高新技术企业 / SC 食品生产许可').fill('ISO9001');
  await expandedProject.getByRole('button', { name: /确认添加/ }).click();
  if (expectProjectsApiWrite) {
    await expect.poll(() => sawServiceItemTransaction).toBe(true);
  }

  await expandedProject.locator('button').filter({ has: page.locator('div.w-5.h-5.rounded-full') }).first().click();
  if (expectProjectsApiWrite) {
    await expect.poll(() => projectTransactionWrites).toBeGreaterThanOrEqual(1);
    await expect.poll(() => sawTaskLogTransaction).toBe(true);
  }

  await expandedProject.getByRole('button', { name: /补录金额/ }).click();
  const costModal = page.locator('.fixed').filter({ hasText: '项目费用补录' });
  await costModal.locator('input[type="number"]').fill('12000');
  await costModal.getByRole('button', { name: /确认并锁定/ }).click();
  await page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await expandedProject.getByRole('button', { name: /标记完成/ }).click();
  if (expectProjectsApiWrite) {
    await expect.poll(() => sawCompletionTransaction).toBe(true);
  }
  await page.getByRole('button', { name: /全部项目/ }).first().click();
  await page.getByPlaceholder('搜索项目...').fill(projectName);
  const projectRow = page.locator('tr').filter({ hasText: projectName }).first();
  const reopenButton = page.getByRole('button', { name: /重新打开项目/ }).first();
  if (await reopenButton.count() === 0) {
    await projectRow.click();
  }
  await page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await reopenButton.click();
  if (expectProjectsApiWrite) {
    await expect.poll(() => sawReopenTransaction).toBe(true);
  }

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

  const form = page.locator('form');
  await form.locator('input[type="text"]').nth(0).fill(contractTitle);
  await form.locator('input[type="text"]').nth(1).fill(contractNo);
  await form.locator('input[type="text"]').nth(2).fill(customerName);
  await form.locator('input[type="text"]').nth(3).fill(contactName);
  await form.locator('input[type="text"]').nth(4).fill('ISO 9001 认证服务');
  await form.locator('input[type="number"]').nth(0).fill('12000');
  await form.locator('input[type="text"]').nth(5).fill('分期付款');

  await form.getByRole('button', { name: /添加款项节点/ }).click();
  await form.locator('input[type="text"]').nth(6).fill(receivableNode);
  await form.locator('input[type="number"]').nth(1).fill('12000');
  await form.locator('input[type="date"]').nth(1).fill('2026-05-20');

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
  await expect(page.locator('body')).toContainText('交付项目');

  await page.goto('/#/finance');
  await expect(page.locator('body')).toContainText(customerName);
  await expect(page.locator('body')).toContainText(receivableNode);
  const receivableRow = page.locator('tr').filter({ hasText: customerName }).filter({ hasText: receivableNode });
  await receivableRow.getByRole('button', { name: /确认到账/ }).click();
  if (expectContractsApiWrite) {
    await expect.poll(() => contractTransactionWrites).toBeGreaterThanOrEqual(2);
  }
  await expect(receivableRow).toContainText('已核销');

  pageErrors.assertClean();
});

test('lead can be converted into a follow-up project', async ({ page }) => {
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
  await page.getByRole('button', { name: /生成跟进项目/ }).click();

  await expect(page.locator('body')).toContainText(leadCompany);
  await expect(page.locator('body')).toContainText('跟进项目');

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
  await expect(page.getByPlaceholder('搜索线索...')).toBeVisible();
  if (expectLeadApiRead) {
    await expect.poll(() => leadApiReads).toBeGreaterThanOrEqual(1);
  }

  await page.getByRole('button', { name: /新增线索/ }).click();
  const createLeadForm = page.locator('form').filter({ hasText: '保存线索' });
  await expect(createLeadForm).toContainText('客户名称');
  await expect(createLeadForm).toContainText('联系人');
  await expect(createLeadForm).toContainText('手机号');
  await createLeadForm.locator('input').nth(0).fill(leadCompany);
  await createLeadForm.locator('input').nth(1).fill(contactName);
  await createLeadForm.locator('input').nth(2).fill('13800000000');
  await createLeadForm.getByRole('button', { name: /保存线索/ }).click();

  await page.getByPlaceholder('搜索线索...').fill(leadCompany);
  await expect(page.locator('body')).toContainText(leadCompany);
  await expect(page.locator('body')).toContainText(contactName);

  await page.locator('tr').filter({ hasText: leadCompany }).click();
  const detail = page.locator('div.fixed.inset-0').filter({ hasText: 'AI 商机洞察' }).filter({ hasText: '跟进记录' });
  await expect(detail).toContainText('AI 商机洞察');
  await expect(detail).toContainText('基本信息');
  await expect(detail).toContainText('工商注册信息');
  await expect(detail).toContainText('跟进记录');
  await expect(detail.getByRole('button', { name: /生成跟进项目/ })).toBeVisible();

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
  await expect(page.getByPlaceholder('搜索客户...')).toBeVisible();
  if (expectCustomerApiRead) {
    await expect.poll(() => customerApiReads).toBeGreaterThanOrEqual(1);
  }

  await page.getByRole('button', { name: /新建客户/ }).click();
  const detail = page.locator('div.fixed.inset-0').filter({ hasText: '客户关系档案' }).filter({ hasText: '跟进记录' });
  await expect(detail.getByPlaceholder('请输入客户名称')).toBeVisible();
  await expect(detail).toContainText('联系人与电话');
  await expect(detail.getByPlaceholder('联系人姓名')).toBeVisible();
  await expect(detail.getByPlaceholder('手机号/电话')).toBeVisible();

  await detail.getByPlaceholder('请输入客户名称').fill(customerName);
  await detail.getByPlaceholder('联系人姓名').first().fill(contactName);
  await detail.getByPlaceholder('手机号/电话').first().fill('13900000000');
  await detail.getByRole('button', { name: /保存/ }).click();

  await page.getByPlaceholder('搜索客户...').fill(customerName);
  await expect(page.locator('body')).toContainText(customerName);
  await expect(page.locator('body')).toContainText(contactName);

  await page.locator('tr').filter({ hasText: customerName }).click();
  const reopenedDetail = page.locator('div.fixed.inset-0').filter({ hasText: '客户关系档案' }).filter({ hasText: '跟进记录' });
  await expect(reopenedDetail).toContainText(customerName);
  await expect(reopenedDetail).toContainText('客户关系档案');
  await expect(reopenedDetail).toContainText('联系人与电话');
  await expect(reopenedDetail).toContainText('工商主体信息');
  await expect(reopenedDetail.getByRole('button', { name: /新建合同/ }).first()).toBeVisible();
  await expect(reopenedDetail.getByRole('button', { name: /生成跟进项目/ })).toBeVisible();

  await reopenedDetail.getByRole('button', { name: /编辑/ }).click();
  await reopenedDetail.getByPlaceholder('请输入客户名称').fill(updatedCustomerName);
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
