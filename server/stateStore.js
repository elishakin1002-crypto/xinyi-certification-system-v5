const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { protectedKeys, mergeRows, conflict } = require('./services/stateMerge');

const legacyFileStorePath = path.resolve(__dirname, './state_store.json');
const fileStorePath = (() => {
  const configured = String(process.env.STATE_STORE_PATH || process.env.XINYI_STATE_STORE_PATH || '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), '.runtime/state_store.json');
})();
const MAX_DATASET_KEY_LENGTH = 128;
const DATASET_KEY_PATTERN = /^[a-z0-9_]+$/;

let pool = null;
let backend = {
  mode: 'file',
  ready: false,
  reason: 'not-initialized'
};

const parseBoolean = (raw, fallback = false) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const requirePostgres = () => parseBoolean(
  process.env.XINYI_REQUIRE_POSTGRES ?? process.env.REQUIRE_POSTGRES,
  false
);

const nowIso = () => new Date().toISOString();

const normalizeFileRecord = (record, fallbackNow) => {
  const row = record && typeof record === 'object' ? record : {};
  return {
    value: Object.prototype.hasOwnProperty.call(row, 'value') ? row.value : row.dataset_value,
    updated_at: row.updated_at || row.updatedAt || fallbackNow,
    source: row.source || 'frontend',
    actor_user_id: row.actor_user_id || row.actorUserId || '',
    client_id: row.client_id || row.clientId || '',
    app_version: row.app_version || row.appVersion || ''
  };
};

const ensureFileStore = () => {
  const dir = path.dirname(fileStorePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(fileStorePath) && fs.existsSync(legacyFileStorePath)) {
    try {
      fs.copyFileSync(legacyFileStorePath, fileStorePath);
      return;
    } catch {
      // noop: fallback to empty store initialization
    }
  }

  if (!fs.existsSync(fileStorePath)) {
    fs.writeFileSync(
      fileStorePath,
      JSON.stringify({ updated_at: nowIso(), datasets: {} }, null, 2)
    );
  }
};

const readFileStore = () => {
  try {
    ensureFileStore();
    const raw = fs.readFileSync(fileStorePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { updated_at: nowIso(), datasets: {} };
    }
    const normalizedDatasets = {};
    const datasetEntries = parsed.datasets && typeof parsed.datasets === 'object' ? parsed.datasets : {};
    const now = nowIso();
    Object.entries(datasetEntries).forEach(([key, value]) => {
      const normalizedKey = normalizeDatasetKey(key);
      if (!normalizedKey) return;
      normalizedDatasets[normalizedKey] = normalizeFileRecord(value, now);
    });
    return {
      updated_at: parsed.updated_at || parsed.updatedAt || nowIso(),
      datasets: normalizedDatasets
    };
  } catch (error) {
    return { updated_at: nowIso(), datasets: {} };
  }
};

const writeFileStore = (store) => {
  fs.writeFileSync(fileStorePath, JSON.stringify(store, null, 2));
};

const normalizeDatasetKey = (rawKey) => {
  const key = String(rawKey || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.:-]+/g, '_')
    .toLowerCase();
  if (!key) return '';
  if (key.length > MAX_DATASET_KEY_LENGTH) return '';
  if (!DATASET_KEY_PATTERN.test(key)) return '';
  return key;
};

const normalizeDatasetEntries = (datasets) => {
  if (!datasets || typeof datasets !== 'object') return [];
  return Object.entries(datasets)
    .map(([key, value]) => [normalizeDatasetKey(key), value])
    .filter(([key]) => Boolean(key));
};

/*
  同一个数据库历史上存在两个变量名：本文件用 DATABASE_URL，
  系统其余部分用 XINYI_DB_URL。DATABASE_URL 从没设过，
  于是 PG 后端从未初始化、建表语句根本没执行，一切静默落回 JSON 文件——
  工作日志、不符合项、任务模板因此被困在文件里，SQL 和 AI 都查不到。
  这里做兼容解析，两个变量任一存在即可。
*/
const resolveDbUrl = () => String(process.env.DATABASE_URL || process.env.XINYI_DB_URL || '').trim();

const usePostgres = () => Boolean(resolveDbUrl());

const initPostgresStore = async () => {
  // Lazy import so non-DB environments work without requiring pg.
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: resolveDbUrl(),
    ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : undefined
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state_latest (
      dataset_key TEXT PRIMARY KEY,
      dataset_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT,
      actor_user_id TEXT,
      client_id TEXT,
      app_version TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state_history (
      id BIGSERIAL PRIMARY KEY,
      dataset_key TEXT NOT NULL,
      dataset_value JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT,
      actor_user_id TEXT,
      client_id TEXT,
      app_version TEXT
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_app_state_history_dataset_time
    ON app_state_history (dataset_key, created_at DESC);
  `);
};

const initStateStore = async () => {
  const mustUsePostgres = requirePostgres();
  if (!usePostgres()) {
    if (mustUsePostgres) {
      backend = {
        mode: 'file',
        ready: false,
        reason: 'postgres-required-but-database-url-missing'
      };
      throw new Error('XINYI_REQUIRE_POSTGRES=true 但 DATABASE_URL / XINYI_DB_URL 都未配置');
    }
    ensureFileStore();
    backend = {
      mode: 'file',
      ready: true,
      reason: 'DATABASE_URL / XINYI_DB_URL 均未配置'
    };
    return backend;
  }

  try {
    await initPostgresStore();
    backend = {
      mode: 'postgres',
      ready: true,
      reason: 'connected'
    };
  } catch (error) {
    if (mustUsePostgres) {
      backend = {
        mode: 'postgres',
        ready: false,
        reason: `postgres-required-connect-failed: ${error?.message || 'unknown'}`
      };
      throw error;
    }
    ensureFileStore();
    backend = {
      mode: 'file',
      ready: true,
      reason: `postgres-failed: ${error?.message || 'unknown'}`
    };
  }

  return backend;
};

const upsertStateBatchFile = async (datasets, meta) => {
  const store = readFileStore();
  const now = nowIso();
  const entries = normalizeDatasetEntries(datasets).map(([key, value]) => [key,
    protectedKeys.has(key) && meta.baseDatasets
      ? mergeRows(key, meta.baseDatasets[key], value, store.datasets[key]?.value || []) : value]);
  entries.forEach(([datasetKey, datasetValue]) => {
    store.datasets[datasetKey] = {
      value: datasetValue,
      updated_at: now,
      source: meta.source || 'frontend',
      actor_user_id: meta.actorUserId || '',
      client_id: meta.clientId || '',
      app_version: meta.appVersion || ''
    };
  });
  store.updated_at = now;
  writeFileStore(store);
  return { written: entries.length };
};


/**
 * 写入前比一下条数，掉太多就留下痕迹。
 *
 * **绝不抛异常**：这是观察设施，不能反过来让保存失败。
 * 检测本身出错时静默跳过——那时最坏的结果是少一条提示，
 * 而抛出去会让用户存不了数据。
 */
const warnOnShrinkage = async (entries, meta) => {
  try {
    const ts = require('typescript');
    const fsx = require('fs');
    const pathx = require('path');
    if (!warnOnShrinkage._mod) {
      const src = fsx.readFileSync(pathx.join(__dirname, '../src/modules/state_guard/shrinkage.ts'), 'utf8');
      const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
      const m = { exports: {} };
      new Function('module', 'exports', js)(m, m.exports);
      warnOnShrinkage._mod = m.exports;
    }
    const { checkShrinkage, countOf } = warnOnShrinkage._mod;

    const keys = entries.map(([k]) => k);
    const { rows } = await pool.query(
      'SELECT dataset_key, dataset_value FROM app_state_latest WHERE dataset_key = ANY($1::text[])', [keys]);
    const beforeByKey = new Map(rows.map((r) => [r.dataset_key, countOf(r.dataset_value)]));

    for (const [key, value] of entries) {
      const before = beforeByKey.get(key);
      const after = countOf(value);
      if (before === undefined || before < 0 || after < 0) continue;   // 非数组数据集不适用

      const v = checkShrinkage(key, before, after);
      if (!v.suspicious) continue;

      console.warn(`[stateGuard] ⚠️  ${v.reason}`);
      /*
        写进业务事件账本。console 会被日志轮转冲掉，
        而这条记录是「某次保存吃掉了数据」的唯一长期证据，
        也是事后能顺着时间点去 app_state_history 翻回去的线索。
      */
      try {
        const { businessEventRepo } = require('./repos/businessEventRepo');
        await businessEventRepo.recordDenied({
          actor: { id: meta.actorUserId || '', name: '', roles: [] },
          action: 'STATE_SHRINK_WARNING',
          resource: { type: 'dataset', id: key },
          policy: 'state.shrink',
          reason: v.reason,
        });
      } catch { /* 记账失败不影响保存 */ }
    }
  } catch (e) {
    console.warn('[stateGuard] 缩水检测出错，已跳过：', e?.message || e);
  }
};

const upsertStateBatchPostgres = async (datasets, meta) => {
  const entries = normalizeDatasetEntries(datasets);
  if (entries.length === 0) return { written: 0 };

  /*
    ── 缩水检测（2026-09-01 补）──────────────────────────────────
    整份数组写入的老毛病：两个地方各持一份副本，后写的盖掉先写的。
    2026-08-28 就这么丢过 11 个员工账号，**没有任何报错**。

    app_state_history 每次写都留完整快照，所以理论上都能翻回去。
    但真正的问题是**没人会发现**——页面上就是「少了几条」，
    等三个月后有人问「那个客户怎么没了」，备份早轮转掉了。

    所以这里只报警不拦截：拦了会误伤真实的批量清理，
    而一个会误伤的保护最后一定会被要求关掉。
  */
  await warnOnShrinkage(entries, meta);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let written = 0;
    // Lock projected tables in a stable order: row-level API writes also respect these locks.
    const guarded = entries.filter(([key]) => protectedKeys.has(key) && meta.baseDatasets).sort(([a], [b]) => a.localeCompare(b));
    const { PROJECTED, projectDataset } = require('./services/relationalProjection');
    for (const [key] of guarded) {
      await client.query(`LOCK TABLE ${PROJECTED[key].table} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const { filterDeleted } = require('./services/tombstones');

    for (const entry of entries) {
      const [datasetKey] = entry;
      let datasetValue = entry[1];

      /*
        ── 按墓碑过滤（2026-09-14）─────────────────────────────────

        金恩来：「我希望合同删了又回来是真的解决了。」

        病根是这里：前端整份写回，而它手上那份数组可能还带着
        服务端已经删掉的记录 —— 写回去，它就活了。
        没有任何报错：删除接口返回 200，列表上也确实没了，
        刷新之后才发现它又在。

        所以在落库之前先过一遍墓碑：被删过的 id 直接剔掉。
        前端写回什么都无所谓了 —— **删掉的东西在架构上回不来**。

        剔掉了要记日志。悄悄剔除和悄悄写回一样糟：
        真出问题时，至少要能在日志里看见"这里剔了几条、哪几条"。
      */
      const filtered = await filterDeleted((t, v) => client.query(t, v), datasetKey, datasetValue);
      if (filtered.removed.length) {
        console.log(`[状态库] ${datasetKey} 写回时剔掉 ${filtered.removed.length} 条已删除记录：${filtered.removed.join(', ')}`);
        datasetValue = filtered.value;
        entry[1] = filtered.value;
      }

      if (protectedKeys.has(datasetKey) && meta.baseDatasets) {
        const conf = PROJECTED[datasetKey];
        const current = await client.query(`SELECT * FROM ${conf.table}`);
        const currentRows = current.rows.map(conf.repo.fromRow);
        datasetValue = mergeRows(datasetKey, meta.baseDatasets[datasetKey], datasetValue, currentRows);
        if (datasetKey === 'audit_issues_v1') {
          await require('./services/auditTaskSync').syncAuditTasks(client, currentRows, datasetValue);
        }
        await projectDataset(client, datasetKey, datasetValue, true);
      }
      await client.query(
        `
          INSERT INTO app_state_latest (
            dataset_key, dataset_value, updated_at, source, actor_user_id, client_id, app_version
          ) VALUES ($1, $2::jsonb, NOW(), $3, $4, $5, $6)
          ON CONFLICT (dataset_key)
          DO UPDATE SET
            dataset_value = EXCLUDED.dataset_value,
            updated_at = NOW(),
            source = EXCLUDED.source,
            actor_user_id = EXCLUDED.actor_user_id,
            client_id = EXCLUDED.client_id,
            app_version = EXCLUDED.app_version;
        `,
        [
          datasetKey,
          JSON.stringify(datasetValue ?? null),
          meta.source || 'frontend',
          meta.actorUserId || '',
          meta.clientId || '',
          meta.appVersion || ''
        ]
      );

      /*
        ── 内容没变就不写历史（2026-09-14）──────────────────────────

        金恩来：「数据库的备份怎么会有 4002 份这么多？这完全不合理啊！」
        他是对的。查下来不是"存了 4002 次备份"，是**同一份内容存了几百遍**：
          leads_v8          382 版，去重后 43 种，191 MB
          market_signals_v1 313 版，去重后 **2** 种，94 MB
        前端是「整份读、整份写回」的模式，不管有没有改动都写一次，
        这里就照单全收地存一份全量快照。约 88% 是逐字节相同的副本。

        所以写之前先比哈希。注意比的是**同一个 dataset_key 的上一版**，
        不是全表去重 —— 内容 A→B→A 是真实的三次变更，中间那次回退要留着。
      */
      const payload = JSON.stringify(datasetValue ?? null);
      const contentHash = crypto.createHash('md5').update(payload).digest('hex');
      const { rows: [prev] } = await client.query(
        'SELECT content_hash FROM app_state_history WHERE dataset_key = $1 ORDER BY id DESC LIMIT 1',
        [datasetKey]
      );

      if (prev?.content_hash !== contentHash) {
        await client.query(
          `
            INSERT INTO app_state_history (
              dataset_key, dataset_value, source, actor_user_id, client_id, app_version, content_hash
            ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7);
          `,
          [
            datasetKey,
            payload,
            meta.source || 'frontend',
            meta.actorUserId || '',
            meta.clientId || '',
            meta.appVersion || '',
            contentHash
          ]
        );
      }
      written += 1;
    }
    await client.query('COMMIT');
    return { written };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const upsertStateBatch = async (datasets, meta = {}) => {
  if (meta.requireProtectedBase) {
    for (const [key] of normalizeDatasetEntries(datasets)) {
      if (protectedKeys.has(key) && !Array.isArray(meta.baseDatasets?.[key])) throw conflict(key);
    }
  }
  if (!backend.ready) await initStateStore();
  const result = (backend.mode === 'postgres' && pool)
    ? await upsertStateBatchPostgres(datasets, meta)
    : await upsertStateBatchFile(datasets, meta);

  /*
    投影到关系表（不符合项、工作日志、任务模板）。

    挂在这里是因为**这是所有数据集写入的唯一入口**——
    /api/state/sync、事务接口、后端服务写的都要过这一关。
    挂在任何一个调用方身上都会漏掉另外几条路。

    放在 state store 写成功之后：关系表是派生数据，
    主存储没写成就不该有派生。projectToRelational 内部只警告不抛，
    投影失败不会让已经成功的业务写入回滚。
  */
  if (backend.mode === 'postgres' && pool) {
    const { projectToRelational } = require('./services/relationalProjection');
    await projectToRelational(Object.fromEntries(Object.entries(datasets).filter(([key]) => !(protectedKeys.has(key) && meta.baseDatasets))), meta);
  }

  return result;
};

const getStateBatchFile = async (keys) => {
  const store = readFileStore();
  const normalizedKeys = Array.isArray(keys)
    ? keys.map(normalizeDatasetKey).filter(Boolean)
    : [];
  const targetKeys = normalizedKeys.length > 0 ? normalizedKeys : Object.keys(store.datasets);
  const datasets = {};
  const metadata = {};
  targetKeys.forEach((key) => {
    if (!store.datasets[key]) return;
    datasets[key] = store.datasets[key].value;
    metadata[key] = {
      updatedAt: store.datasets[key].updated_at || store.datasets[key].updatedAt || '',
      source: store.datasets[key].source || ''
    };
  });
  return { datasets, metadata };
};

const getStateBatchPostgres = async (keys) => {
  const normalizedKeys = Array.isArray(keys)
    ? keys.map(normalizeDatasetKey).filter(Boolean)
    : [];
  const datasets = {};
  const metadata = {};

  const result = normalizedKeys.length > 0
    ? await pool.query(
      `
        SELECT dataset_key, dataset_value, updated_at, source
        FROM app_state_latest
        WHERE dataset_key = ANY($1::text[]);
      `,
      [normalizedKeys]
    )
    : await pool.query(
      `
        SELECT dataset_key, dataset_value, updated_at, source
        FROM app_state_latest;
      `
    );

  result.rows.forEach((row) => {
    datasets[row.dataset_key] = row.dataset_value;
    metadata[row.dataset_key] = {
      updatedAt: row.updated_at,
      source: row.source || ''
    };
  });
  return { datasets, metadata };
};

const getStateBatch = async (keys) => {
  if (!backend.ready) await initStateStore();
  if (backend.mode === 'postgres' && pool) {
    return getStateBatchPostgres(keys);
  }
  return getStateBatchFile(keys);
};

const getStateHealth = async () => {
  if (!backend.ready) await initStateStore();
  if (backend.mode === 'postgres' && pool) {
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM app_state_latest;');
    const latestResult = await pool.query('SELECT MAX(updated_at) AS latest FROM app_state_latest;');
    return {
      mode: 'postgres',
      ready: true,
      reason: backend.reason,
      totalDatasets: countResult.rows[0]?.total || 0,
      latestUpdateAt: latestResult.rows[0]?.latest || ''
    };
  }
  const store = readFileStore();
  return {
    mode: 'file',
    ready: true,
    reason: backend.reason,
    totalDatasets: Object.keys(store.datasets).length,
    latestUpdateAt: store.updated_at || store.updatedAt || ''
  };
};

module.exports = {
  initStateStore,
  upsertStateBatch,
  getStateBatch,
  getStateHealth
};
