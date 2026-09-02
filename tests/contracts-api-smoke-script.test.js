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

const startContractServer = ({ mismatch = false } = {}) =>
  new Promise((resolve, reject) => {
    const contracts = [];
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/api/contracts') {
        res.end(JSON.stringify(envelope({ contracts })));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/contracts') {
        const body = await readBody(req);
        const contract = {
          ...(body?.contract || {}),
          id: body?.contract?.id || `CT-SMOKE-${Date.now()}`,
          attachments: Array.isArray(body?.contract?.attachments) ? body.contract.attachments : []
        };
        contracts.unshift(contract);
        res.statusCode = 201;
        res.end(JSON.stringify(envelope({ contract, written: 1 })));
        return;
      }

      const contractMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)$/);
      if (contractMatch && req.method === 'GET') {
        const contract = contracts.find((item) => item.id === decodeURIComponent(contractMatch[1]));
        if (!contract) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Contract not found', data: {} }));
          return;
        }
        res.end(JSON.stringify(envelope({ contract: mismatch ? { ...contract, title: 'mismatch' } : contract })));
        return;
      }

      if (contractMatch && req.method === 'PATCH') {
        const body = await readBody(req);
        const idx = contracts.findIndex((item) => item.id === decodeURIComponent(contractMatch[1]));
        if (idx < 0) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Contract not found', data: {} }));
          return;
        }
        contracts[idx] = { ...contracts[idx], ...(body?.contract || {}) };
        res.end(JSON.stringify(envelope({ contract: contracts[idx], written: 1 })));
        return;
      }

      const attachmentMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)\/attachments$/);
      if (attachmentMatch && req.method === 'POST') {
        const body = await readBody(req);
        const idx = contracts.findIndex((item) => item.id === decodeURIComponent(attachmentMatch[1]));
        if (idx < 0) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, code: 1001, message: 'Contract not found', data: {} }));
          return;
        }
        const attachment = { ...(body?.attachment || {}), id: body?.attachment?.id || `ATT-SMOKE-${Date.now()}` };
        contracts[idx] = {
          ...contracts[idx],
          attachments: [...(Array.isArray(contracts[idx].attachments) ? contracts[idx].attachments : []), attachment]
        };
        res.statusCode = 201;
        res.end(JSON.stringify(envelope({ contract: contracts[idx], attachment, written: 1 })));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state/sync') {
        res.end(JSON.stringify(envelope({ mode: 'postgres', datasets: { contracts_v8: contracts }, metadata: {} })));
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

test('contracts api smoke passes when create/update/attachment can be read back', async () => {
  const { server, baseUrl } = await startContractServer();
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/contracts-api-smoke.mjs',
      env: {
        CONTRACTS_API_BASE: baseUrl,
        XINYI_API_AUTH_TOKEN: 'token'
      }
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /SUMMARY \| total=8 pass=8 fail=0/);
    assert.match(out.stdout, /PASS \| state-contracts-readback/);
  } finally {
    await closeServer(server);
  }
});

test('contracts api smoke fails when readback does not match written contract', async () => {
  const { server, baseUrl } = await startContractServer({ mismatch: true });
  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/contracts-api-smoke.mjs',
      env: {
        CONTRACTS_API_BASE: baseUrl,
        XINYI_API_AUTH_TOKEN: 'token'
      }
    });

    assert.equal(out.timedOut, false);
    assert.notEqual(out.code, 0);
    assert.match(out.stdout, /FAIL \| contract-create-readback|FAIL \| contract-update-readback/);
  } finally {
    await closeServer(server);
  }
});
