const test = require('node:test');
const assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/modules/onboarding/workspaceTour.ts'), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const output = { exports: {} };
new Function('module', 'exports', compiled)(output, output.exports);
const { getWorkspaceTour } = output.exports;

test('工作台概览覆盖六种岗位，不再把填单步骤塞进第一层', () => {
  for (const role of ['SYS_ADMIN', 'ADMIN', 'MANAGER', 'FINANCE', 'CONSULTANT', 'SALES']) {
    const tour = getWorkspaceTour([role]);
    assert.equal(tour.steps.length, 6);
    assert.ok(tour.steps.some(step => step.target === 'workspace-content'));
    assert.ok(tour.steps.every(step => !step.howTo && !step.howToMobile));
    assert.equal(tour.steps.at(-1).target, 'help');
    assert.match(tour.steps.at(-1).body, /认识我的工作台[\s\S]*了解当前模块[\s\S]*解释这一项/);
  }
});

test('多岗位沿用管理员优先规则，未知岗位不弹错误引导', () => {
  assert.equal(getWorkspaceTour(['SALES', 'SYS_ADMIN']), getWorkspaceTour(['SYS_ADMIN']));
  assert.equal(getWorkspaceTour(undefined), null);
  assert.equal(getWorkspaceTour([]), null);
  assert.equal(getWorkspaceTour(['UNKNOWN']), null);
  assert.equal(getWorkspaceTour(['FINANCE']).steps[4].target, 'nav-finance');
  assert.equal(getWorkspaceTour(['SYS_ADMIN']).steps[4].target, 'nav-employees');
});
