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

const startLeadServer = ({ mismatch = false } = {}) =>
  new Promise((resolve, reject) => {
    const leads = [];
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/api/leads') {
        res.end(JSON.stringify(envelope({ leads })));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/leads') {
        const body = await readBody(req);
        const lead = {
          ...(body?.lead || {}),
          id: body?.lead?.id || `L-SMOKE-${Date.now()}`,
          followUpRecords: Array.isArray(body?.lead?.followUpRecords) ? body.lead.followUpRecords : []
        };
        leads.unshift(lead);
        res.statusCode = 201;
        res.end(JSON.stringify(envelope({ lead, written: 1 })));
        return;
      }

      const leadMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
      if (leadMatch && req.method === 'GET') {
        const lead = leads.find((item) => item.id === decodeURIComponent(leadMatch[1]));
        if (!lead) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Lead not found', data: {} }));
          return;
        }
        res.end(JSON.stringify(envelope({ lead: mismatch ? { ...lead, company: 'mismatch' } : lead })));
        return;
      }

      if (leadMatch && req.method === 'PATCH') {
        const body = await readBody(req);
        const idx = leads.findIndex((item) => item.id === decodeURIComponent(leadMatch[1]));
        if (idx < 0) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Lead not found', data: {} }));
          return;
        }
        leads[idx] = { ...leads[idx], ...(body?.lead || {}) };
        res.end(JSON.stringify(envelope({ lead: leads[idx], written: 1 })));
        return;
      }

      const followUpMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/follow-ups$/);
      if (followUpMatch && req.method === 'POST') {
        const body = await readBody(req);
        const idx = leads.findIndex((item) => item.id === decodeURIComponent(followUpMatch[1]));
        if (idx < 0) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Lead not found', data: {} }));
          return;
        }
        const record = { ...(body?.record || {}), id: body?.record?.id || `F-SMOKE-${Date.now()}` };
        leads[idx] = {
          ...leads[idx],
          followUpRecords: [...(Array.isArray(leads[idx].followUpRecords) ? leads[idx].followUpRecords : []), record]
        };
        res.statusCode = 201;
        res.end(JSON.stringify(envelope({ lead: leads[idx], record, written: 1 })));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state/sync') {
        res.end(JSON.stringify(envelope({ mode: 'postgres', datasets: { leads_v8: leads }, metadata: {} })));
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

test('leads api smoke passes when create/update/follow-up can be read back', async () => {
  const { server, baseUrl } = await startLeadServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/leads-api-smoke.mjs',
      env: {
        LEADS_API_BASE: baseUrl,
        XINYI_API_AUTH_TOKEN: 'token'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /SUMMARY \| total=8 pass=8 fail=0/);
    assert.match(out.stdout, /PASS \| state-leads-readback/);
  } finally {
    await closeServer(server);
  }
});

test('leads api smoke fails when readback does not match written lead', async () => {
  const { server, baseUrl } = await startLeadServer({ mismatch: true });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/leads-api-smoke.mjs',
      env: {
        LEADS_API_BASE: baseUrl,
        XINYI_API_AUTH_TOKEN: 'token'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| lead-create-readback|FAIL \| lead-update-readback/);
  } finally {
    await closeServer(server);
  }
});
