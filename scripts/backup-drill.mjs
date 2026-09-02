#!/usr/bin/env node
// 恢复演练（P0-9 的核心）。
//
//   npm run backup:drill
//
// 做四件事，全程不碰生产库：
//   备份 → 建一个临时库 → 把备份恢复进去 → 逐表比对指纹 → 删掉临时库
//
// 为什么必须演练：备份脚本写完跑通不代表备份可用。
// 常见的坏法是「备份天天在跑，出事那天才发现恢复不了」——
// 权限不对、版本不兼容、附件没备进去、大对象丢失，
// 这些只有真恢复一次才会暴露。
//
// 建议：上线前跑一次，之后每月跑一次，换服务器/升级数据库版本后必跑。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import {
  loadEnv, maskUrl, dbNameOf, withDbName, ts, collectFingerprint,
  resolvePgTool, run, human, checkPgVersion,
} from './lib/backupCommon.mjs';
import { compareFingerprint } from './restore.mjs';

const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

const step = (n, label) => process.stdout.write(`${n} ${label.padEnd(18)} ... `);

const main = async () => {
  const url = loadEnv();
  const srcDb = dbNameOf(url);
  const drillDb = `xinyi_drill_${ts().replace(/-/g, '_')}`;
  const backupDir = path.resolve('.runtime/backups', `drill-${ts()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log('\n═══ 恢复演练 ═══');
  console.log(`源库：  ${maskUrl(url)}`);
  console.log(`临时库：${drillDb}（演练结束自动删除）\n`);

  let created = false;
  const admin = new pg.Pool({ connectionString: withDbName(url, 'postgres'), ssl: ssl() });

  try {
    // ① 备份源库
    step('①', '备份源库');
    const src = new pg.Pool({ connectionString: url, ssl: ssl() });
    const ver = await checkPgVersion(src);
    if (!ver.ok) { await src.end(); throw new Error(ver.note); }
    const fingerprint = await collectFingerprint(src);
    await src.end();
    const totalRows = Object.values(fingerprint).reduce((s, t) => s + t.rows, 0);
    const dumpFile = path.join(backupDir, 'database.dump');
    const d = await run(resolvePgTool('pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '--file', dumpFile, url]);
    if (!d.ok) throw new Error(`pg_dump 失败：${d.stderr}`);
    console.log(`${Object.keys(fingerprint).length} 张表 / ${totalRows} 行 / ${human(fs.statSync(dumpFile).size)}`);
    if (ver.note) console.log(`   ℹ️  ${ver.note}`);

    // ② 建临时库
    step('②', '建临时库');
    await admin.query(`create database "${drillDb}"`);
    created = true;
    console.log(drillDb);

    // ③ 恢复进临时库
    step('③', '恢复到临时库');
    const targetUrl = withDbName(url, drillDb);
    const r = await run(resolvePgTool('pg_restore'), ['--no-owner', '--no-acl', '--dbname', targetUrl, dumpFile]);
    console.log(r.ok ? '完成' : '完成（有告警）');
    if (!r.ok && process.env.XINYI_RESTORE_VERBOSE) console.log(r.stderr);

    // ④ 比对——演练的全部意义在这一步
    step('④', '逐表比对');
    const dst = new pg.Pool({ connectionString: targetUrl, ssl: ssl() });
    const actual = await collectFingerprint(dst);
    await dst.end();
    const diffs = compareFingerprint(fingerprint, actual);
    console.log(diffs.length === 0 ? '全部一致' : `${diffs.length} 处差异`);

    console.log('');
    for (const [t, exp] of Object.entries(fingerprint)) {
      const bad = diffs.find((x) => x.table === t);
      console.log(`  ${bad ? '✗' : '✓'} ${t.padEnd(22)} ${String(exp.rows).padStart(5)} 行  ${bad ? bad.issue : ''}`);
    }

    if (diffs.length) {
      console.log('\n❌ 演练失败——备份恢复后与源库不一致，上线前必须查清楚。\n');
      process.exitCode = 1;
    } else {
      console.log(`\n✅ 演练通过：${totalRows} 行数据完整恢复，内容校验和逐表一致。`);
      console.log(`   这份备份是可用的。\n`);
    }
  } catch (e) {
    console.log('失败');
    console.error(`\n❌ 演练中断：${e.message}\n`);
    if (/permission denied to create database/i.test(e.message)) {
      console.error('数据库账号没有建库权限。两个办法：');
      console.error('  a) 给账号加 CREATEDB 权限；');
      console.error('  b) 人工建一个空库，用 npm run restore -- --from <目录> --target <该库URL> 演练。\n');
    }
    process.exitCode = 1;
  } finally {
    // 临时库必须删掉，否则演练几次就攒一堆库
    if (created) {
      process.stdout.write('⑤ 清理临时库        ... ');
      await admin.query(`drop database if exists "${drillDb}" with (force)`).catch(() => {});
      console.log('已删除');
    }
    await admin.end().catch(() => {});
    // 演练产生的 dump 也不留，避免明文业务数据散落在磁盘上
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log(`   演练产物已清理（源库 ${srcDb} 未做任何改动）\n`);
  }
};

main().catch((e) => { console.error('演练失败：', e.message); process.exit(1); });
