// 外键约束真的在生效吗 —— 靠"故意去违反它"来证明。
//
// 2026-09-14 金恩来：「虽然我已经忘记什么是外键约束了，
//   但我在想到时候怎么确定这个约束生效且无 bug 呢？」
//
// 这是个好问题，而且答案很具体：**写一段代码故意去做约束该拦住的事，
// 断言它被拦住了。** 拦不住测试就红。
//
// 这比"看一眼迁移文件写没写"强得多 —— 约束可能加失败、可能被后续迁移删掉、
// 可能加在了错的列上，这些从源码里全看不出来。只有真去撞一下才知道。
//
// ── 外键是什么（给非技术的人看）─────────────────────────────
//
// 就是让数据库自己记住「合同必须属于某个存在的客户」。
// 加之前：删掉客户，他的合同还在，只是指向一个不存在的客户，**不报错**；
// 加之后：删客户时底下还有合同，数据库直接拒绝并告诉你原因。
//
// 好处是**不需要任何人记住操作顺序** —— 记错了也做不成，
// 而不是记错了悄悄留下一堆坏数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const req = createRequire(__filename);
const { resolveTestDbUrl } = require('./helpers/testDb');
const { Pool } = req(path.join(ROOT, 'node_modules/pg'));

let pool;
const ids = [];

const uid = (p) => {
  const id = `${p}-FKTEST-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  ids.push(id);
  return id;
};

test.before(async () => {
  pool = new Pool({ connectionString: resolveTestDbUrl() });
});

test.after(async () => {
  // 收干净：这些是测试自己造的，留着会污染下一轮
  if (!pool) return;
  for (const t of ['project_work_logs', 'audit_issues', 'contracts', 'projects', 'customers']) {
    await pool.query(`delete from ${t} where id like '%FKTEST%'`).catch(() => {});
  }
  await pool.query(`delete from contracts where customer_id like '%FKTEST%'`).catch(() => {});
  await pool.end();
});

test('合同不能挂在一个不存在的客户名下', async () => {
  /*
    加外键之前这是能成功的 —— 建一份合同，customer_id 随便填个不存在的 id，
    库里就多一条「指向空气」的合同。客户管理里看不到这家公司，
    合同管理里却有他的合同，而且没有任何地方会报错。
  */
  await assert.rejects(
    () => pool.query(
      `insert into contracts (id, title, customer_id) values ($1, '外键测试合同', $2)`,
      [uid('CT'), 'CUST-根本不存在-FKTEST']
    ),
    (e) => e.code === '23503',   // 23503 = foreign_key_violation
    '挂在不存在的客户上居然成功了 —— 外键没生效'
  );
});

test('客户底下还有合同时，删客户要被拒绝（不是悄悄留下孤儿）', async () => {
  const custId = uid('CU');
  const ctId = uid('CT');
  await pool.query(`insert into customers (id, name) values ($1, '外键测试客户')`, [custId]);
  await pool.query(`insert into contracts (id, title, customer_id) values ($1, '外键测试合同', $2)`, [ctId, custId]);

  await assert.rejects(
    () => pool.query('delete from customers where id = $1', [custId]),
    (e) => e.code === '23503',
    '底下还挂着合同，客户居然被删掉了 —— 那份合同现在指向空气'
  );

  // 先处理掉合同，再删客户 —— 这次该成功
  await pool.query('delete from contracts where id = $1', [ctId]);
  const r = await pool.query('delete from customers where id = $1', [custId]);
  assert.equal(r.rowCount, 1, '合同已经清掉了，客户还是删不了 —— 约束配得太紧');
});

test('删项目时，它的工作日志要跟着走（这些是项目的组成部分）', async () => {
  /*
    和上一条的区别在于「这东西离开父记录还有没有意义」：
      合同  离开客户仍然是一份有法律意义的记录 → RESTRICT，不许连坐
      工作日志  离开项目就是一行没有归属的工时 → CASCADE，跟着走
  */
  const custId = uid('CU');
  const projId = uid('PJ');
  const logId = uid('WL');
  await pool.query(`insert into customers (id, name) values ($1, '外键测试客户2')`, [custId]);
  await pool.query(`insert into projects (id, name, customer_id) values ($1, '外键测试项目', $2)`, [projId, custId]);
  await pool.query(`insert into project_work_logs (id, project_id) values ($1, $2)`, [logId, projId]);

  await pool.query('delete from projects where id = $1', [projId]);
  const { rows: [r] } = await pool.query('select count(*)::int n from project_work_logs where id = $1', [logId]);
  assert.equal(r.n, 0, '项目删了，它的工作日志还留着 —— 变成了没有归属的孤儿工时');

  await pool.query('delete from customers where id = $1', [custId]);
});

test('删合同时，不符合项要留下但断开关联（它是独立的质量记录）', async () => {
  /*
    第三种处理方式：SET NULL。
    不符合项本身是质量体系的记录，合同删了它还该在（审核时要查），
    只是不再指向那份合同。
  */
  const custId = uid('CU');
  const ctId = uid('CT');
  const auditId = uid('AU');
  await pool.query(`insert into customers (id, name) values ($1, '外键测试客户3')`, [custId]);
  await pool.query(`insert into contracts (id, title, customer_id) values ($1, '外键测试合同3', $2)`, [ctId, custId]);
  await pool.query(`insert into audit_issues (id, contract_id) values ($1, $2)`, [auditId, ctId]);

  await pool.query('delete from contracts where id = $1', [ctId]);
  const { rows: [r] } = await pool.query('select contract_id from audit_issues where id = $1', [auditId]);
  assert.ok(r, '不符合项被连坐删掉了 —— 它是独立的质量记录，不该跟着合同走');
  assert.equal(r.contract_id, null, '合同删了，不符合项上还留着指向它的 id');

  await pool.query('delete from audit_issues where id = $1', [auditId]);
  await pool.query('delete from customers where id = $1', [custId]);
});

test('外键列上要有索引 —— 没有的话客户一多，删一个客户要几秒', async () => {
  /*
    这条容易漏：约束加了、功能全对，但**删父记录会全表扫子表**。
    现在数据少看不出来，等合同上千条时就是「点删除转圈好几秒」。
  */
  const { rows } = await pool.query(`
    select indexname from pg_indexes
     where schemaname='public' and indexname in
       ('idx_contracts_customer','idx_projects_customer','idx_worklogs_project',
        'idx_audit_contract','idx_audit_customer','idx_audit_project')`);
  const have = new Set(rows.map((r) => r.indexname));
  for (const want of ['idx_contracts_customer', 'idx_projects_customer', 'idx_worklogs_project']) {
    assert.ok(have.has(want), `外键列 ${want} 没有索引 —— 删父记录会全表扫`);
  }
});

test('日常新建没有任何顺序要求 —— 顺序只是清库脚本的事', async () => {
  /*
    金恩来：「删除要照顺序那创建呢？也要按照顺序？
             谁会在使用的时候记住并遵守某个使用顺序呢？这本身也是反人性的设计啊！」

    他说得对，所以这条专门守住：**先建客户再建合同**是唯一要求，
    而这正是人本来就会做的事（没有客户哪来的合同）。
    没有任何"必须先建 A 再建 B 否则出错"的隐藏规则。
  */
  const custId = uid('CU');
  const ctId = uid('CT');
  const projId = uid('PJ');
  await pool.query(`insert into customers (id, name) values ($1, '正常流程客户')`, [custId]);
  // 合同和项目谁先谁后都行
  await pool.query(`insert into projects (id, name, customer_id) values ($1, '正常流程项目', $2)`, [projId, custId]);
  await pool.query(`insert into contracts (id, title, customer_id) values ($1, '正常流程合同', $2)`, [ctId, custId]);
  const { rows: [r] } = await pool.query(
    'select (select count(*) from contracts where id=$1)::int c, (select count(*) from projects where id=$2)::int p',
    [ctId, projId]);
  assert.equal(r.c, 1, '正常流程建合同失败了');
  assert.equal(r.p, 1, '正常流程建项目失败了');

  await pool.query('delete from contracts where id = $1', [ctId]);
  await pool.query('delete from projects where id = $1', [projId]);
  await pool.query('delete from customers where id = $1', [custId]);
});
