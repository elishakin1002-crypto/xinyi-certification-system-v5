// 板块衔接测试：一个客户从线索走到项目完成，中间每一次交接都要接得上。
//
// ── 为什么单测和岗位场景不够 ────────────────────────────────────
// tests/role-scenarios.test.js 验的是「每个岗位能不能干自己的活」，
// 这个文件验的是**活交出去之后，下一个人接不接得到**。
//
// 信义的主链路跨了四个板块、三个岗位：
//
//   销售：线索 → 跟进（认领）→ 转客户 → 建合同
//     ↓ 交接点①：合同建好了，交付方能不能看到并据此建项目？
//   交付：建项目 → 指派负责人
//     ↓ 交接点②：项目和合同关联得上吗？金额能带过来吗？
//   顾问：建任务 → 完成任务 → 项目进度
//     ↓ 交接点③：项目完成后，财务能看到应收吗？
//   财务：看合同金额 → 回款
//
// 断在任何一个交接点，表现都是「数据在我这儿没有」——
// 而每个人都只会觉得是别人没录，不会觉得是系统断了。
// 上线后请同事分角色试用，第一批反馈几乎必然集中在这些交接点上。
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

const ADMIN_PW = 'Admin-Test-Pw-2026';
const USER_PW = 'Chain-Test-Pw-2026';
const MODE = process.env.XINYI_AUTHZ_SCENARIO_MODE === 'enforce' ? 'enforce' : 'observe';

const tmp = (n) => path.join(os.tmpdir(), `${n}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

const env = (name) => {
  const f = tmp(name);
  fs.writeFileSync(f, JSON.stringify({ updated_at: new Date().toISOString(), datasets: {} }, null, 2));
  return {
    XINYI_AUTHZ_MODE: MODE,
    STATE_STORE_PATH: f,
    AUTH_STORE_PATH: tmp(`${name}-auth`),
    XINYI_AUTH_SEED_ADMIN_EMAIL: 'admin@xinyi-iso.local',
    XINYI_AUTH_SEED_ADMIN_PASSWORD: ADMIN_PW,
    XINYI_AUTH_REQUIRE_POSTGRES: 'false',
  };
};

const call = async (url, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, body: await res.json().catch(() => ({})) };
};

const ok = (r, what, expect = 200) =>
  assert.equal(r.res.status, expect, `${what} 失败（HTTP ${r.res.status}）：${JSON.stringify(r.body)}`);

const loginAs = async (base, account, password) => {
  const r = await call(`${base}/api/auth/login`, { method: 'POST', body: { account, password } });
  ok(r, `登录 ${account}`);
  return String(r.res.headers.get('set-cookie') || '').split(';')[0];
};

let seq = 0;
const asRole = async (base, role) => {
  const email = `${role.toLowerCase()}-chain-${Date.now()}-${seq++}@xinyi-iso.local`;
  const admin = await loginAs(base, 'admin@xinyi-iso.local', ADMIN_PW);
  const c = await call(`${base}/api/auth/users`, {
    method: 'POST', cookie: admin,
    body: { email, name: `链路${role}`, password: USER_PW, roles: [role], mustChangePassword: false },
  });
  ok(c, `建 ${role} 账号`, 201);
  return { cookie: await loginAs(base, email, USER_PW), user: c.body.data.user, adminCookie: admin };
};

test('主链路：线索 → 客户 → 合同 → 项目 → 完成任务，每个交接点都接得上', async () => {
  const { child, baseUrl } = await startServerProcess(env('chain-main'));
  try {
    const sales = await asRole(baseUrl, 'SALES');
    const cons = await asRole(baseUrl, 'CONSULTANT');
    const admin = sales.adminCookie;

    // ── 销售：建线索 ──
    const lead = await call(`${baseUrl}/api/leads`, {
      method: 'POST', cookie: sales.cookie,
      body: { lead: { name: '林厂长', company: '龙港纸品包装厂', mobile: '13900000002',
                      source: '转介绍', potentialValueAmount: 38000, existingCertifications: [] } },
    });
    ok(lead, '销售建线索', 201);
    const leadId = lead.body.data.lead.id;

    // ── 交接点①：线索 → 客户 ──
    const conv = await call(`${baseUrl}/api/leads/${leadId}/convert`, { method: 'POST', cookie: sales.cookie });
    ok(conv, '线索转客户');
    const customer = conv.body.data.customer;
    assert.ok(customer?.id, '转化后必须产出客户');
    assert.equal(customer.name, '龙港纸品包装厂', '客户名要从线索带过来');
    assert.equal(customer.contactPerson, '林厂长', '联系人要从线索带过来——断在这里销售就得重录一遍');
    assert.equal(customer.mobile, '13900000002', '手机号要带过来');

    const afterConv = await call(`${baseUrl}/api/leads/${leadId}`, { cookie: sales.cookie });
    assert.equal(afterConv.body.data.lead.status, 'Converted',
      '线索转化后状态要变成已转化，否则它会一直挂在待跟进列表里');

    // ── 交接点②：客户 → 合同 ──
    const contract = await call(`${baseUrl}/api/contracts`, {
      method: 'POST', cookie: sales.cookie,
      body: { contract: { title: 'ISO 9001 认证服务', customerId: customer.id,
                          customerName: customer.name, amount: 38000,
                          signDate: '2026-08-24', serviceLine: 'ISO 9001' } },
    });
    ok(contract, '销售建合同', 201);
    const contractId = contract.body.data.contract.id;

    // ── 交接点③：合同 → 项目（交付方接手）──
    const project = await call(`${baseUrl}/api/projects`, {
      method: 'POST', cookie: admin,
      body: { project: { name: '龙港纸品包装厂 ISO 9001', customerId: customer.id,
                         customerName: customer.name, contractRef: contractId, projectAmount: 38000 } },
    });
    ok(project, '按合同建项目', 201);
    const projectId = project.body.data.project.id;
    assert.equal(project.body.data.project.contractRef, contractId,
      '项目要挂住合同号，否则财务对不上这个项目该收多少钱');

    // ── 指派给顾问 ──
    const assign = await call(`${baseUrl}/api/projects/${projectId}/owner`, {
      method: 'PATCH', cookie: admin,
      body: { ownerUserId: cons.user.id, ownerName: cons.user.name, reason: '交付给顾问' },
    });
    ok(assign, '指派项目负责人');

    // ── 交接点④：顾问接手，能建任务并完成 ──
    const task = await call(`${baseUrl}/api/projects/${projectId}/tasks`, {
      method: 'POST', cookie: cons.cookie,
      body: { task: { title: '首次现场辅导', deadline: '2026-09-15', category: 'Core' } },
    });
    ok(task, '顾问建任务', 201);

    const done = await call(`${baseUrl}/api/projects/${projectId}/tasks/${task.body.data.task.id}`, {
      method: 'PATCH', cookie: cons.cookie, body: { task: { status: 'Completed' } },
    });
    ok(done, '顾问完成任务');
    assert.equal(done.body.data.project.progress, 100, '核心任务完成后进度要更新');

    // ── 交接点⑤：财务能看到这单的金额 ──
    const fin = await asRole(baseUrl, 'FINANCE');
    const list = await call(`${baseUrl}/api/contracts`, { cookie: fin.cookie });
    ok(list, '财务看合同列表');
    const seen = list.body.data.contracts.find((c) => c.id === contractId);
    assert.ok(seen, '财务必须看得到这份合同，否则收不到这笔钱');
    assert.equal(Number(seen.amount), 38000, '财务看到的金额要和销售签的一致');
  } finally {
    await stopServerProcess(child);
  }
});

test('客户资料在各板块间一致：改了客户名，合同和项目上跟着对得上', async () => {
  const { child, baseUrl } = await startServerProcess(env('chain-consistency'));
  try {
    const sales = await asRole(baseUrl, 'SALES');
    const admin = sales.adminCookie;

    const cust = await call(`${baseUrl}/api/customers`, {
      method: 'POST', cookie: sales.cookie,
      body: { customer: { name: '平阳制罐厂', contactPerson: '吴经理', mobile: '13900000003' } },
    });
    ok(cust, '建客户', 201);
    const customerId = cust.body.data.customer.id;

    const ct = await call(`${baseUrl}/api/contracts`, {
      method: 'POST', cookie: sales.cookie,
      body: { contract: { title: 'ISO 22000 认证', customerId, customerName: '平阳制罐厂',
                          amount: 26000, signDate: '2026-08-24', serviceLine: 'ISO 22000' } },
    });
    ok(ct, '建合同', 201);

    /*
      合同上存的是**客户名快照**（customerName），不是实时关联。
      客户改名后，合同上的名字会停在旧值。这不一定是 bug——
      合同是法律文件，签订时的抬头本就不该跟着改。
      但界面上必须能通过 customerId 找回当前客户，否则改名后
      「这份合同是谁的」就断了。
    */
    const renamed = await call(`${baseUrl}/api/customers/${customerId}`, {
      method: 'PATCH', cookie: sales.cookie, body: { customer: { name: '平阳制罐有限公司' } },
    });
    ok(renamed, '改客户名');

    const after = await call(`${baseUrl}/api/contracts/${ct.body.data.contract.id}`, { cookie: admin });
    ok(after, '重新读合同');
    assert.equal(after.body.data.contract.customerId, customerId,
      '合同必须始终能通过 customerId 关联回客户——只靠客户名的话，改名就断链');
  } finally {
    await stopServerProcess(child);
  }
});

test('老板一个人能走完交付链路：建合同 → 按合同建项目 → 指派给顾问', async () => {
  /*
    信义是扁平组织，老板同时是最大的销售，也常常自己派活。
    所以老板必须**不依赖总助**就能把一单从合同推到交付。

    这条单独测，是因为权限矩阵里老板的动作是分散配置的
    （PROJECT_CREATE / PROJECT_ASSIGN_OWNER / CONTRACT_CREATE …），
    少配一个的表现是「老板点了没反应」，而他不会去看是哪个动作码缺了。
  */
  const { child, baseUrl } = await startServerProcess(env('chain-boss'));
  try {
    const boss = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);
    const cons = await asRole(baseUrl, 'CONSULTANT');

    const cust = await call(`${baseUrl}/api/customers`, {
      method: 'POST', cookie: boss,
      body: { customer: { name: '苍南五金制品厂', contactPerson: '郑总', mobile: '13900000004' } },
    });
    ok(cust, '老板建客户', 201);

    const ct = await call(`${baseUrl}/api/contracts`, {
      method: 'POST', cookie: boss,
      body: { contract: { title: 'ISO 45001 认证服务', customerId: cust.body.data.customer.id,
                          customerName: '苍南五金制品厂', amount: 42000,
                          signDate: '2026-08-24', serviceLine: 'ISO 45001' } },
    });
    ok(ct, '老板建合同', 201);

    const pj = await call(`${baseUrl}/api/projects`, {
      method: 'POST', cookie: boss,
      body: { project: { name: '苍南五金 ISO 45001', customerId: cust.body.data.customer.id,
                         customerName: '苍南五金制品厂', contractRef: ct.body.data.contract.id,
                         projectAmount: 42000 } },
    });
    ok(pj, '老板按合同建项目', 201);
    assert.equal(pj.body.data.project.contractRef, ct.body.data.contract.id, '项目要挂住合同号');

    const assign = await call(`${baseUrl}/api/projects/${pj.body.data.project.id}/owner`, {
      method: 'PATCH', cookie: boss,
      body: { ownerUserId: cons.user.id, ownerName: cons.user.name, reason: '老板直接派活' },
    });
    ok(assign, '老板指派项目给顾问');

    // 顾问真的能接手
    const task = await call(`${baseUrl}/api/projects/${pj.body.data.project.id}/tasks`, {
      method: 'POST', cookie: cons.cookie,
      body: { task: { title: '体系文件评审', deadline: '2026-09-20', category: 'Core' } },
    });
    ok(task, '顾问在老板派的项目上建任务', 201);
  } finally {
    await stopServerProcess(child);
  }
});

test('任务没交代就完不了项目——「不强制完成，但强制交代」', async () => {
  /*
    这条闸门必须在**服务端**。前端有完成前检查清单，但那是提示，绕得过去。

    2026-08-24 在真实数据里查到口子敞开的后果：
    三个已完成项目的进度都写着 100%，而核心任务一个没勾
    （东莞万豪 6 个、平阳新锦 5 个、温州宏宏 3 个）。
    因为 completeProject 直接写死 progress: 100，根本不看任务。

    后果不是数字难看，是项目管理失去意义：
    进度永远 100、延误率永远 100%，没有任何指标能告诉你哪个项目真卡住了。
  */
  const { child, baseUrl } = await startServerProcess(env('chain-complete-gate'));
  try {
    const boss = await loginAs(baseUrl, 'admin@xinyi-iso.local', ADMIN_PW);

    const pj = await call(`${baseUrl}/api/projects`, {
      method: 'POST', cookie: boss,
      /*
        金额和费用状态要填齐：完成项目还有一道既有的费用闸门
        （costStatus 必须是「已确认」且金额 > 0），
        它和任务闸门是两件事，这条用例测的是任务那道。
      */
      body: { project: { name: '闸门测试项目', customerId: 'C-GATE-1', customerName: '闸门测试客户',
                         projectAmount: 30000, costStatus: '已确认',
                         tasks: [
                           { title: '体系文件编写', deadline: '2026-09-01', category: 'Core' },
                           { title: '内审', deadline: '2026-09-10', category: 'Core' },
                         ] } },
    });
    ok(pj, '建带任务的项目', 201);
    const pid = pj.body.data.project.id;

    // ① 任务都没动就想完成 → 必须被拒
    const tooEarly = await call(`${baseUrl}/api/projects/${pid}/complete`, { method: 'POST', cookie: boss });
    assert.notEqual(tooEarly.res.status, 200, '任务一个没交代就完成项目，必须被拒绝');
    assert.match(JSON.stringify(tooEarly.body), /没有交代|未完成|交代/,
      `拒绝理由要说清是哪几个任务没交代，实际：${JSON.stringify(tooEarly.body)}`);

    // ② 一个完成、一个跳过（填原因）→ 可以完成
    const tasks = pj.body.data.project.tasks;
    const resolved = [
      { ...tasks[0], status: 'Completed' },
      { ...tasks[1], status: 'Skipped', skipReason: 'CustomerHandled' },
    ];
    const done = await call(`${baseUrl}/api/projects/${pid}/complete`, {
      method: 'POST', cookie: boss, body: { tasksOverride: resolved },
    });
    ok(done, '任务都有交代后完成项目');

    const after = await call(`${baseUrl}/api/projects/${pid}`, { cookie: boss });
    assert.equal(after.body.data.project.status, 'Completed');
    assert.equal(after.body.data.project.progress, 100,
      '一个完成一个跳过：跳过的不计入分母，进度应当是 100');
  } finally {
    await stopServerProcess(child);
  }
});
