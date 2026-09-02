#!/usr/bin/env node
// 建/重建测试数据库。
//
//   npm run test:db:setup          没有就建，然后跑迁移
//   npm run test:db:setup -- --reset   先删库重建（想要干净基线时用）
//
// 为什么需要它：2026-08-21 之前测试没有独立库，直连 .env.local 的生产库跑，
// 往真实业务数据里写了 6 条 fixture。写脏还算轻的——测试里但凡有删除逻辑，
// 删的就是真实合同和客户。现在 tests/helpers/testDb.js 会强制库名以 _test 结尾，
// 不满足就直接抛错拒绝跑，这个脚本负责把那个库准备好。
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import pg from 'pg';
import { loadEnv, maskUrl } from './lib/backupCommon.mjs';

const TEST_DB = 'xinyi_test';
const reset = process.argv.includes('--reset');

const testUrlFrom = (base) => base.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

const main = async () => {
  const base = loadEnv();
  const testUrl = testUrlFrom(base);
  const adminUrl = base.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
  const owner = new URL(base).username;

  console.log(`\n测试库：${maskUrl(testUrl)}`);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = (await admin.query('select 1 from pg_database where datname=$1', [TEST_DB])).rows.length > 0;

    if (exists && reset) {
      // 先断开残留连接，否则 DROP 会被占用阻塞
      await admin.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid <> pg_backend_pid()',
        [TEST_DB]);
      await admin.query(`DROP DATABASE ${TEST_DB}`);
      console.log('  已删除旧测试库');
    }

    if (!exists || reset) {
      await admin.query(`CREATE DATABASE ${TEST_DB} OWNER ${owner}`);
      console.log('  已创建测试库');
    } else {
      console.log('  测试库已存在（要干净基线加 --reset）');
    }
  } finally {
    await admin.end();
  }

  console.log('  跑迁移…\n');
  const r = spawnSync('node', ['scripts/migrate.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, XINYI_DB_URL: testUrl, DATABASE_URL: testUrl },
  });
  if (r.status !== 0) process.exit(r.status || 1);

  console.log('\n✅ 测试库就绪，可以 npm test。\n');
};

main().catch((e) => { console.error('\n准备测试库失败：', e.message); process.exit(1); });
