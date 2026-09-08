const test = require('node:test');
const assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
function load(file) {
 const compiled = transformSync(fs.readFileSync(path.join(__dirname, file), 'utf8'), {loader: 'ts', format: 'cjs'}).code;
 const result = {exports:{}};
 new Function('module', 'exports', compiled)(result, result.exports);
 return result.exports;
}
const {findPageGuide} = load('../src/modules/help/pageGuide.ts');
const {adaptPageGuide} = load('../src/modules/help/rolePageGuide.ts');
const guide = (route,role) => adaptPageGuide(route,findPageGuide(route),role);
test('相同工作台按六种岗位说明，而非所有人都学习总经理看板', () => {
 const roles = ['ADMIN','SYS_ADMIN','SALES','CONSULTANT','FINANCE','MANAGER'];
 assert.equal(new Set(roles.map(role => guide('/dashboard',role).what)).size, 6);
 for(const role of roles) assert.ok(guide('/dashboard',role).result);
});
test('项目帮助区分查看交付、执行交付和统筹工作', () => {
 assert.doesNotMatch(guide('/projects','SALES').order.join(''), /新建项目|更新任务/);
 assert.match(guide('/projects','CONSULTANT').order.join(''), /工作日志/);
 assert.match(guide('/projects','MANAGER').order.join(''), /新建项目/);
});
test('顾问结算子页面不能被当作客户回款教程', () => {
 const result = guide('/finance/settlements','FINANCE');
 assert.equal(result.title,'顾问结算');
 assert.doesNotMatch(result.order.join(''), /确认到账/);
 assert.ok(result.result && result.empty);
});
test('岗位上手常用模块都有完成后核对位置和空数据提示', () => {
 for(const route of ['/dashboard','/leads','/customers','/projects','/my-tasks','/contracts','/finance','/employees','/knowledge','/audit']) {
  const result=guide(route,'CONSULTANT');
  assert.ok(result.result && result.empty, route);
 }
 assert.equal(adaptPageGuide('/unknown',null,'SALES'), null);
});
