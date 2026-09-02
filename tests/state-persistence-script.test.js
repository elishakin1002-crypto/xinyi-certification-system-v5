const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runNodeScript } = require('./helpers/cli');

const envelope = (data = {}) => ({
  ok: true,
  code: 0,
  message: 'success',
  data
});

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk || '');
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });

const startStateServer = ({ mismatch = false } = {}) =>
  new Promise((resolve, reject) => {
    const store = {};
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'GET' && req.url === '/api/state/health') {
        res.end(JSON.stringify(envelope({ mode: 'postgres' })));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/state/sync') {
        const body = await readBody(req);
        Object.assign(store, body?.datasets || {});
        res.end(JSON.stringify(envelope({ written: Object.keys(body?.datasets || {}).length })));
        return;
      }

      if (req.method === 'GET' && String(req.url || '').startsWith('/api/state/sync')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const key = url.searchParams.get('keys') || '';
        const value = mismatch ? { wrong: true } : store[key];
        res.end(JSON.stringify(envelope({ mode: 'postgres', datasets: { [key]: value }, metadata: {} })));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, code: 2001, message: 'not found', data: {} }));
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('failed to resolve server address')));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

test('state persistence smoke passes when write can be read back', async () => {
  const { server, baseUrl } = await startStateServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/state-persistence-smoke.mjs',
      env: {
        STATE_SYNC_BASE: baseUrl,
        STATE_EXPECTED_MODE: 'postgres',
        STATE_PERSISTENCE_KEY: 'persistence_probe_test'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /readback=match/);
  } finally {
    await closeServer(server);
  }
});

test('state persistence smoke fails when readback differs', async () => {
  const { server, baseUrl } = await startStateServer({ mismatch: true });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/state-persistence-smoke.mjs',
      env: {
        STATE_SYNC_BASE: baseUrl,
        STATE_EXPECTED_MODE: 'postgres',
        STATE_PERSISTENCE_KEY: 'persistence_probe_test'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stderr, /readback mismatch/);
  } finally {
    await closeServer(server);
  }
});
