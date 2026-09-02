// 批次1 专用 Postgres 连接池。
// 读取 XINYI_DB_URL（与全局 DATABASE_URL 解耦，渐进迁移用）。
// 未配置时 isEnabled() 返回 false，调用方应回退到旧的 state store 逻辑。
const { Pool } = require('pg');

const DB_URL = String(process.env.XINYI_DB_URL || '').trim();
const PG_SSL = String(process.env.XINYI_DB_SSLMODE || process.env.PGSSLMODE || '').toLowerCase() === 'require';

let pool = null;

const isEnabled = () => Boolean(DB_URL);

const getPool = () => {
  if (!isEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DB_URL,
      ssl: PG_SSL ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.XINYI_DB_POOL_MAX || 10)
    });
  }
  return pool;
};

const query = (text, params = []) => {
  const p = getPool();
  if (!p) throw new Error('XINYI_DB_URL 未配置，批次1 数据库不可用');
  return p.query(text, params);
};

// 事务辅助：传入 async (client) => {...}，自动 BEGIN/COMMIT/ROLLBACK。
const withTransaction = async (fn) => {
  const p = getPool();
  if (!p) throw new Error('XINYI_DB_URL 未配置，批次1 数据库不可用');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const health = async () => {
  if (!isEnabled()) return { mode: 'disabled', ready: false, reason: 'XINYI_DB_URL not set' };
  try {
    const r = await query('SELECT 1 AS ok');
    return { mode: 'postgres', ready: r.rows?.[0]?.ok === 1, reason: 'connected' };
  } catch (error) {
    return { mode: 'postgres', ready: false, reason: error?.message || 'connect failed' };
  }
};

module.exports = { isEnabled, getPool, query, withTransaction, health };
