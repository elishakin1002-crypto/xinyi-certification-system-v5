// 「员工账号」和「审计日志」这两个入口该给谁。
//
// 结论：**总经理、总助、系统管理员**三个人。
// 顾问、销售、财务看不到 —— 他们既不开号也不查登录记录，
// 多一个看得见却点不动的入口，只会让人以为自己权限被砍了。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

const capabilities = () => {
  const { loadCapabilities } = require('../server/authz/authorize');
  const c = loadCapabilities();
  const has = (role, action) => Array.from(c[role]?.actions || []).includes(action);
  return { has };
};

test('账号管理和审计日志只给三个角色', () => {
  const { has } = capabilities();
  for (const r of ['ADMIN', 'SYS_ADMIN', 'MANAGER']) {
    assert.ok(has(r, 'EMPLOYEE_VIEW'), `${r} 应该能看员工账号`);
    assert.ok(has(r, 'AUTH_AUDIT_VIEW'), `${r} 应该能看审计日志`);
  }
  for (const r of ['SALES', 'CONSULTANT', 'FINANCE']) {
    assert.ok(!has(r, 'EMPLOYEE_VIEW'), `${r} 不该看到员工账号`);
    assert.ok(!has(r, 'AUTH_AUDIT_VIEW'), `${r} 不该看到审计日志`);
  }
});

test('总助能开号能重置密码，但不能改角色', () => {
  /*
    改角色能给自己加 ADMIN —— 一个动作就把「管资料不碰钱」的边界抹掉。
    角色调整是低频事，让她多问一句的成本，远小于权限失控。
  */
  const { has } = capabilities();
  for (const a of ['EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'EMPLOYEE_DISABLE', 'EMPLOYEE_RESET_PASSWORD']) {
    assert.ok(has('MANAGER', a), `总助应该有 ${a}`);
  }
  assert.ok(!has('MANAGER', 'EMPLOYEE_UPDATE_ROLE'),
    '总助有了改角色权限就能给自己加 ADMIN');
});

test('改角色和单项委派走同一道闸', () => {
  // 给一个 PAYMENT_CONFIRM 就等于把确认到账的权力给出去，不比换角色轻
  const app = read('server/app.js');
  const fn = app.slice(app.indexOf('const resolveEmployeeUpdatePermissionActions'),
                       app.indexOf('const resolveEmployeeUpdatePermissionActions') + 900);
  for (const f of ['roles', 'activeRole', 'extraActions', 'deniedActions']) {
    assert.ok(fn.includes(f), `${f} 没被算进 EMPLOYEE_UPDATE_ROLE`);
  }
});

test('高权账号只有同级能动 —— 而且 SYS_ADMIN 也算高权', () => {
  /*
    这是给总助开权限时开出来的提权路径：
    她重置总经理的密码，然后用新密码登进去 —— 权限矩阵拦不住，
    因为「重置密码」这个动作本来就是给她的，问题出在「对谁做」。

    原来的守卫只认 ADMIN。而系统管理员账号（金恩来）的角色是 SYS_ADMIN、
    一个 ADMIN 都没有 —— 旧规则下总助能重置权限最大那个账号的密码。
  */
  const app = read('server/app.js');
  assert.match(app, /const PRIVILEGED_ROLES = \['ADMIN', 'SYS_ADMIN'\]/,
    'SYS_ADMIN 没被算成高权账号');
  assert.match(app, /const rejectIfTouchingPrivilegedAccount/, '没有高权账号守卫');

  // 三个会改到别人账号的路由都要挡：改资料、重置密码、删除
  const calls = app.match(/rejectIfTouchingPrivilegedAccount\(res,/g) || [];
  assert.ok(calls.length >= 3, `只有 ${calls.length} 处路由挡了高权账号，改资料/重置密码/删除都要挡`);

  const del = app.slice(app.indexOf("app.delete('/api/auth/users/:id'"),
                        app.indexOf("app.delete('/api/auth/users/:id'") + 1400);
  assert.match(del, /rejectIfTouchingPrivilegedAccount/, '删除路由没挡高权账号');
});

test('拒绝提示是中文，而且说清为什么', () => {
  // 总助看到 "Only ADMIN can reset password for ADMIN accounts" 只会来问这是什么意思
  const app = read('server/app.js');
  const fn = app.slice(app.indexOf('const rejectIfTouchingPrivilegedAccount'),
                       app.indexOf('const rejectIfTouchingPrivilegedAccount') + 700);
  assert.match(fn, /总经理／系统管理员的账号/, '提示没说清挡的是什么');
  assert.match(fn, /登进去/, '没说明为什么要挡 —— 只说不许，人会觉得是系统小气');
});

test('侧边栏这两项跟着预览视角变，不再写死角色名单', () => {
  /*
    2026-09-04 反馈：「所有视角都能看到员工账号和审计日志」。

    真实权限其实没漏 —— 顾问登进来是看不到的。
    漏的是**巡检视角**：其他每一项都是 hasPermission && inView 双闸，
    只有这两项直接读 currentUser.roles，切到「顾问视角」照样显示。
    而巡检功能存在的意义就是确认「同事看到什么」，它给出的是假答案。

    顺带把写死的角色名单去掉：权限矩阵里已经有 EMPLOYEE_VIEW 了，
    这里再列一份角色，加总助权限时就得记得回来改 —— 没人会记得。
  */
  // 注释里会引用旧写法说明为什么改，所以只看代码
  const src = read('components/Sidebar.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /roles\.some\(/,
    '侧边栏又写死了一份角色名单');
  assert.match(src, /const actionInView = \(action: ActionCode\)/,
    '没有动作版的视角判断');
  assert.match(src, /checkActionPermission\('EMPLOYEE_VIEW'\)\.allowed && actionInView\('EMPLOYEE_VIEW'\)/,
    '员工账号没做「真实权限 + 预览视角」双闸');
  assert.match(src, /checkActionPermission\('AUTH_AUDIT_VIEW'\)\.allowed && actionInView\('AUTH_AUDIT_VIEW'\)/,
    '审计日志没做双闸');
});

test('预览只会让菜单变少，不会变多', () => {
  /*
    双闸的顺序很重要：第一闸是真实权限，第二闸才是视角。
    顾问切到「总经理视角」仍然看不到员工账号，因为第一闸拦着。
  */
  const src = read('components/Sidebar.tsx');
  const line = src.match(/const canManageEmployees =[\s\S]{0,160}/)[0];
  assert.ok(line.indexOf('checkActionPermission') < line.indexOf('actionInView'),
    '真实权限必须是第一道闸');
});

test('页面里也不再列角色名单', () => {
  // 这里先后写错过两次：先漏了系统管理员，改完又要为总助再改一遍
  for (const [file, action] of [['pages/Employees.tsx', 'EMPLOYEE_VIEW'],
                                ['pages/AuthAuditLogs.tsx', 'AUTH_AUDIT_VIEW']]) {
    const src = read(file);
    assert.doesNotMatch(src, /roles\.some\(\(r\) => r === 'ADMIN'/, `${file} 还写死着角色`);
    assert.match(src, new RegExp(`checkActionPermission\\('${action}'\\)\\.allowed`),
      `${file} 没改成按动作判断`);
  }
});
