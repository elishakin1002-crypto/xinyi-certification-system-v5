// 不符合项 / 工作日志 / 任务模板投影进关系表（待办 P0-19b）。
//
// ── 原来的样子 ──────────────────────────────────────────────────
// 这三样只存在 state store 的一个 jsonb 大数组里，
// 对应的 PG 表（audit_issues / project_work_logs / task_templates）**一直是 0 行**。
// 不报错、备份也覆盖了，所以三个月没人发现——
// 直到想统计「谁这个月记了多少工时」时才发现只能把整个数组捞进内存算。
//
// 现在：state store 照写（读路径不变），同时投影成关系表的行。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { testEnv, truncateTestDb } = require('./helpers/testDb');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/*
  testEnv() 是**返回**一份环境变量，不是设置它——
  别的测试文件是把它传给子进程的 env。这个文件在进程内直接用连接池，
  所以必须先写进 process.env，而且要在 require 连接池**之前**：
  pool 在模块加载时就读 XINYI_DB_URL，晚一步设就已经决定走文件回退了。
*/
Object.assign(process.env, testEnv());

const pool = require('../server/db/pool');
const { projectToRelational, PROJECTED } = require('../server/services/relationalProjection');
const { workLogRepo } = require('../server/repos/batch5Repos');

test.beforeEach(async () => { await truncateTestDb(); });

test('工时不能走「元→分」那套缩放', async () => {
  /*
    **这条测试是补出来的，因为真踩了。**

    第一版把 actualHours 写成 kind:'amount'，而 amount 是元→分（×100）。
    0.5 小时被存成 50。走仓储读回来是对的（fromDbValue 会除以 100），
    所以不报错、往返也一致——但**直接跑 SQL 看到的是 50**。
    而「能用 SQL 统计」正是把工作日志搬进关系表的全部意义，
    等于这次改动的目的被一个不报错的类型选择悄悄抵消了。

    所以这里刻意**绕开仓储直接查库**：往返一致证明不了什么，
    要证明的是库里躺着的那个数就是对的。
  */
  await projectToRelational({
    project_work_logs_v1: [
      { id: 'WLOG-T1', projectId: 'P-1', logDate: '2026-08-20', actualHours: 0.5, workContent: '现场辅导' },
      { id: 'WLOG-T2', projectId: 'P-1', logDate: '2026-08-21', actualHours: 6, workContent: '文件编写' },
    ],
  });

  const { rows } = await pool.query(
    'select id, actual_hours::float h from project_work_logs order by id');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].h, 0.5, '库里存的不是 0.5——工时被当成钱缩放了');
  assert.equal(rows[1].h, 6);

  const { rows: agg } = await pool.query('select sum(actual_hours)::float t from project_work_logs');
  assert.equal(agg[0].t, 6.5, 'SQL 直接求和的结果不对');
});

test('三个数据集都能投影进对应的表', async () => {
  await projectToRelational({
    audit_issues_v1: [{ id: 'AUD-T1', findings: '文件版本未更新', severity: 'Major', status: 'Verifying', customerName: '某厂' }],
    project_work_logs_v1: [{ id: 'WLOG-T1', projectId: 'P-1', logDate: '2026-08-20', actualHours: 1, workContent: 'x' }],
    task_templates_v1: [{ id: 'TPL-T1', name: '标准模板', tasks: [{ title: 'A' }], archived: false, usageCount: 3 }],
  });

  for (const [key, conf] of Object.entries(PROJECTED)) {
    const { rows } = await pool.query(`select count(*)::int n from ${conf.table}`);
    assert.equal(rows[0].n, 1, `${key} 没有投影进 ${conf.table}`);
  }

  // jsonb 字段要能原样取回，不能被转成字符串
  const { rows } = await pool.query('select tasks from task_templates');
  assert.ok(Array.isArray(rows[0].tasks), 'tasks 不是数组——jsonb 存成字符串了');
  assert.equal(rows[0].tasks[0].title, 'A');
});

const twoLogs = [
  { id: 'WLOG-A', projectId: 'P-1', logDate: '2026-08-20', actualHours: 1, workContent: 'a' },
  { id: 'WLOG-B', projectId: 'P-1', logDate: '2026-08-20', actualHours: 1, workContent: 'b' },
];
const oneLog = [twoLogs[0]];

test('普通同步不删行 —— 落后的浏览器不能删掉同事刚记的数据', async () => {
  /*
    ── 2026-09-02 这条测试的期望被**有意反转**了 ─────────────────
    原来是「数据集里删掉的记录，表里也要删掉」。单人使用时那是对的。

    多人同时用就不是了：每个浏览器推的是自己 localStorage 里的全量数组，
    而各人副本互不相通（状态同步的回读默认关闭，没人从服务端回读）。
      小敏 10:00 记一条工作日志 → 表里 48 行
      梁杰 10:05 改了别的东西   → 推自己那份 47 条 → 小敏那条被删，无报错

    线上已经差点发生：project_work_logs_v1 推上来是空数组而表里有 47 行，
    只因为下面那条「空数组不删」的保护才没删成。
    浏览器里当时要是有 1 条而不是 0 条，另外 46 条就没了。

    两害相权：幽灵行是统计误差，事后能对账清理；
    删掉同事的记录是数据事故，找不回来。
  */
  await projectToRelational({ project_work_logs_v1: twoLogs });
  await projectToRelational({ project_work_logs_v1: oneLog });

  const { rows } = await pool.query('select id from project_work_logs order by id');
  assert.deepEqual(rows.map((r) => r.id), ['WLOG-A', 'WLOG-B'],
    'B 被删掉了 —— 落后一步的浏览器就能删掉别人的数据');
});

test('明确传 allowClear 时才删 —— 清理脚本要有路可走', async () => {
  // 止血不能把合法的清理路径一起堵死，否则只能靠人手工进库删
  await projectToRelational({ project_work_logs_v1: twoLogs });
  await projectToRelational({ project_work_logs_v1: oneLog }, { allowClear: true });

  const { rows } = await pool.query('select id from project_work_logs');
  assert.deepEqual(rows.map((r) => r.id), ['WLOG-A'], 'allowClear 也删不掉，清理脚本没法用了');
});

test('空数组不清表——分不清「全删了」和「还没加载完」', async () => {
  /*
    空数组的来源有两种：真的全删光了，和「前端没加载完就触发了一次写」。
    第二种实际出现过，而它和第一种在数据上一模一样。
    分不清的时候宁可留几条幽灵行——那是统计误差；
    一次清空整张表是数据事故。
  */
  await projectToRelational({
    project_work_logs_v1: [{ id: 'WLOG-A', projectId: 'P-1', logDate: '2026-08-20', actualHours: 1, workContent: 'a' }],
  });
  await projectToRelational({ project_work_logs_v1: [] });

  const { rows } = await pool.query('select count(*)::int n from project_work_logs');
  assert.equal(rows[0].n, 1, '空数组把表清空了——这是不可接受的');
});

test('没有 id 的记录跳过，不能让整批失败', async () => {
  const r = await projectToRelational({
    project_work_logs_v1: [
      { projectId: 'P-1', workContent: '没有 id' },
      { id: 'WLOG-OK', projectId: 'P-1', logDate: '2026-08-20', actualHours: 1, workContent: 'ok' },
    ],
  });
  assert.ok(!r.error, '有一条没 id 就整批失败了');
  const { rows } = await pool.query('select id from project_work_logs');
  assert.deepEqual(rows.map((x) => x.id), ['WLOG-OK']);
});

test('不在投影名单里的数据集一律忽略', async () => {
  // 调用方多塞什么进来都不该被写进关系表
  const r = await projectToRelational({ leads_v8: [{ id: 'L-1' }], 随便什么: [{ id: 'X' }] });
  assert.deepEqual(r.projected, []);
});

test('投影失败不能让 state store 的写入回滚', () => {
  /*
    关系表现在是**派生数据**。用一个次要问题（投影失败）
    去制造一个主要问题（业务数据没保存）是不划算的。
    同一条理由见 datasetMirror.js。
  */
  const src = read('server/services/relationalProjection.js');
  const fn = src.slice(src.indexOf('const projectToRelational'));
  assert.match(fn, /catch\s*\(error\)/, '没有兜住异常');
  assert.match(fn, /console\.warn/, '失败了要留痕迹——静默失败比不做更糟');
  assert.ok(!/throw error/.test(fn), '投影失败抛出去了，会把已经成功的业务写入拖下水');
});

test('投影挂在 upsertStateBatch 上，不是挂在某一个调用方身上', async () => {
  /*
    upsertStateBatch 是**所有数据集写入的唯一入口**——
    /api/state/sync、事务接口、后端服务写的都要过这一关。
    挂在任何一个调用方身上都会漏掉另外几条路，
    而漏掉的那条路上写的数据不会报错，只是永远不进表。
  */
  const src = stripComments(read('server/stateStore.js'));
  const fn = src.slice(src.indexOf('const upsertStateBatch = async'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /projectToRelational/, 'upsertStateBatch 里没有调用投影');
  assert.ok(/await\s+upsertStateBatchPostgres|await\s+upsertStateBatchFile/.test(body),
    '主存储写入不再是 await 的——投影可能跑在写成功之前');
});

test('工作日志真的能用 SQL 统计了', async () => {
  // 这就是整件事的目的：以前只能把整个 jsonb 数组捞进内存算
  await projectToRelational({
    project_work_logs_v1: [
      { id: 'W1', projectId: 'P-1', logDate: '2026-08-01', actualHours: 2, operatorName: '甲', workContent: 'a' },
      { id: 'W2', projectId: 'P-1', logDate: '2026-08-02', actualHours: 3.5, operatorName: '甲', workContent: 'b' },
      { id: 'W3', projectId: 'P-2', logDate: '2026-07-15', actualHours: 1, operatorName: '乙', workContent: 'c' },
    ],
  });

  const { rows } = await pool.query(`
    select operator_name, count(*)::int n, sum(actual_hours)::float h
      from project_work_logs
     where to_char(log_date, 'YYYY-MM') = '2026-08'
     group by 1 order by 1`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operator_name, '甲');
  assert.equal(rows[0].n, 2);
  assert.equal(rows[0].h, 5.5);
});

test('走仓储读回来的形状和前端用的一致', async () => {
  // 投影不能改变数据形状，否则将来读路径切到 PG 时前端会拿到不认识的字段
  await projectToRelational({
    project_work_logs_v1: [
      { id: 'W1', projectId: 'P-9', taskId: 'T-9', logDate: '2026-08-20', actualHours: 0.5,
        workContent: '现场辅导', operatorName: '甲', source: 'manual' },
    ],
  });
  const list = await workLogRepo.list({ projectId: 'P-9' });
  assert.equal(list.length, 1);
  assert.equal(list[0].actualHours, 0.5, '读回来的工时被缩放了');
  assert.equal(list[0].workContent, '现场辅导');
  assert.equal(list[0].taskId, 'T-9');
  assert.equal(list[0].logDate, '2026-08-20');
});

test('前端同步不能删关系表的行 —— 多人同时用时那是数据事故', async () => {
  /*
    2026-09-02 线上现场：project_work_logs_v1 推上来是空数组，表里有 47 行。
    只因为「空数组不删」那条保护才没删成。浏览器里当时要是有 1 条而不是 0 条，
    另外 46 条会被 DELETE ... WHERE NOT IN (那 1 条) 删掉。

    根因：每个浏览器推的是自己 localStorage 里的全量数组，
    而各人副本互不相通（状态同步的回读默认关闭）。
    副本落后的那个人，一次无关的操作就能删掉别人刚记的数据。
  */
  const src = fs.readFileSync(path.resolve(__dirname, '../server/services/relationalProjection.js'), 'utf8');
  assert.match(src, /if \(ids\.length > 0 && allowClear\)/,
    '投影仍会在普通写入时删行 —— 落后的浏览器能删掉同事刚记的数据');
  assert.doesNotMatch(src, /if \(ids\.length > 0\) \{\s*\n\s*const r = await client\.query\(\s*\n?\s*`DELETE/,
    '还留着无条件删除的旧分支');
});
