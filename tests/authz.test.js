// 授权判定回归测试。
//
// 这是**安全边界**，不是普通功能——改错了不会报错，只会悄悄放行本该拦下的操作。
// 所以口径必须钉在测试里：将来有人改 constants.ts 的角色配置，
// 这些用例会立刻告诉他改动的实际后果。
//
// 口径来源：业务方 2026-08-20 确认（见 docs/ai-agent-foundation-review.md 第七节）。
const test = require('node:test');
const assert = require('node:assert');
const { authorize, resolveScope } = require('../server/authz/authorize');

const sales = { id: 'U-S', name: '张销售', roles: ['SALES'] };
const cons = { id: 'U-C', name: '李顾问', roles: ['CONSULTANT'] };
const fin = { id: 'U-F', name: '王财务', roles: ['FINANCE'] };
const admin = { id: 'U-A', name: '老板', roles: ['ADMIN'] };
/*
  AI 视角判定。默认给一条**已存在**的资源：
  非新建动作拿不到资源 id 会被判成「服务端配置问题」而拒绝，
  那是路由解析器写错时的防线，不是这些用例要测的东西。
*/
const ai = (user, action, extra = {}) =>
  authorize({ user, action, viaAiAgent: true, resource: { id: 'R-1' }, ...extra });

test('销售：可看全部客户，只能改自己的', () => {
  assert.equal(resolveScope(sales, 'read'), 'ALL');
  assert.equal(resolveScope(sales, 'write'), 'OWN');
  assert.ok(authorize({ user: sales, action: 'PROJECT_VIEW', resource: { id: 'R-1', ownerUserId: 'U-OTHER' } }).allow);
  // 用 CUSTOMER_EDIT 而不是 CUSTOMER_CREATE：新建时客户还不存在，无从谈归属。
  // 这条用例原来拿建客户的码表达「改客户」，是因为当时**根本没有改客户的码**
  // ——正是 2026-08-21 补上的那个缺口。
  assert.ok(!authorize({ user: sales, action: 'CUSTOMER_EDIT', resource: { id: 'R-1', ownerUserId: 'U-OTHER' } }).allow);
  assert.ok(authorize({ user: sales, action: 'CUSTOMER_EDIT', resource: { id: 'R-1', ownerUserId: 'U-S' } }).allow);
});

test('顾问：可看全部项目，只能改自己参与的任务', () => {
  assert.ok(authorize({ user: cons, action: 'PROJECT_VIEW', resource: { id: 'R-1', ownerUserId: 'U-OTHER' } }).allow);
  assert.ok(!authorize({ user: cons, action: 'TASK_COMPLETE', resource: { id: 'R-1', ownerUserId: 'U-OTHER' } }).allow);
  // 多顾问协作：不是负责人但参与了，也算「自己的」——只看 ownerUserId 会漏掉这种
  assert.ok(authorize({
    user: cons, action: 'TASK_COMPLETE',
    resource: { id: 'R-1', ownerUserId: 'U-OTHER', participantUserIds: ['U-C'] },
  }).allow);
});

test('动作码越权被拦', () => {
  // 咨询师刻意没有看合同金额的权限，避免与客户议价、同事间比价
  assert.ok(!authorize({ user: cons, action: 'CONTRACT_VIEW_AMOUNT', resource: { id: 'R-1' } }).allow);
  assert.ok(!authorize({ user: sales, action: 'PAYMENT_CONFIRM', resource: { id: 'R-1', ownerUserId: 'U-S' } }).allow);
  assert.ok(authorize({ user: fin, action: 'PAYMENT_CONFIRM', resource: { id: 'R-1' } }).allow);
});

test('账号状态与显式拒绝', () => {
  assert.ok(!authorize({ user: { ...sales, accountExpiresAt: '2020-01-01' }, action: 'PROJECT_VIEW' }).allow);
  assert.ok(!authorize({ user: { ...fin, deniedActions: ['PAYMENT_CONFIRM'] }, action: 'PAYMENT_CONFIRM' }).allow);
});

test('AI 金额三档：1万内自主 / 1-5万确认 / 5万上仅建议', () => {
  const a = ai(admin, 'PAYMENT_CONFIRM', { amountFen: 800000 });
  assert.equal(a.aiLevel, 'L4'); assert.ok(a.allow); assert.ok(!a.requiresApproval);

  const b = ai(admin, 'PAYMENT_CONFIRM', { amountFen: 3000000 });
  assert.equal(b.aiLevel, 'L3'); assert.ok(b.allow); assert.ok(b.requiresApproval);

  const c = ai(admin, 'PAYMENT_CONFIRM', { amountFen: 8000000 });
  assert.equal(c.aiLevel, 'L2'); assert.ok(!c.allow);
});

test('L0 清单：凭证 / 工资 / 身份 / 权限变更 / 硬删除', () => {
  for (const action of ['EMPLOYEE_UPDATE_ROLE', 'TASK_DELETE', 'SETTLEMENT_MANAGE']) {
    const r = ai(admin, action);
    assert.equal(r.aiLevel, 'L0', action); assert.ok(!r.allow, action);
  }
  for (const type of ['voucher', 'payroll', 'identity', 'permission']) {
    const r = ai(admin, 'PROJECT_VIEW', { resource: { id: 'R-1', type } });
    assert.equal(r.aiLevel, 'L0', type); assert.ok(!r.allow, type);
  }
});

test('AI 只读操作不能被标成自主执行', () => {
  // 曾经的 bug：最终返回写死 'L4'，只读操作也被标成 L4，
  // Ledger 里就分不清「AI 看了一眼」和「AI 改了东西」
  const r = ai(admin, 'PROJECT_VIEW');
  assert.equal(r.aiLevel, 'L1');
  assert.ok(r.allow);
});

test('敏感数据 AI 最高只读', () => {
  const r = ai(admin, 'CUSTOMER_EDIT', { resource: { id: 'R-1', sensitivity: 'confidential' } });
  assert.equal(r.aiLevel, 'L1');
  assert.ok(!r.allow);
});

test('人直接操作不受 AI 分级限制', () => {
  const r = authorize({ user: admin, action: 'PAYMENT_CONFIRM', resource: { id: 'R-1' }, amountFen: 8000000 });
  assert.ok(r.allow);
  assert.equal(r.aiLevel, undefined);
});

test('每次判定都要给出 policy（Ledger 要靠它回答「凭什么」）', () => {
  for (const r of [
    authorize({ user: sales, action: 'CUSTOMER_EDIT', resource: { id: 'R-1', ownerUserId: 'U-OTHER' } }),
    authorize({ user: fin, action: 'PAYMENT_CONFIRM', resource: { id: 'R-1' } }),
    ai(admin, 'TASK_DELETE'),
  ]) {
    assert.ok(r.policy && r.policy.length > 0, JSON.stringify(r));
  }
});

/* ══════════════════════════════════════════════════════════════
   归属机制：线索认领 / 合同项目指派
   业务方 2026-08-21 确认。改这组用例等于改公司规矩。
   ══════════════════════════════════════════════════════════════ */

/*
  无主 = **这条记录存在，但没有负责人**，不是「记录不存在」。
  所以必须带 id：库里那 455 条线索每条都有 id，只是 owner_user_id 是空的。
  authorize() 对非新建动作、又拿不到 id 的情况会判定为「服务端配置问题」并拒绝
  （路由的 resource 解析器没把记录捞出来），那是另一回事。
*/
const 无主 = { id: 'X-1' };

test('线索无主时销售可以直接改，并且这次写入会认领', () => {
  const d = authorize({ user: sales, action: 'LEAD_EDIT', resource: { type: 'lead', ...无主 } });
  assert.ok(d.allow, '无主线索应当允许销售修改');
  assert.equal(d.claimsOwnership, true, '必须标记为认领，否则归属永远长不出来');
});

test('合同和项目无主时任何人都不能改，必须先指派', () => {
  // 用各自真实的场景：销售改合同、顾问在项目上完成任务
  // （不能拿销售去测项目——他没有项目动作码，会在动作码那一步就被拦，测不到归属逻辑）
  for (const [user, action, type] of [[sales, 'CONTRACT_EDIT', 'contract'],
                                      [cons, 'TASK_COMPLETE', 'project']]) {
    const d = authorize({ user, action, resource: { type, ...无主 } });
    assert.ok(!d.allow, `${type} 无主时不该允许直接修改`);
    assert.match(d.policy, /ownership\.unassigned/);
    assert.match(d.reason, /指派/, '提示要说「请先指派」，不能说「只能改自己的」——这条根本没有负责人');
  }
});

test('顾问没有线索认领权，无主线索也不能改', () => {
  // 顾问只有 CUSTOMER_EDIT，没有 LEAD_EDIT / LEAD_CLAIM
  const d = authorize({ user: cons, action: 'LEAD_EDIT', resource: { type: 'lead', ...无主 } });
  assert.ok(!d.allow);
});

test('销售不能指派归属——指派是管理动作', () => {
  assert.ok(!authorize({ user: sales, action: 'LEAD_ASSIGN_OWNER', resource: { type: 'lead', ...无主 } }).allow);
  assert.ok(authorize({ user: admin, action: 'LEAD_ASSIGN_OWNER', resource: { type: 'lead', ...无主 } }).allow);
});

test('合同归属由财务和老板指派，交付负责人不行', () => {
  const r = { type: 'contract', ...无主 };
  assert.ok(authorize({ user: fin, action: 'CONTRACT_ASSIGN_OWNER', resource: r }).allow);
  assert.ok(authorize({ user: admin, action: 'CONTRACT_ASSIGN_OWNER', resource: r }).allow);
  const mgr = { id: 'U-M', name: '交付主管', roles: ['MANAGER'] };
  assert.ok(!authorize({ user: mgr, action: 'CONTRACT_ASSIGN_OWNER', resource: r }).allow,
    '合同归属牵扯金额与提成，刻意不给 MANAGER');
});

test('已有主的线索，别人认领不走认领通道，按越权拦', () => {
  const d = authorize({ user: sales, action: 'LEAD_EDIT', resource: { id: 'R-1', type: 'lead', ownerUserId: 'U-OTHER' } });
  assert.ok(!d.allow);
  assert.match(d.policy, /scope:write=OWN/, '有主数据要走范围判定，不能被认领逻辑放行');
  assert.ok(!d.claimsOwnership);
});

test('未登记的资源类型默认按「必须指派」处理，不能自动可认领', () => {
  const d = authorize({ user: sales, action: 'LEAD_EDIT', resource: { type: '某个将来才有的类型', ...无主 } });
  assert.ok(!d.allow, '新资源类型忘了登记时必须从严，不能默认谁都能改');
});

test('读写方向判定是故障安全的：最危险的几个动作必须算写操作', () => {
  const { isWriteAction } = require('../server/authz/authorize');
  // 这几个曾因后缀正则不匹配被当成「读」，而所有角色 readScope=ALL，等于归属限制失效
  for (const a of ['EMPLOYEE_UPDATE_ROLE', 'EMPLOYEE_RESET_PASSWORD', 'WORKLOG_DELETE_ANY',
                   'PROJECT_EDIT_INFO', 'PROJECT_ASSIGN_MANAGER', 'LEAD_CLAIM', 'LEAD_ASSIGN_OWNER']) {
    assert.ok(isWriteAction(a), `${a} 必须判定为写操作`);
  }
  assert.ok(!isWriteAction('PROJECT_VIEW'));
  assert.ok(isWriteAction('SOME_BRAND_NEW_ACTION'), '没登记的动作码要默认当写操作（从严）');
});

test('管理员范围是 ALL，不受无主数据阻挡', () => {
  assert.ok(authorize({ user: admin, action: 'CONTRACT_EDIT', resource: { type: 'contract', ...无主 } }).allow);
});
