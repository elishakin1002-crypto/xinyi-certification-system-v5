#!/usr/bin/env node
// 数据恢复（P0-9）。
//
//   npm run restore -- --from <备份目录> --target <目标库URL>
//   npm run restore -- --from <备份目录> --target <URL> --verify-only   只校验不写入
//
// 安全设计：真出事那天人是慌的，脚本必须挡住手滑。
//   ① --target 必填，不给就退出，绝不「默认恢复到当前库」；
//   ② 目标库和 .env.local 里的当前库同名时，要再加 --i-know-this-overwrites-production；
//   ③ 恢复完自动比对指纹，对不上就报错——不给「看起来成功」的假象。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  loadEnv, maskUrl, dbNameOf, collectFingerprint, scanUploads,
  resolvePgTool, run, human,
} from './lib/backupCommon.mjs';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const ssl = () => (String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
  ? { rejectUnauthorized: false } : undefined);

/** 逐表比对恢复结果与备份清单，返回差异列表 */
export const compareFingerprint = (expected, actual) => {
  const diffs = [];
  for (const [table, exp] of Object.entries(expected)) {
    const act = actual[table];
    if (!act) { diffs.push({ table, issue: '表缺失', expected: `${exp.rows} 行`, actual: '不存在' }); continue; }
    if (act.rows !== exp.rows) diffs.push({ table, issue: '行数不符', expected: exp.rows, actual: act.rows });
    else if (act.checksum !== exp.checksum) diffs.push({ table, issue: '内容校验和不符', expected: exp.checksum.slice(0, 12), actual: act.checksum.slice(0, 12) });
  }
  for (const table of Object.keys(actual)) {
    if (!expected[table]) diffs.push({ table, issue: '多出的表', expected: '无', actual: `${actual[table].rows} 行` });
  }
  return diffs;
};

const main = async () => {
  const currentUrl = (() => { try { return loadEnv(); } catch { return ''; } })();
  const from = argOf('from');
  const target = argOf('target');
  const verifyOnly = hasFlag('verify-only');

  if (!from) { console.error('缺少 --from <备份目录>'); process.exit(1); }
  if (!target) {
    console.error('缺少 --target <目标库URL>。');
    console.error('这是刻意的：恢复必须显式指定目标，不会默认写当前库。');
    process.exit(1);
  }
  const manifestPath = path.join(path.resolve(from), 'manifest.json');
  if (!fs.existsSync(manifestPath)) { console.error(`找不到清单：${manifestPath}`); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 覆盖生产库的二次确认
  if (currentUrl && dbNameOf(target) === dbNameOf(currentUrl) && !hasFlag('i-know-this-overwrites-production')) {
    console.error(`\n⛔ 目标库「${dbNameOf(target)}」与当前配置的库同名，这会覆盖现有数据。`);
    console.error('   确认要这么做，加上 --i-know-this-overwrites-production 再跑。\n');
    process.exit(1);
  }

  console.log(`\n备份来源：${from}`);
  console.log(`备份时间：${manifest.createdAt}`);
  console.log(`恢复目标：${maskUrl(target)}`);
  console.log(`预期数据：${Object.keys(manifest.tables).length} 张表 / ${manifest.totalRows} 行 / ${manifest.uploads.files} 个附件\n`);

  if (!verifyOnly) {
    process.stdout.write('① 恢复数据库   ... ');
    const pgRestore = resolvePgTool('pg_restore');
    const r = await run(pgRestore, [
      '--clean', '--if-exists', '--no-owner', '--no-acl',
      '--dbname', target, path.join(from, 'database.dump'),
    ]);
    // pg_restore 对「删除不存在的对象」会报 warning，有 warning 但表齐了就算成功，
    // 所以这里不看退出码，改看后面的指纹比对——那才是真的证据。
    console.log(r.ok ? '完成' : '完成（有告警）');
    if (!r.ok && process.env.XINYI_RESTORE_VERBOSE) console.log(r.stderr);

    const tarFile = path.join(from, 'uploads.tar.gz');
    if (fs.existsSync(tarFile)) {
      process.stdout.write('② 恢复上传文件 ... ');
      const uploadDir = path.resolve(process.env.XINYI_UPLOAD_DIR || '.runtime/uploads');
      fs.mkdirSync(path.dirname(uploadDir), { recursive: true });
      const t = await run('tar', ['-xzf', tarFile, '-C', path.dirname(uploadDir)]);
      console.log(t.ok ? '完成' : `失败：${t.stderr}`);
    }
    // 状态文件：工作日志、不符合项、员工账号都在这里，缺了等于没恢复
    const stateDir = path.join(from, 'state');
    if (fs.existsSync(stateDir) && Array.isArray(manifest.stateFiles) && manifest.stateFiles.length) {
      process.stdout.write('③ 恢复状态文件 ... ');
      let done = 0;
      for (const f of manifest.stateFiles) {
        const src = path.join(stateDir, f.stored);
        if (!fs.existsSync(src)) continue;
        const dst = path.resolve(process.cwd(), f.source);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        done += 1;
      }
      console.log(`${done}/${manifest.stateFiles.length} 个`);
    }
  }

  // 校验：这一步才是恢复演练的意义所在
  process.stdout.write('④ 比对数据指纹 ... ');
  const pool = new pg.Pool({ connectionString: target, ssl: ssl() });
  const actual = await collectFingerprint(pool);
  await pool.end();
  const diffs = compareFingerprint(manifest.tables, actual);

  const uploadDir = path.resolve(process.env.XINYI_UPLOAD_DIR || '.runtime/uploads');
  const nowUploads = scanUploads(uploadDir);
  const fileOk = nowUploads.files >= manifest.uploads.files;

  // 状态文件是否都落到位（字节数一致即认为完好）
  const stateMissing = (manifest.stateFiles || []).filter((f) => {
    const dst = path.resolve(process.cwd(), f.source);
    return !fs.existsSync(dst) || fs.statSync(dst).size !== f.bytes;
  });

  if (diffs.length === 0 && fileOk && stateMissing.length === 0) {
    console.log('全部一致\n');
    console.log(`✅ 恢复校验通过`);
    console.log(`   ${Object.keys(actual).length} 张表 · ${manifest.totalRows} 行 · 附件 ${nowUploads.files}/${manifest.uploads.files} (${human(nowUploads.bytes)}) · 状态文件 ${(manifest.stateFiles || []).length} 个\n`);
    return;
  }

  console.log('发现差异\n');
  if (diffs.length) {
    console.log('表级差异：');
    for (const d of diffs) console.log(`  ✗ ${d.table.padEnd(24)} ${d.issue}：期望 ${d.expected}，实际 ${d.actual}`);
  }
  if (!fileOk) console.log(`  ✗ 附件数量：期望 ${manifest.uploads.files}，实际 ${nowUploads.files}`);
  for (const f of stateMissing) console.log(`  ✗ 状态文件未恢复或大小不符：${f.source}`);
  console.log('\n❌ 恢复校验未通过——这份备份不可信，不要拿它去救生产。\n');
  process.exit(1);
};

// 用 pathToFileURL 而不是拼 `file://${argv[1]}`：项目目录名含中文，
// import.meta.url 是 percent 编码的，直接拼字符串永远比不相等，main() 就不会跑。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('\n恢复失败：', e.message); process.exit(1); });
}
