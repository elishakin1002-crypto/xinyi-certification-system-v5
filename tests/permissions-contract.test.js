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

const collectServerAuthRoleSetSizes = () => {
  const sourceFile = parseFile('server/app.js', ts.ScriptKind.JS);
  const initializer = unwrapObjectFreeze(getVariableInitializer(sourceFile, 'AUTH_ACTIONS_BY_ROLE'));
  assert.ok(initializer && ts.isObjectLiteralExpression(initializer), 'AUTH_ACTIONS_BY_ROLE must be an object literal');

  const result = {};
  for (const roleProp of initializer.properties) {
    if (!ts.isPropertyAssignment(roleProp)) continue;
    const role = propName(roleProp.name);
    const value = roleProp.initializer;
    if (!ts.isNewExpression(value) || value.expression.getText() !== 'Set') continue;
    result[role] = value.arguments ? value.arguments.length : 0;
  }
  return result;
};

test('permission contract: every role capability action is declared in ActionCode', () => {
  const declaredActions = new Set(collectActionCodeUnion());
  const roleActions = collectRoleCapabilityActions();
  const usedActions = Object.values(roleActions).flat();
  const undeclared = usedActions.filter((action) => !declaredActions.has(action));

  assert.deepEqual(undeclared, []);
});

test('permission contract: employee management actions are admin-only by default', () => {
  const roleActions = collectRoleCapabilityActions();
  const declaredActions = new Set(collectActionCodeUnion());

  for (const action of employeeManagementActions) {
    assert.equal(declaredActions.has(action), true, `${action} must be declared in ActionCode`);
    assert.equal(roleActions.ADMIN.includes(action), true, `${action} must be granted to ADMIN`);
  }

  for (const role of ['MANAGER', 'CONSULTANT', 'FINANCE']) {
    const leakedActions = employeeManagementActions.filter((action) => roleActions[role]?.includes(action));
    assert.deepEqual(leakedActions, [], `${role} must not receive employee management actions by default`);
  }
});

test('permission contract: backend auth guard action list matches employee management actions', () => {
  const serverActions = collectServerAuthActions();
  assert.deepEqual(new Set(serverActions), new Set(employeeManagementActions));

  const roleSetSizes = collectServerAuthRoleSetSizes();
  assert.equal(roleSetSizes.ADMIN, 1, 'ADMIN should receive AUTH_MANAGEMENT_ACTIONS');
  assert.equal(roleSetSizes.MANAGER, 0);
  assert.equal(roleSetSizes.CONSULTANT, 0);
  assert.equal(roleSetSizes.FINANCE, 0);
});

test('permission contract: delegated employee actions cannot manage ADMIN accounts', () => {
  const source = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
  const helperIndex = source.indexOf('const rejectIfNonAdminManagingAdmin');
  assert.ok(helperIndex >= 0, 'server must define ADMIN target protection helper');

  const updateRouteIndex = source.indexOf("app.patch('/api/auth/users/:id'");
  const updateCallIndex = source.indexOf('updateUser(req.params.id', updateRouteIndex);
  const updateGuardIndex = source.indexOf('rejectIfNonAdminManagingAdmin', updateRouteIndex);
  assert.ok(updateRouteIndex >= 0, 'update user route must exist');
  assert.ok(updateGuardIndex > updateRouteIndex, 'update user route must check ADMIN target protection');
  assert.ok(updateGuardIndex < updateCallIndex, 'update user route must check ADMIN target before updateUser');

  const resetRouteIndex = source.indexOf("app.post('/api/auth/users/:id/reset-password'");
  const resetCallIndex = source.indexOf('resetUserPassword(req.params.id', resetRouteIndex);
  const resetGuardIndex = source.indexOf('rejectIfNonAdminManagingAdmin', resetRouteIndex);
  assert.ok(resetRouteIndex >= 0, 'reset password route must exist');
  assert.ok(resetGuardIndex > resetRouteIndex, 'reset password route must check ADMIN target protection');
  assert.ok(resetGuardIndex < resetCallIndex, 'reset password route must check ADMIN target before resetUserPassword');
});
