#!/usr/bin/env node
// 数据备份（P0-9）：数据库 + 上传文件 + 数据指纹，三样一起存。
//
//   npm run backup                    备份到 .runtime/backups/
//   npm run backup -- --out /path     指定输出目录
//
// 产物结构：
//   <out>/xinyi-<时间戳>/
//     database.dump    pg_dump 自定义格式（已压缩，可单表恢复）
//     uploads.tar.gz   合同附件、审核证据等磁盘文件
//     manifest.json    行数 + 校验和 + 文件统计，恢复时用来比对
//
// 为什么不用云厂商自带备份就够了：
//   ① 云备份只能整库回滚，恢复不了单张表；
//   ② 备份和数据在同一个账号下，账号出问题就一起没了；
//   ③ 它不备份磁盘上的附件。
// 云备份继续开着，这份是自己手里能验证、能带走的那份。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import {
  loadEnv, maskUrl, dbNameOf, ts, collectFingerprint, scanUploads,
  resolvePgTool, run, human, checkPgVersion, stateFilePaths,
} from './lib/backupCommon.mjs';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const main = async () => {
  const url = loadEnv();
  const outRoot = path.resolve(argOf('out', process.env.XINYI_BACKUP_DIR || '.runtime/backups'));
  const uploadDir = path.resolve(process.env.XINYI_UPLOAD_DIR || '.runtime/uploads');
  const stamp = ts();
  const dir = path.join(outRoot, `xinyi-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`\n备份目标库：${maskUrl(url)}`);
  console.log(`输出目录：  ${dir}\n`);

  // 1. 先采指纹，再 dump。顺序很重要：指纹要能代表 dump 里的内容，
  //    先采后 dump，中间新增的数据会让校验和对不上（宁可误报，不可漏报）。
  const pool = new pg.Pool({
    connectionString: url,
    ssl: String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require'
      ? { rejectUnauthorized: false } : undefined,
  });
  // 版本不匹配的备份可能是残缺的，宁可现在就停，也不要留一份不能用的备份
  const ver = await checkPgVersion(pool);
  if (!ver.ok) { console.error(`\n⛔ ${ver.note}\n`); await pool.end(); process.exit(1); }
  if (ver.note) console.log(`ℹ️  ${ver.note}\n`);

  process.stdout.write('① 采集数据指纹 ... ');
  const fingerprint = await collectFingerprint(pool);
  const totalRows = Object.values(fingerprint).reduce((s, t) => s + t.rows, 0);
  console.log(`${Object.keys(fingerprint).length} 张表 / ${totalRows} 行`);
  await pool.end();

  // 2. 数据库 dump
  process.stdout.write('② 导出数据库     ... ');
  const dumpFile = path.join(dir, 'database.dump');
  const pgDump = resolvePgTool('pg_dump');
  const r = await run(pgDump, ['--format=custom', '--no-owner', '--no-acl', '--file', dumpFile, url]);
  if (!r.ok) {
    console.log('失败');
    console.error(`\npg_dump 出错：\n${r.stderr}\n`);
    console.error('若提示找不到命令，装客户端后重试：brew install libpq');
    process.exit(1);
  }
  const dumpBytes = fs.statSync(dumpFile).size;
  console.log(human(dumpBytes));

  // 3. 上传文件
  process.stdout.write('③ 打包上传文件   ... ');
  const uploads = scanUploads(uploadDir);
  const tarFile = path.join(dir, 'uploads.tar.gz');
  if (uploads.files > 0) {
    const t = await run('tar', ['-czf', tarFile, '-C', path.dirname(uploadDir), path.basename(uploadDir)]);
    if (!t.ok) { console.log('失败'); console.error(t.stderr); process.exit(1); }
    console.log(`${uploads.files} 个文件 / ${human(uploads.bytes)}`);
  } else {
    console.log('无文件，跳过');
  }

  // 4. JSON 状态文件：工作日志、不符合项、任务模板、员工账号都只在这里，
  //    只备 PG 的话这些一份都救不回来
  process.stdout.write('④ 备份状态文件   ... ');
  const stateFiles = stateFilePaths();
  const stateDir = path.join(dir, 'state');
  const stateManifest = [];
  if (stateFiles.length) {
    fs.mkdirSync(stateDir, { recursive: true });
    for (const src of stateFiles) {
      // 用相对路径当文件名，避免 .runtime/ 和 server/ 下的同名文件互相覆盖
      const rel = path.relative(process.cwd(), src).split(path.sep).join('__');
      const dst = path.join(stateDir, rel);
      fs.copyFileSync(src, dst);
      stateManifest.push({ source: path.relative(process.cwd(), src), stored: rel, bytes: fs.statSync(dst).size });
    }
    console.log(`${stateFiles.length} 个文件 / ${human(stateManifest.reduce((s2, f) => s2 + f.bytes, 0))}`);
  } else {
    console.log('未找到，跳过');
  }

  // 5. 清单
  const manifest = {
    createdAt: new Date().toISOString(),
    database: dbNameOf(url),
    tables: fingerprint,
    totalRows,
    uploads,
    stateFiles: stateManifest,
    files: {
      database: { name: 'database.dump', bytes: dumpBytes },
      uploads: uploads.files > 0 ? { name: 'uploads.tar.gz', bytes: fs.statSync(tarFile).size } : null,
    },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n✅ 备份完成  ${dir}`);
  console.log(`   ${Object.keys(fingerprint).length} 张表 · ${totalRows} 行 · ${uploads.files} 个附件 · ${stateManifest.length} 个状态文件\n`);
  console.log('⚠️  备份没演练过等于没有。跑一次恢复演练：npm run backup:drill\n');
};

main().catch((e) => { console.error('\n备份失败：', e.message); process.exit(1); });
