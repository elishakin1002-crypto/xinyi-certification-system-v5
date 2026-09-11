#!/usr/bin/env node
// Restore a downloaded backup into a new, temporary LOCAL database only.
// Credentials come from XINYI_RESTORE_TEST_URL; never print or save them.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { collectFingerprint, resolvePgTool } from './lib/backupCommon.mjs';
import { compareFingerprint } from './restore.mjs';

const main = async () => {
  const fromArg = process.argv.indexOf('--from');
  if (fromArg < 0 || !process.argv[fromArg + 1]) throw new Error('需要 --from <备份目录>');
  const dir = path.resolve(process.argv[fromArg + 1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const canonicalPath = path.join(dir, 'canonical-fingerprint.json');
  const canonical = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) : null;
  const url = new URL(process.env.XINYI_RESTORE_TEST_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('只允许本机、库名以 _test 结尾的连接；拒绝连接线上恢复目标');
  }
  const name = `xinyi_restore_${randomBytes(8).toString('hex')}_test`;
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    // Use the container's matching PostgreSQL client when the local client is newer.
    const container = process.env.XINYI_RESTORE_DOCKER_CONTAINER;
    const restored = container
      ? spawnSync('docker', ['exec', '-i', '-e', 'PGPASSWORD', container, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '--username', decodeURIComponent(url.username), '--dbname', name], {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, input: fs.readFileSync(path.join(dir, 'database.dump')), encoding: 'utf8'
      })
      : spawnSync(resolvePgTool('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', url.toString(), path.join(dir, 'database.dump')], { encoding: 'utf8' });
    if (restored.error || restored.status !== 0) throw new Error(`pg_restore 未成功；备份未通过恢复验证：${String(restored.stderr || restored.error?.code || '').replaceAll(url.password, '[redacted]').slice(0, 1500)}`);
    const target = new pg.Client({ connectionString: url.toString() });
    await target.connect();
    // Legacy backup fingerprints render timestamptz in the source session timezone.
    await target.query("SELECT set_config('TimeZone', $1, false)", [canonical ? 'UTC' : process.env.XINYI_BACKUP_SOURCE_TIMEZONE || 'UTC']);
    let diffs;
    try {
      if (canonical) {
        const tables = (await target.query("select tablename from pg_tables where schemaname='public' order by 1")).rows;
        const actual = {};
        for (const { tablename } of tables) {
          const ident = `public."${tablename.replaceAll('"', '""')}"`;
          const { rows } = await target.query(`select count(*)::int as n, coalesce(md5(string_agg(t::text, '|' order by t::text COLLATE "C")), 'empty') as checksum from ${ident} t`);
          actual[tablename] = { rows: rows[0].n, checksum: rows[0].checksum };
        }
        diffs = compareFingerprint(canonical.tables, actual);
      } else diffs = compareFingerprint(manifest.tables, await collectFingerprint(target));
    }
    finally { await target.end(); }
    if (diffs.length) throw new Error(`恢复后 ${diffs.length} 处数据指纹不一致：${JSON.stringify(diffs)}`);
    console.log(`恢复验证通过：${Object.keys(manifest.tables).length} 张表，${manifest.totalRows} 行，逐表行数及内容校验和一致。`);
    console.log('本次验证数据库恢复；附件和状态文件需另核对传输校验和。');
  } finally {
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
};
main().catch(error => { console.error(error.message); process.exitCode = 1; });
