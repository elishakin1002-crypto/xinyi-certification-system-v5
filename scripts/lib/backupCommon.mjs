// 备份/恢复公用逻辑（P0-9）。
//
// 设计要点：
// 1. 备份不只存数据，还存一份「指纹」——每张表的行数 + 内容校验和。
//    只比行数是不够的：行数对得上、字段内容坏掉的备份照样是废的，
//    而这种坏法只有在真出事那天去恢复时才会发现，那时已经晚了。
// 2. 文件和数据库必须一起备份。合同附件、审核证据存在磁盘上，
//    只恢复数据库的话，记录还在但点开是 404。
// 3. 任何恢复动作默认不许覆盖源库，必须显式指定目标。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);

// libpq 是 keg-only，brew 装完不在 PATH 里，这里主动找一遍，
// 免得部署到新机器上因为「命令找不到」而静默跳过备份。
const PG_BIN_CANDIDATES = [
  process.env.XINYI_PG_BIN,
  '/opt/homebrew/opt/libpq/bin',
  '/usr/local/opt/libpq/bin',
  '/usr/pgsql-16/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin',
  '/usr/local/bin',
].filter(Boolean);

export const resolvePgTool = (name) => {
  for (const dir of PG_BIN_CANDIDATES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return name; // 交给 PATH，找不到时报错信息由调用方给
};

export const loadEnv = () => {
  // .env.local 优先（本地开发），部署环境直接用进程环境变量
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] !== undefined) continue; // 已存在的环境变量优先
      process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const url = String(process.env.XINYI_DB_URL || process.env.DATABASE_URL || '').trim();
  if (!url) throw new Error('未找到 XINYI_DB_URL（检查 .env.local 或环境变量）');
  return url;
};

// 打日志/报错时绝不能把库密码带出来
export const maskUrl = (url) => String(url).replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@');
export const dbNameOf = (url) => { try { return new URL(url).pathname.replace(/^\//, '') || 'postgres'; } catch { return 'unknown'; } };
export const withDbName = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

export const ts = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

/**
 * 采集数据指纹：每张表的行数 + 内容校验和。
 * 校验和用「整行文本按序拼接后取 md5」，能发现行数相同但内容被改坏的情况。
 */
export const collectFingerprint = async (pool) => {
  const { rows: tables } = await pool.query(
    "select tablename from pg_tables where schemaname='public' order by 1"
  );
  const out = {};
  for (const { tablename } of tables) {
    // 表名来自 pg_tables（不是外部输入），双引号转义后拼接
    const ident = `public."${tablename.replace(/"/g, '""')}"`;
    const { rows } = await pool.query(
      `select count(*)::int as n,
              coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') as checksum
         from ${ident} t`
    );
    out[tablename] = { rows: rows[0].n, checksum: rows[0].checksum };
  }
  return out;
};

/**
 * 除 PostgreSQL 之外还有一批数据只存在 JSON 文件里，必须一起备份。
 *
 * 2026-08-17 排查发现：工作日志 29 条、不符合项、任务模板、AI 决策日志
 * 都只写进 state_store.json，PG 里对应的表是空的；员工账号也只在
 * auth_store.json。只备份 PG 的话，这些数据一份都救不回来
 * ——而工作日志和不符合项恰恰是最值钱的那部分数据。
 *
 * 路径与 server/stateStore.js、server/authStore.js 的解析规则保持一致。
 */
export const stateFilePaths = () => {
  const cwd = process.cwd();
  const candidates = [
    process.env.STATE_STORE_PATH || process.env.XINYI_STATE_STORE_PATH,
    path.resolve(cwd, '.runtime/state_store.json'),
    path.resolve(cwd, 'server/state_store.json'),
    process.env.AUTH_STORE_PATH || process.env.XINYI_AUTH_STORE_PATH,
    path.resolve(cwd, '.runtime/auth_store.json'),
    path.resolve(cwd, '.runtime/dev-auth-store.json'),
    path.resolve(cwd, '.runtime/intel_store.json'),
    path.resolve(cwd, 'server/intel_store.json'),
  ].filter(Boolean).map((p) => path.resolve(cwd, p));

  const seen = new Set();
  return candidates.filter((p) => {
    if (seen.has(p) || !fs.existsSync(p)) return false;
    seen.add(p);
    return true;
  });
};

/** 统计上传目录的文件数与总字节，用于校验文件是否完整恢复 */
export const scanUploads = (dir) => {
  const stat = { files: 0, bytes: 0 };
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { stat.files += 1; stat.bytes += fs.statSync(p).size; }
    }
  };
  walk(dir);
  return stat;
};

/**
 * 校验 pg_dump 客户端版本与服务端是否匹配。
 *
 * 两个方向的后果完全不同：
 *   客户端 > 服务端：dump 里可能带上老服务端不认识的参数，恢复时报告警（可忍）；
 *   客户端 < 服务端：pg_dump 直接拒绝执行，或者更糟——导出的数据不完整。
 * 所以低版本客户端要当错误拦下来，高版本只提醒。
 */
export const checkPgVersion = async (pool) => {
  const { rows } = await pool.query('show server_version');
  const serverMajor = parseInt(String(rows[0].server_version).split('.')[0], 10);
  const r = await run(resolvePgTool('pg_dump'), ['--version']);
  const m = String(r.stdout || '').match(/(\d+)/);
  const clientMajor = m ? parseInt(m[1], 10) : NaN;
  if (!Number.isFinite(clientMajor)) return { ok: true, note: '无法识别 pg_dump 版本，跳过校验' };
  if (clientMajor < serverMajor) {
    return {
      ok: false,
      note: `pg_dump ${clientMajor} 低于服务端 PostgreSQL ${serverMajor}，导出可能不完整。`
        + `\n   装匹配版本后重试：brew install postgresql@${serverMajor}`,
    };
  }
  if (clientMajor > serverMajor) {
    return { ok: true, note: `pg_dump ${clientMajor} 高于服务端 ${serverMajor}，恢复时会有可忽略的参数告警；生产环境建议装 postgresql@${serverMajor} 保持一致。` };
  }
  return { ok: true, note: null, matched: `${clientMajor}` };
};

export const run = async (cmd, args, opts = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 256, ...opts });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
  }
};

export const human = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);
