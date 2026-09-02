// 归属机制的端到端验证：线索认领 / 合同·项目指派。
//
// 为什么要端到端测而不只测 authorize()：认领这件事跨了三层——
// 授权层判定「可以认领」、路由层把归属写进去、账本层记下这次变更。
// 单测只能证明第一层对；中间任何一层漏了，结果都是**归属永远长不出来**，
// 而且没有任何报错——这正是 2026-08-21 之前 455 条线索全部无主的成因类型。
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const emptyStatePath = (name) => {
  const file = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ updated_at: new Date().toISOString(), datasets: {} }, null, 2));
  return file;
};

const jsonFetch = async (url, options = {}) => {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  return { res, body };
};

const post = (url, payload, cookie) => jsonFetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(payload),
});
const patch = (url, payload, cookie) => jsonFetch(url, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(payload),
});

/*
  认领必须有「操作人」才成立——匿名请求在授权第①步就以「未识别身份」被拒，
  claimsOwnership 永远不会为真。所以这里要真的登录，不能靠关鉴权绕过去。
  顺带也验证了建账号接口（P0-20 要用的那个）。
*/
const ADMIN_PW = 'Admin-Test-Pw-2026';
const SALES_PW = 'Sales-Test-Pw-2026';

const authEnv = (name) => ({
  AUTH_STORE_PATH: path.join(os.tmpdir(), `${name}-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
  XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@xinyi-iso.local',
  XINYI_AUTH_SEED_ADMIN_PASSWORD: ADMIN_PW,
  XINYI_AUTH_REQUIRE_POSTGRES: 'false',
});

const cookieOf = (res) => String(res.headers.get('set-cookie') || '').split(';')[0];

const loginAs = async (baseUrl, account, password) => {
  const r = await post(`${baseUrl}/api/auth/login`, { account, password });
  assert.equal(r.res.status, 200, `登录失败：${account} → ${JSON.stringify(r.body)}`);
  return cookieOf(r.res);
};

/**
 * 建一个销售账号并登录。
 * 销售 writeScope=OWN，才会走到认领分支——用 ADMIN 测不出来（他是 ALL，直接放行）。
 *
 * 邮箱按次生成：认证存储落在测试库 PG 里，账号会跨用例、跨轮次残留，
 * 固定邮箱第二次就 409。
 */
let salesSeq = 0;
const loginAsSales = async (baseUrl) => {
  const email = `sales-${Date.now()}-${salesSeq++}@xinyi-iso.local`;
  const adminCookie = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
  const created = await post(`${baseUrl}/api/auth/users`, {
    email, name: '张销售', password: SALES_PW, roles: ['SALES'], mustChangePassword: false,
  }, adminCookie);
  assert.equal(created.res.status, 201, `建销售账号失败：${JSON.stringify(created.body)}`);
  // 顺带钉住上面那个坑：SALES 曾因不在认证存储的合法角色表里，被静默建成 CONSULTANT
  assert.deepEqual(created.body.data.user.roles, ['SALES'],
    '建出来的必须真是销售——角色被静默降级过一次，见 authStore 的 VALID_ROLES');
  return { cookie: await loginAs(baseUrl, email, SALES_PW), user: created.body.data.user };
};

test('无主线索被销售修改时自动认领到他名下', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-ownership-claim'),
    ...authEnv('claim'),
  });
  try {
    const { cookie, user } = await loginAsSales(baseUrl);

    const created = await post(`${baseUrl}/api/leads`, {
      lead: {
        name: '陈某', company: '认领测试公司', source: '网站',
        potentialValueAmount: 30000, existingCertifications: [],
      },
    }, cookie);
    assert.equal(created.res.status, 201, `线索应创建成功：${JSON.stringify(created.body)}`);
    const leadId = created.body.data.lead.id;

    // 创建时不带归属，模拟库里那 455 条无主线索
    const before = await jsonFetch(`${baseUrl}/api/leads/${leadId}`, { headers: { Cookie: cookie } });
    assert.ok(!before.body.data.lead.ownerUserId, '前提：这条线索是无主的');

    const updated = await patch(`${baseUrl}/api/leads/${leadId}`, { lead: { name: '陈总' } }, cookie);
    assert.equal(updated.res.status, 200);
    assert.equal(updated.body.data.claimed, true, '响应要明确告诉前端「这次认领了」');

    const after = await jsonFetch(`${baseUrl}/api/leads/${leadId}`, { headers: { Cookie: cookie } });
    assert.equal(after.body.data.lead.ownerUserId, user.id, '认领后归属必须落到操作人身上');
  } finally {
    await stopServerProcess(child);
  }
});

test('已有主的线索，别人改不会把归属抢走', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-ownership-nosteal'),
    ...authEnv('nosteal'),
  });
  try {
    const { cookie } = await loginAsSales(baseUrl);
    const created = await post(`${baseUrl}/api/leads`, {
      lead: {
        name: '王某', company: '已有主公司',
        potentialValueAmount: 20000, existingCertifications: [],
      },
    }, cookie);
    const leadId = created.body.data.lead.id;

    // 先由销售认领
    await patch(`${baseUrl}/api/leads/${leadId}`, { lead: { name: '王总' } }, cookie);
    const owned = await jsonFetch(`${baseUrl}/api/leads/${leadId}`, { headers: { Cookie: cookie } });
    const firstOwner = owned.body.data.lead.ownerUserId;
    assert.ok(firstOwner);

    // 换老板来改：writeScope=ALL 允许改，但**不该**改变归属
    const adminCookie = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
    const again = await patch(`${baseUrl}/api/leads/${leadId}`, { lead: { name: '王董' } }, adminCookie);
    assert.equal(again.body.data.claimed, false, '有主数据不该触发认领');

    const after = await jsonFetch(`${baseUrl}/api/leads/${leadId}`, { headers: { Cookie: cookie } });
    assert.equal(after.body.data.lead.ownerUserId, firstOwner, '归属不能被后来的修改悄悄换掉');
  } finally {
    await stopServerProcess(child);
  }
});

test('指派接口能把合同归属写进去，并且拒绝空负责人', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-ownership-assign'),
    ...authEnv('assign'),
  });
  try {
    const cookie = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
    const created = await post(`${baseUrl}/api/contracts`, {
      contract: {
        title: '指派测试合同', customerId: 'C-OWN-1', customerName: '指派测试公司',
        amount: 50000, signDate: '2026-08-21', serviceLine: 'ISO 9001',
      },
    }, cookie);
    assert.equal(created.res.status, 201);
    const contractId = created.body.data.contract.id;

    const bad = await patch(`${baseUrl}/api/contracts/${contractId}/owner`, { ownerName: '只给名字' }, cookie);
    assert.equal(bad.res.status, 400, '没有 ownerUserId 必须拒绝——指派要落到人，光有名字不行');

    const ok = await patch(`${baseUrl}/api/contracts/${contractId}/owner`, {
      ownerUserId: 'U-SALES-1', ownerName: '张三', reason: '这单是他谈的',
    }, cookie);
    assert.equal(ok.res.status, 200);

    const after = await jsonFetch(`${baseUrl}/api/contracts/${contractId}`, { headers: { Cookie: cookie } });
    assert.equal(after.body.data.contract.ownerUserId, 'U-SALES-1');
  } finally {
    await stopServerProcess(child);
  }
});

test('归属变更会记进 Action Ledger', async () => {
  const { child, baseUrl } = await startServerProcess({
    STATE_STORE_PATH: emptyStatePath('xinyi-ownership-ledger'),
    ...authEnv('ledger'),
  });
  try {
    const cookie = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
    const created = await post(`${baseUrl}/api/projects`, {
      project: { name: '账本测试项目', customerId: 'C-OWN-2', customerName: '账本测试公司' },
    }, cookie);
    assert.equal(created.res.status, 201, `项目应创建成功：${JSON.stringify(created.body)}`);
    const projectId = created.body.data.project.id;

    const assigned = await patch(`${baseUrl}/api/projects/${projectId}/owner`, {
      ownerUserId: 'U-CONS-1', ownerName: '李四',
    }, cookie);
    // 必须断言状态码。上一版没断言，指派其实 404 了（路由读的是另一个存储），
    // 测试却因为只看账本而给出一个含糊的失败信息。
    assert.equal(assigned.res.status, 200, `指派应成功：${JSON.stringify(assigned.body)}`);

    const events = await jsonFetch(`${baseUrl}/api/business-events/project/${projectId}`,
      { headers: { Cookie: cookie } });
    const kinds = (events.body?.data?.events || []).map((e) => e.eventType);
    assert.ok(kinds.includes('ownership.assign'),
      `账本里要有 ownership.assign，实际有：${kinds.join(',') || '(空)'}`);
  } finally {
    await stopServerProcess(child);
  }
});
