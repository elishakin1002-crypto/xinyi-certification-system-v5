const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.cwd();
const employeeManagementActions = [
  'EMPLOYEE_VIEW',
  'EMPLOYEE_CREATE',
  'EMPLOYEE_UPDATE',
  'EMPLOYEE_UPDATE_ROLE',
  'EMPLOYEE_DISABLE',
  'EMPLOYEE_RESET_PASSWORD',
  'AUTH_AUDIT_VIEW'
];

const parseFile = (relativePath, scriptKind = ts.ScriptKind.TS) => {
  const filePath = path.join(root, relativePath);
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
};

const propName = (name) => {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return '';
};

const getVariableInitializer = (sourceFile, variableName) => {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      found = node.initializer || null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const unwrapObjectFreeze = (node) => {
  if (
    node &&
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText() === 'Object' &&
    node.expression.name.text === 'freeze'
  ) {
    return node.arguments[0] || null;
  }
  return node;
};

const stringArrayValues = (node) => {
  const target = unwrapObjectFreeze(node);
  if (!target || !ts.isArrayLiteralExpression(target)) return [];
  return target.elements
    .filter(ts.isStringLiteral)
    .map((item) => item.text);
};

const collectActionCodeUnion = () => {
  const sourceFile = parseFile('types.ts');
  let actions = [];
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'ActionCode') {
      const collect = (typeNode) => {
        if (ts.isUnionTypeNode(typeNode)) {
          typeNode.types.forEach(collect);
          return;
        }
        if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
          actions.push(typeNode.literal.text);
        }
      };
      collect(node.type);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return actions;
};

const collectRoleCapabilityActions = () => {
  const sourceFile = parseFile('constants.ts');
  const initializer = unwrapObjectFreeze(getVariableInitializer(sourceFile, 'ROLE_CAPABILITIES'));
  assert.ok(initializer && ts.isObjectLiteralExpression(initializer), 'ROLE_CAPABILITIES must be an object literal');

  const result = {};
  for (const roleProp of initializer.properties) {
    if (!ts.isPropertyAssignment(roleProp) || !ts.isObjectLiteralExpression(roleProp.initializer)) continue;
    const role = propName(roleProp.name);
    const actionsProp = roleProp.initializer.properties.find(
      (item) => ts.isPropertyAssignment(item) && propName(item.name) === 'actions'
    );
    result[role] = actionsProp && ts.isPropertyAssignment(actionsProp)
      ? stringArrayValues(actionsProp.initializer)
      : [];
  }
  return result;
};

const collectServerAuthActions = () => {
  const sourceFile = parseFile('server/app.js', ts.ScriptKind.JS);
  return stringArrayValues(getVariableInitializer(sourceFile, 'AUTH_MANAGEMENT_ACTIONS'));
};

/*
  2026-09-04：AUTH_ACTIONS_BY_ROLE 不再是硬编码的对象字面量，
  改成从权限矩阵推导（原来是第三份手抄的角色名单，加总助权限时差点漏掉）。
  所以这里也不能再用 AST 去读字面量，改成直接算一遍推导结果。
*/
const collectServerAuthActionsByRole = () => {
  const { loadCapabilities } = require('../server/authz/authorize');
  const caps = loadCapabilities() || {};
  const out = {};
  for (const [role, conf] of Object.entries(caps)) {
    const owned = new Set(Array.from(conf?.actions || []));
    out[role] = employeeManagementActions.filter((a) => owned.has(a));
  }
  return out;
};

test('permission contract: every role capability action is declared in ActionCode', () => {
  const declaredActions = new Set(collectActionCodeUnion());
  const roleActions = collectRoleCapabilityActions();
  const usedActions = Object.values(roleActions).flat();
  const undeclared = usedActions.filter((action) => !declaredActions.has(action));

  assert.deepEqual(undeclared, []);
});

test('permission contract: 账号管理只给总经理、总助、系统管理员', () => {
  /*
    2026-09-04 改。原来的约定是「只给 ADMIN」，写这条时的理由是
    账号管理危险、收紧最安全。

    但实际上新人入职开号、离职停用、忘记密码重置，在信义就是总助干的活。
    她一项权限都没有的结果不是「更安全」，是**每次都来找老板或系统管理员**，
    而老板在外面跑业务 —— 于是密码就在微信上传了。
    权限设计要对着真实工作流，不然人会绕过它。

    唯独不给她 EMPLOYEE_UPDATE_ROLE：改角色能给自己加 ADMIN，
    一个动作就把「管资料不碰钱」的边界抹掉。
  */
  const roleActions = collectRoleCapabilityActions();
  const declaredActions = new Set(collectActionCodeUnion());

  for (const action of employeeManagementActions) {
    assert.equal(declaredActions.has(action), true, `${action} must be declared in ActionCode`);
    assert.equal(roleActions.ADMIN.includes(action), true, `${action} must be granted to ADMIN`);
    assert.equal(roleActions.SYS_ADMIN.includes(action), true, `${action} 也要给系统管理员`);
  }

  // 总助：除了改角色，其余都有
  for (const action of employeeManagementActions) {
    const expected = action !== 'EMPLOYEE_UPDATE_ROLE';
    assert.equal(roleActions.MANAGER.includes(action), expected,
      expected ? `总助应该有 ${action}` : '总助有了改角色权限就能给自己加 ADMIN');
  }

  // 顾问、销售、财务：一项都不该有
  for (const role of ['CONSULTANT', 'FINANCE', 'SALES']) {
    const leaked = employeeManagementActions.filter((action) => roleActions[role]?.includes(action));
    assert.deepEqual(leaked, [], `${role} 不该有任何账号管理权限`);
  }
});

test('permission contract: 后端账号管理权限必须和权限矩阵一致', () => {
  /*
    这里曾经是第三份手抄的角色名单。只改 constants.ts 而漏掉它的结果是
    **菜单看得见、每个请求 403** —— 跟「后端放行前端拦着」是同一个病，
    方向反过来而已。现在改成推导，这条测试盯着推导结果别跑偏。
  */
  const serverActions = collectServerAuthActions();
  assert.deepEqual(new Set(serverActions), new Set(employeeManagementActions));

  const byRole = collectServerAuthActionsByRole();
  assert.equal(byRole.ADMIN.length, employeeManagementActions.length, '总经理应有全套');
  assert.equal(byRole.SYS_ADMIN.length, employeeManagementActions.length, '系统管理员应有全套');
  assert.ok(byRole.MANAGER.includes('EMPLOYEE_CREATE'), '总助应该能开号');
  assert.ok(!byRole.MANAGER.includes('EMPLOYEE_UPDATE_ROLE'), '总助不该能改角色');
  for (const role of ['CONSULTANT', 'FINANCE', 'SALES']) {
    assert.deepEqual(byRole[role], [], `${role} 不该有账号管理权限`);
  }
});

test('permission contract: 推导失败时兜底方向是收紧', () => {
  /*
    权限的兜底方向永远是收紧。
    宁可总助暂时开不了号来问一句，也不能因为解析失败把权限敞开。
  */
  const source = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
  const block = source.slice(source.indexOf('const AUTH_ACTIONS_BY_ROLE'),
                            source.indexOf('const hasAuthManagementAction'));
  assert.match(block, /const fallback = \(\) => Object\.freeze\(\{[\s\S]*?MANAGER: new Set\(\)/,
    '兜底里总助不该有账号管理权限');
  assert.match(block, /throw new Error\('ADMIN 没拿到全套/,
    '解析出空表时没有报错，会静默把所有人的权限清空');
});

test('permission contract: delegated employee actions cannot manage ADMIN accounts', () => {
  const source = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
  const helperIndex = source.indexOf('const rejectIfTouchingPrivilegedAccount');
  assert.ok(helperIndex >= 0, 'server must define ADMIN target protection helper');

  const updateRouteIndex = source.indexOf("app.patch('/api/auth/users/:id'");
  const updateCallIndex = source.indexOf('updateUser(req.params.id', updateRouteIndex);
  const updateGuardIndex = source.indexOf('rejectIfTouchingPrivilegedAccount', updateRouteIndex);
  assert.ok(updateRouteIndex >= 0, 'update user route must exist');
  assert.ok(updateGuardIndex > updateRouteIndex, 'update user route must check ADMIN target protection');
  assert.ok(updateGuardIndex < updateCallIndex, 'update user route must check ADMIN target before updateUser');

  const resetRouteIndex = source.indexOf("app.post('/api/auth/users/:id/reset-password'");
  const resetCallIndex = source.indexOf('resetUserPassword(req.params.id', resetRouteIndex);
  const resetGuardIndex = source.indexOf('rejectIfTouchingPrivilegedAccount', resetRouteIndex);
  assert.ok(resetRouteIndex >= 0, 'reset password route must exist');
  assert.ok(resetGuardIndex > resetRouteIndex, 'reset password route must check ADMIN target protection');
  assert.ok(resetGuardIndex < resetCallIndex, 'reset password route must check ADMIN target before resetUserPassword');
});
