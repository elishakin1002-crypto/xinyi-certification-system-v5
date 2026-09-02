#!/usr/bin/env node
// 清空测试库的业务数据，保留表结构和迁移记录。每轮 npm test 前自动跑（pretest）。
//
// 为什么需要：测试库是持久的，上一轮建的线索、合同、账号会留到下一轮，
// 于是「新建后列表里应该只有 1 条」这类断言从第二轮开始就失败。
// 2026-08-21 第一次接上真实 PG 时，一次就红了 17 个用例，全是这个原因。
//
// 只 TRUNCATE，不 DROP：结构由迁移管理，这里只负责把数据清干净。
// schema_migrations 必须保留，否则下一轮会重跑全部迁移。
import process from 'node:process';
import pg from 'pg';

const TEST_DB_SUFFIX = /_test$/;

// 追加式账本表也要清——它有拒绝 DELETE 的触发器，得先停用再恢复。
// 生产库上这个触发器是保护线，测试库上它只是碍事。
const LEDGER_TABLES = ['business_events'];

const KEEP = new Set(['schema_migrations']);

const main = async () => {
  // 复用测试助手的解析逻辑，避免两处各写一份「测试库在哪」
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const url = require('../tests/helpers/testDb').testEnv().XINYI_DB_URL || '';
  if (!url) {
    console.log('未配置测试库，跳过清理（测试会落到文件回退路径）。');
    return;
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!TEST_DB_SUFFIX.test(name)) {
    console.error(`⛔ 拒绝清空非测试库："${name}" 不以 _test 结尾。`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select tablename from pg_tables where schemaname='public'");
    const tables = rows.map((r) => r.tablename).filter((t) => !KEEP.has(t));
    if (!tables.length) { console.log('测试库里没有可清理的表。'); return; }

    for (const t of LEDGER_TABLES) {
      if (tables.includes(t)) await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    }
    await client.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of LEDGER_TABLES) {
      if (tables.includes(t)) await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    }
    console.log(`测试库已清空（${tables.length} 张表）。`);
  } finally {
    await client.end();
  }
};

main().catch((e) => { console.error('清理测试库失败：', e.message); process.exit(1); });
