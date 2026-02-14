const fs = require('fs');
const path = require('path');

const fileStorePath = path.resolve(__dirname, './state_store.json');
const MAX_DATASET_KEY_LENGTH = 128;
const DATASET_KEY_PATTERN = /^[a-zA-Z0-9_.:-]+$/;

let pool = null;
let backend = {
  mode: 'file',
  ready: false,
  reason: 'not-initialized'
};

const nowIso = () => new Date().toISOString();

const ensureFileStore = () => {
  if (!fs.existsSync(fileStorePath)) {
    fs.writeFileSync(
      fileStorePath,
      JSON.stringify({ updatedAt: nowIso(), datasets: {} }, null, 2)
    );
  }
};

const readFileStore = () => {
  try {
    ensureFileStore();
    const raw = fs.readFileSync(fileStorePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { updatedAt: nowIso(), datasets: {} };
    }
    return {
      updatedAt: parsed.updatedAt || nowIso(),
      datasets: parsed.datasets && typeof parsed.datasets === 'object' ? parsed.datasets : {}
    };
  } catch (error) {
    return { updatedAt: nowIso(), datasets: {} };
  }
};

const writeFileStore = (store) => {
  fs.writeFileSync(fileStorePath, JSON.stringify(store, null, 2));
};

const normalizeDatasetKey = (rawKey) => {
  const key = String(rawKey || '').trim();
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

const usePostgres = () => {
  const url = String(process.env.DATABASE_URL || '').trim();
  return Boolean(url);
};

const initPostgresStore = async () => {
  // Lazy import so non-DB environments work without requiring pg.
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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
  if (!usePostgres()) {
    ensureFileStore();
    backend = {
      mode: 'file',
      ready: true,
      reason: 'DATABASE_URL not configured'
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
  const entries = normalizeDatasetEntries(datasets);
  entries.forEach(([datasetKey, datasetValue]) => {
    store.datasets[datasetKey] = {
      value: datasetValue,
      updatedAt: now,
      source: meta.source || 'frontend',
      actorUserId: meta.actorUserId || '',
      clientId: meta.clientId || '',
      appVersion: meta.appVersion || ''
    };
  });
  store.updatedAt = now;
  writeFileStore(store);
  return { written: entries.length };
};

const upsertStateBatchPostgres = async (datasets, meta) => {
  const entries = normalizeDatasetEntries(datasets);
  if (entries.length === 0) return { written: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let written = 0;
    for (const [datasetKey, datasetValue] of entries) {
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

      await client.query(
        `
          INSERT INTO app_state_history (
            dataset_key, dataset_value, source, actor_user_id, client_id, app_version
          ) VALUES ($1, $2::jsonb, $3, $4, $5, $6);
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
  if (!backend.ready) await initStateStore();
  if (backend.mode === 'postgres' && pool) {
    return upsertStateBatchPostgres(datasets, meta);
  }
  return upsertStateBatchFile(datasets, meta);
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
      updatedAt: store.datasets[key].updatedAt || '',
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
    latestUpdateAt: store.updatedAt || ''
  };
};

module.exports = {
  initStateStore,
  upsertStateBatch,
  getStateBatch,
  getStateHealth
};
