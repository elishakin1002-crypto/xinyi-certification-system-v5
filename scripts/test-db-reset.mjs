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
    /*
      没有测试库时，测试**不会报错**，只会整体落到文件回退路径上 ——
      也就是「测试全绿，但测的不是生产走的那条路」。本机偶尔这样还能接受
      （开发者自己看得到上面那行提示），**在 CI 里则是致命的**：
      没人看日志，只看那个绿勾。

      2026-09-18 实测：CI 从来没有数据库，这行提示每次都打，
      而下面 63 条要连库的用例全部 ECONNREFUSED 挂掉 ——
      挂掉反而是运气好，它们要是"温和降级"就会假绿到上线那天。

      所以把「必须有库」做成显式开关：CI 里置 1，缺库直接红。
      不靠人记得看日志（见 CLAUDE.md 二点五之四）。
    */
    if (String(process.env.XINYI_REQUIRE_TEST_DB || '') === '1') {
      console.error(
        '⛔ XINYI_REQUIRE_TEST_DB=1 但没找到测试库地址。\n' +
        '   这个环境要求测试跑在真的 PostgreSQL 上，不许退到文件回退路径。\n' +
        '   请设置 XINYI_TEST_DB_URL（或 XINYI_DB_URL），并先跑 npm run test:db:setup。'
      );
      process.exit(1);
    }
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

/*
  ── 报错要说清「下一步查什么」（2026-09-14）──────────────────────

  原来只打一句「清理测试库失败：<原始报错>」。
  Codex 撞上之后就卡在那里了 —— 它看不出该去查 Docker、查迁移、
  还是查有没有别的进程正在跑测试。

  这条正是项目自己的规矩：**给用户的文案要说清后果，不要只说不行。**
  这里的"用户"是下一个接手的人（或 AI），三条最常见的原因直接列出来。
*/
main().catch((e) => {
  const msg = String(e?.message || e);
  console.error('\n❌ 清理测试库失败：' + msg + '\n');
  console.error('按这个顺序查（三条覆盖了至今遇到的全部情况）：');
  console.error('  1. 数据库没起来 → docker start xinyi-dev-db，等 5 秒再试');
  if (/lock|deadlock|timeout|being accessed/i.test(msg)) {
    console.error('  2. ★ 报错里带着「锁」字：**有别的进程正在跑测试**');
    console.error('       同一个测试库不能被两个 npm test / playwright 同时清空。');
    console.error('       等对方跑完，或 lsof -nP -iTCP:3001 -sTCP:LISTEN 看谁在占。');
  } else {
    console.error('  2. 有别的进程正在跑测试（同一个测试库不能被两个进程同时清空）→ 等它跑完');
  }
  console.error('  3. 测试库结构落后于代码 → 跑一次：');
  console.error('       XINYI_DB_URL=<测试库地址> node scripts/migrate.mjs');
  console.error('       （测试库地址 = .env.local 里的 DATABASE_URL 把库名换成 xinyi_test）\n');
  process.exit(1);
});
