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

const startCustomerServer = ({ mismatch = false } = {}) =>
  new Promise((resolve, reject) => {
    const customers = [];
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/api/customers') {
        res.end(JSON.stringify(envelope({ customers })));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/customers') {
        const body = await readBody(req);
        const customer = {
          ...(body?.customer || {}),
          id: body?.customer?.id || `C-SMOKE-${Date.now()}`,
          followUpRecords: Array.isArray(body?.customer?.followUpRecords) ? body.customer.followUpRecords : []
        };
        customers.unshift(customer);
        res.statusCode = 201;
        res.end(JSON.stringify(envelope({ customer, written: 1 })));
        return;
      }

      const customerMatch = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
      if (customerMatch && req.method === 'GET') {
        const customer = customers.find((item) => item.id === decodeURIComponent(customerMatch[1]));
        if (!customer) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Customer not found', data: {} }));
          return;
        }
        res.end(JSON.stringify(envelope({ customer: mismatch ? { ...customer, name: 'mismatch' } : customer })));
        return;
      }

      if (customerMatch && req.method === 'PATCH') {
        const body = await readBody(req);
        const idx = customers.findIndex((item) => item.id === decodeURIComponent(customerMatch[1]));
        if (idx < 0) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Customer not found', data: {} }));
          return;
        }
        customers[idx] = { ...customers[idx], ...(body?.customer || {}) };
        res.end(JSON.stringify(envelope({ customer: customers[idx], written: 1 })));
        return;
      }

      const followUpMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/follow-ups$/);
      if (followUpMatch && req.method === 'POST') {
        const body = await readBody(req);
        const idx = customers.findIndex((item) => item.id === decodeURIComponent(followUpMatch[1]));
        if (idx < 0) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Customer not found', data: {} }));
          return;
        }
        const record = { ...(body?.record || {}), id: body?.record?.id || `F-SMOKE-${Date.now()}` };
        customers[idx] = {
          ...customers[idx],
          followUpRecords: [...(Array.isArray(customers[idx].followUpRecords) ? customers[idx].followUpRecords : []), record]
        };
        res.statusCode = 201;
        res.end(JSON.stringify(envelope({ customer: customers[idx], record, written: 1 })));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state/sync') {
        res.end(JSON.stringify(envelope({ mode: 'postgres', datasets: { customers_v8: customers }, metadata: {} })));
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

test('customers api smoke passes when create/update/follow-up can be read back', async () => {
  const { server, baseUrl } = await startCustomerServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/customers-api-smoke.mjs',
      env: {
        CUSTOMERS_API_BASE: baseUrl,
        XINYI_API_AUTH_TOKEN: 'token'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /SUMMARY \| total=8 pass=8 fail=0/);
    assert.match(out.stdout, /PASS \| state-customers-readback/);
  } finally {
    await closeServer(server);
  }
});

test('customers api smoke fails when readback does not match written customer', async () => {
  const { server, baseUrl } = await startCustomerServer({ mismatch: true });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/customers-api-smoke.mjs',
      env: {
        CUSTOMERS_API_BASE: baseUrl,
        XINYI_API_AUTH_TOKEN: 'token'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| customer-create-readback|FAIL \| customer-update-readback/);
  } finally {
    await closeServer(server);
  }
});
