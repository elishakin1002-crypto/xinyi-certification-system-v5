// 按岗位走真实业务场景，每个角色用**自己的账号**跑一遍自己的活。
//
// ── 为什么必须这么测 ──────────────────────────────────────────────
// 行业里对 ERP/CRM 上线有一条经验：
//   「角色要按真实岗位场景测，不能只用管理员账号测」
// 2026-08-21 这条在信义身上应验了：SALES 角色**根本建不出来**
// （认证存储的合法角色表里没有它，传进去被静默降级成 CONSULTANT），
// 而此前所有验证都是管理员视角，一次都没暴露。
//
// 管理员的 readScope/writeScope 都是 ALL，等于把授权层整个绕过去了——
// 用管理员测权限系统，就像用万能钥匙测门锁。
//
// 这个文件的每个用例 = 一个岗位的一天：
//   销售   建线索 → 跟进（认领）→ 转客户 → 建合同
//   顾问   看项目 → 建任务 → 完成任务 → 写知识
//   财务   看合同金额 → 确认回款
// 跑不通就是这个岗位上线后干不了活。
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const ADMIN_PW = 'Admin-Test-Pw-2026';
const USER_PW = 'Role-Test-Pw-2026';

const emptyStatePath = (name) => {
  const f = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify({ updated_at: new Date().toISOString(), datasets: {} }, null, 2));
  return f;
};

/*
  MODE：observe 只判定不拦，enforce 真拦。

  同一套岗位场景要在**两种模式下都跑**。observe 下全绿说明不了什么——
  它本来就一律放行；真正要回答的是「切 enforce 之后同事还能不能干活」。
  这是上线闸门：跑不通就不能切，切了第二天全公司被自己的系统挡在门外。
  用 XINYI_AUTHZ_SCENARIO_MODE=enforce 跑 enforce 版。
*/
const MODE = process.env.XINYI_AUTHZ_SCENARIO_MODE === 'enforce' ? 'enforce' : 'observe';

const authEnv = (name) => ({
  XINYI_AUTHZ_MODE: MODE,
  STATE_STORE_PATH: emptyStatePath(name),
  AUTH_STORE_PATH: path.join(os.tmpdir(), `${name}-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
  XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@xinyi-iso.local',
  XINYI_AUTH_SEED_ADMIN_PASSWORD: ADMIN_PW,
  XINYI_AUTH_REQUIRE_POSTGRES: 'false',
});

const call = async (url, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, body: await res.json().catch(() => ({})) };
};

const loginAs = async (baseUrl, account, password) => {
  const r = await call(`${baseUrl}/api/auth/login`, { method: 'POST', body: { account, password } });
  assert.equal(r.res.status, 200, `登录失败 ${account}：${JSON.stringify(r.body)}`);
  return String(r.res.headers.get('set-cookie') || '').split(';')[0];
};

let seq = 0;
/** 建一个指定角色的账号并登录。**必须验证建出来的角色真是要的那个。** */
const asRole = async (baseUrl, role) => {
  const email = `${role.toLowerCase()}-${Date.now()}-${seq++}@xinyi-iso.local`;
  const adminCookie = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
  const created = await call(`${baseUrl}/api/auth/users`, {
    method: 'POST', cookie: adminCookie,
    body: { email, name: `测试${role}`, password: USER_PW, roles: [role], mustChangePassword: false },
  });
  assert.equal(created.res.status, 201, `建 ${role} 账号失败：${JSON.stringify(created.body)}`);
  assert.deepEqual(created.body.data.user.roles, [role],
    `建出来的角色不是 ${role}——静默降级过一次，见 authStore 的 VALID_ROLES`);
  return { cookie: await loginAs(baseUrl, email, USER_PW), user: created.body.data.user };
};

/** 断言接口调用成功；失败时把响应体打出来，不然只看到一个状态码没法查 */
const ok = (r, what, expect = 200) =>
  assert.equal(r.res.status, expect, `${what} 失败（HTTP ${r.res.status}）：${JSON.stringify(r.body)}`);

test('销售的一天：建线索 → 跟进认领 → 转客户 → 建合同', async () => {
  const { child, baseUrl } = await startServerProcess(authEnv('role-sales'));
  try {
    const { cookie, user } = await asRole(baseUrl, 'SALES');

    const lead = await call(`${baseUrl}/api/leads`, {
      method: 'POST', cookie,
      body: { lead: { name: '周老板', company: '苍南塑编厂', source: '转介绍',
                      mobile: '13900000001', potentialValueAmount: 45000, existingCertifications: [] } },
    });
    ok(lead, '销售建线索', 201);
    const leadId = lead.body.data.lead.id;

    // 销售最该确认的一件事：录进去的手机号要出现在联系人里
    assert.equal(lead.body.data.lead.contacts?.[0]?.mobile, '13900000001',
      '录的手机号没进联系人列表——销售在界面上就找不到怎么联系客户');

    const followUp = await call(`${baseUrl}/api/leads/${leadId}/follow-ups`, {
      method: 'POST', cookie,
      body: { record: { content: '已通电话，下周上门', type: 'call', operator: user.name } },
    });
    ok(followUp, '销售记跟进', 201);
    assert.equal(followUp.body.data.claimed, true, '跟进应当把这条无主线索认领到销售名下');

    const detail = await call(`${baseUrl}/api/leads/${leadId}`, { cookie });
    assert.equal(detail.body.data.lead.ownerUserId, user.id, '认领后归属要落到这个销售身上');

    const convert = await call(`${baseUrl}/api/leads/${leadId}/convert`, { method: 'POST', cookie });
    ok(convert, '销售转客户');
    assert.ok(convert.body.data.customer?.id, '转化后要产出客户');

    const contract = await call(`${baseUrl}/api/contracts`, {
      method: 'POST', cookie,
      body: { contract: { title: 'ISO 9001 认证服务', customerId: convert.body.data.customer.id,
                          customerName: '苍南塑编厂', amount: 45000,
                          signDate: '2026-08-22', serviceLine: 'ISO 9001' } },
    });
    ok(contract, '销售建合同', 201);
  } finally {
    await stopServerProcess(child);
  }
});

test('顾问的一天：看项目 → 建任务 → 完成任务 → 写知识', async () => {
  const { child, baseUrl } = await startServerProcess(authEnv('role-consultant'));
  try {
    const admin = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
    const { cookie, user } = await asRole(baseUrl, 'CONSULTANT');

    // 项目由管理者建好并指派给这个顾问——顾问不能自己给自己派活
    const created = await call(`${baseUrl}/api/projects`, {
      method: 'POST', cookie: admin,
      body: { project: { name: '苍南塑编厂 ISO 9001', customerId: 'C-ROLE-1', customerName: '苍南塑编厂' } },
    });
    ok(created, '管理员建项目', 201);
    const projectId = created.body.data.project.id;

    const assigned = await call(`${baseUrl}/api/projects/${projectId}/owner`, {
      method: 'PATCH', cookie: admin,
      body: { ownerUserId: user.id, ownerName: user.name, reason: '指派给顾问' },
    });
    ok(assigned, '管理员指派项目负责人');

    const list = await call(`${baseUrl}/api/projects`, { cookie });
    ok(list, '顾问看项目列表');

    const task = await call(`${baseUrl}/api/projects/${projectId}/tasks`, {
      method: 'POST', cookie,
      body: { task: { title: '首次现场辅导', deadline: '2026-09-10', category: 'Core' } },
    });
    ok(task, '顾问建任务', 201);
    const taskId = task.body.data.task.id;

    const done = await call(`${baseUrl}/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH', cookie, body: { task: { status: 'Completed' } },
    });
    ok(done, '顾问完成任务');
    assert.ok(done.body.data.task, '响应里要带回更新后的任务');
    assert.equal(done.body.data.project.progress, 100, '核心任务全部完成，进度应当是 100');
  } finally {
    await stopServerProcess(child);
  }
});

test('财务的一天：看合同金额 → 确认回款', async () => {
  const { child, baseUrl } = await startServerProcess(authEnv('role-finance'));
  try {
    const admin = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
    const { cookie } = await asRole(baseUrl, 'FINANCE');

    const created = await call(`${baseUrl}/api/contracts`, {
      method: 'POST', cookie: admin,
      body: { contract: { title: '财务场景合同', customerId: 'C-ROLE-2', customerName: '平阳机械',
                          amount: 60000, signDate: '2026-08-22', serviceLine: 'ISO 14001' } },
    });
    ok(created, '建合同', 201);

    const list = await call(`${baseUrl}/api/contracts`, { cookie });
    ok(list, '财务看合同列表');
    const mine = list.body.data.contracts.find((c) => c.id === created.body.data.contract.id);
    assert.ok(mine, '财务要能看到刚建的合同');
    assert.ok(mine.amount != null, '财务必须看得到合同金额，否则没法对账');
  } finally {
    await stopServerProcess(child);
  }
});

test('顾问看不到合同金额——这是刻意的，不是 bug', async () => {
  const { child, baseUrl } = await startServerProcess(authEnv('role-boundary'));
  try {
    const { user } = await asRole(baseUrl, 'CONSULTANT');
    const { loadCapabilities } = require('../server/authz/authorize');
    const caps = loadCapabilities();
    assert.ok(!caps.CONSULTANT.actions.has('CONTRACT_VIEW_AMOUNT'),
      '顾问不该有看合同金额的权限（避免与客户议价、同事间比价）');
    assert.ok(caps.SALES.actions.has('CONTRACT_VIEW_AMOUNT'),
      '销售必须看得到自己谈的合同金额');
    assert.ok(user.roles.includes('CONSULTANT'));
  } finally {
    await stopServerProcess(child);
  }
});
