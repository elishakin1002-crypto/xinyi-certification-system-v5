import { expect, test } from '@playwright/test';

test('auth-required mode redirects to login and signs in with seeded employee', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('xinyi_auth_required', '1');
  });

  await page.goto('/#/dashboard');
  await expect(page.locator('body')).toContainText('员工登录');

  await page.getByPlaceholder('员工邮箱或账号').fill('admin@xinyi-iso.local');
  await page.getByPlaceholder('请输入密码').fill('local-test-password');
  await page.getByRole('button', { name: /登录/ }).click();

  await expect(page.locator('body')).toContainText('工作台');
  await expect(page.locator('body')).toContainText('系统管理员');

  await page.getByRole('button', { name: '身份：系统管理员' }).click();
  await expect(page.getByText('切换当前用户')).toHaveCount(0);
});

test('admin can open employee accounts page and create an employee account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('xinyi_auth_required', '1');
  });

  const stamp = Date.now();
  const employeeName = `E2E员工-${stamp}`;
  const employeeEmail = `employee-${stamp}@example.test`;
  const employeeUsername = `employee-${stamp}`;

  await page.goto('/#/employees');
  await page.getByPlaceholder('员工邮箱或账号').fill('admin@xinyi-iso.local');
  await page.getByPlaceholder('请输入密码').fill('local-test-password');
  await page.getByRole('button', { name: /登录/ }).click();

  await expect(page.getByRole('link', { name: /员工账号/ })).toBeVisible();
  await page.getByRole('link', { name: /员工账号/ }).click();
  await expect(page.locator('body')).toContainText('员工账号');

  await page.getByRole('button', { name: /新建员工/ }).click();
  await page.getByLabel('姓名').fill(employeeName);
  await page.getByLabel('邮箱').fill(employeeEmail);
  await page.getByLabel('账号').fill(employeeUsername);
  await page.getByLabel('临时密码').fill('employee-pass-123');
  await page.getByLabel('岗位标签').fill('测试员工');
  await page.getByRole('button', { name: /^保存$/ }).click();

  await expect(page.locator('body')).toContainText('员工账号已创建');
  await expect(page.locator('body')).toContainText(employeeName);
  await expect(page.locator('body')).toContainText(employeeEmail);
  await expect(page.locator('body')).toContainText('需改密');
  await expect(page.getByRole('link', { name: /审计日志/ })).toBeVisible();
  await page.getByRole('link', { name: /审计日志/ }).click();
  await expect(page.locator('body')).toContainText('审计日志');
  await expect(page.locator('body')).toContainText('创建员工');
  await expect(page.locator('body')).toContainText(employeeName);

  await page.context().clearCookies();
  await page.reload();
  await expect(page.locator('body')).toContainText('员工登录');
  await page.getByPlaceholder('员工邮箱或账号').fill(employeeEmail);
  await page.getByPlaceholder('请输入密码').fill('employee-pass-123');
  await page.getByRole('button', { name: /登录/ }).click();

  await expect(page.locator('body')).toContainText('首次登录修改密码');
  await page.getByLabel('当前密码').fill('employee-pass-123');
  await page.getByLabel('新密码', { exact: true }).fill('employee-final-123');
  await page.getByLabel('确认新密码').fill('employee-final-123');
  await page.getByRole('button', { name: /保存新密码/ }).click();

  await expect(page.locator('body')).toContainText('工作台');
  await expect(page.locator('body')).toContainText(employeeName);
});
