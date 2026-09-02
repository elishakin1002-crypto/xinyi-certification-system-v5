// repo 通用映射工具：API(camelCase, 金额=元) ↔ DB(snake_case, 金额=分)
const crypto = require('crypto');

// kind: text | int | amount(元↔分) | date(YYYY-MM-DD) | json
const fmtDate = (v) => {
  if (!v) return undefined;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  return s ? s.slice(0, 10) : undefined;
};

const toDbValue = (kind, apiVal) => {
  if (apiVal === undefined) return undefined;
  switch (kind) {
    case 'int': {
      const n = Number(apiVal);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    case 'amount': {
      const n = Number(apiVal);
      return Number.isFinite(n) ? Math.round(n * 100) : 0; // 元 → 分
    }
    /*
      不缩放的小数。给工时这类**本身就不是钱**的数值用。

      加这个类型是因为踩了一次：工时用了 amount，0.5 小时被存成 50。
      走仓储读回来是对的（fromDbValue 会除以 100），所以不会报错、
      测试也可能照样绿——但**直接跑 SQL 看到的是 50**。
      而「能用 SQL 统计」正是把工作日志搬进关系表的全部意义。
    */
    case 'decimal': {
      const n = Number(apiVal);
      return Number.isFinite(n) ? n : 0;
    }
    case 'date': {
      const s = String(apiVal || '').trim().slice(0, 10);
      return s || null;
    }
    case 'bool':
      return Boolean(apiVal);
    case 'json':
      return JSON.stringify(apiVal ?? (Array.isArray(apiVal) ? [] : null));
    default: {
      if (apiVal === null) return null;
      const s = String(apiVal);
      return s;
    }
  }
};

const fromDbValue = (kind, dbVal) => {
  if (dbVal === null || dbVal === undefined) return undefined;
  switch (kind) {
    case 'int':
      return Number(dbVal);
    case 'amount':
      return Number(dbVal) / 100; // 分 → 元
    case 'decimal':
      return Number(dbVal);       // 原样，不缩放。见 toDbValue 里的说明
    case 'date':
      return fmtDate(dbVal);
    case 'bool':
      return Boolean(dbVal);
    case 'json':
      return dbVal; // node-pg 已解析 jsonb
    default:
      return dbVal;
  }
};

// spec: [{ api, col, kind }]
const buildMapper = (spec, { extraCol = 'extra_fields', table = '' } = {}) => {
  const apiKeys = new Set(spec.map((s) => s.api));
  const jsonCols = new Set([extraCol, ...spec.filter((s) => s.kind === 'json').map((s) => s.col)]);

  // API 对象 → { columns: {col: value}, } 用于 insert/update
  const toColumns = (apiObj = {}) => {
    const cols = {};
    for (const { api, col, kind } of spec) {
      const v = toDbValue(kind, apiObj[api]);
      if (v !== undefined) cols[col] = v;
    }
    // 收集未提升为列的字段进 extra_fields
    const extra = {};
    for (const [k, v] of Object.entries(apiObj)) {
      if (apiKeys.has(k)) continue;
      if (k === 'createdAt' || k === 'updatedAt') continue;
      extra[k] = v;
    }
    cols[extraCol] = JSON.stringify(extra);
    return cols;
  };

  // DB 行 → API 对象
  const fromRow = (row) => {
    if (!row) return null;
    const out = {};
    for (const { api, col, kind } of spec) {
      const v = fromDbValue(kind, row[col]);
      if (v !== undefined) out[api] = v;
    }
    const extra = row[extraCol];
    if (extra && typeof extra === 'object') Object.assign(out, extra);
    return out;
  };

  // 绑定表名的 SQL 构建器（cols 来自 toColumns）
  const insertSql = (cols) => {
    const keys = Object.keys(cols);
    const ph = keys.map((k, i) => `$${i + 1}${jsonCols.has(k) ? '::jsonb' : ''}`);
    return { text: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`, values: keys.map((k) => cols[k]) };
  };
  const updateSql = (id, cols) => {
    const keys = Object.keys(cols).filter((k) => k !== 'id');
    const sets = keys.map((k, i) => `${k} = $${i + 2}${jsonCols.has(k) ? '::jsonb' : ''}`);
    sets.push('updated_at = NOW()');
    return { text: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values: [id, ...keys.map((k) => cols[k])] };
  };

  // INSERT ... ON CONFLICT(id) DO UPDATE —— 幂等 upsert（用于 /transaction 批量落 PG）
  const upsertSql = (cols) => {
    const keys = Object.keys(cols);
    const ph = keys.map((k, i) => `$${i + 1}${jsonCols.has(k) ? '::jsonb' : ''}`);
    const sets = keys.filter((k) => k !== 'id').map((k) => `${k} = EXCLUDED.${k}`);
    sets.push('updated_at = NOW()');
    return { text: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')} RETURNING *`, values: keys.map((k) => cols[k]) };
  };

  return { toColumns, fromRow, insertSql, updateSql, upsertSql, jsonCols };
};

module.exports = { buildMapper, fmtDate, makeId: (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}` };
