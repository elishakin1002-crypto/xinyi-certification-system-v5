const backendBase = process.env.STABILITY_BACKEND_BASE || 'http://127.0.0.1:3001';
const proxyBase = process.env.STABILITY_PROXY_BASE || 'http://127.0.0.1:3000';

const ensureEnvelope = (obj) => {
  if (!obj || typeof obj !== 'object') return { pass: false, reason: 'not-json-object' };
  for (const k of ['ok', 'code', 'message', 'data']) {
    if (!(k in obj)) return { pass: false, reason: `missing-${k}` };
  }
  return { pass: true, reason: '' };
};

const request = async (name, base, path, init) => {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, init);
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    const env = ensureEnvelope(json);
    return {
      name,
      pass: res.ok && env.pass,
      status: res.status,
      elapsedMs,
      reason: env.pass ? '' : env.reason,
      code: json?.code,
      ok: json?.ok,
      message: json?.message,
      data: json?.data
    };
  } catch (error) {
    return {
      name,
      pass: false,
      status: 0,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error ? error.message : String(error),
      code: undefined,
      ok: undefined,
      message: undefined,
      data: undefined
    };
  }
};

const run = async () => {
  const checks = [];

  checks.push(await request('backend-health', backendBase, '/api/ai/health', { method: 'GET' }));
  checks.push(await request('proxy-health', proxyBase, '/api/ai/health', { method: 'GET' }));
  checks.push(await request('ai-selftest', backendBase, '/api/ai/selftest', { method: 'GET' }));

  checks.push(await request('ai-generate', backendBase, '/api/ai/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'kimi-k2.5', prompt: [{ role: 'user', parts: [{ text: 'ping' }] }] })
  }));

  checks.push(await request('state-sync-write', backendBase, '/api/state/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ datasets: { stability_probe_v1: { ts: new Date().toISOString() } }, source: 'stability-smoke' })
  }));

  checks.push(await request('state-sync-read', backendBase, '/api/state/sync?keys=stability_probe_v1', { method: 'GET' }));
  checks.push(await request('intel-latest', backendBase, '/api/intel/latest', { method: 'GET' }));

  checks.push(await request('intel-fetch', backendBase, '/api/intel/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ regions: ['温州'], industries: ['塑料编织制品制造业'], limit: 2 })
  }));

  const summary = {
    total: checks.length,
    pass: checks.filter(c => c.pass).length,
    fail: checks.filter(c => !c.pass).length,
    generatedAt: new Date().toISOString()
  };

  checks.forEach((c) => {
    const flag = c.pass ? 'PASS' : 'FAIL';
    const core = `${flag} | ${c.name} | HTTP ${c.status} | ${c.elapsedMs}ms | ok=${String(c.ok)} code=${String(c.code)}`;
    const msg = c.message ? ` | msg=${String(c.message).slice(0, 80)}` : '';
    const reason = c.reason ? ` | reason=${c.reason}` : '';
    console.log(core + msg + reason);
  });

  console.log(`SUMMARY | total=${summary.total} pass=${summary.pass} fail=${summary.fail} generatedAt=${summary.generatedAt}`);

  if (summary.fail > 0) process.exit(1);
};

run();
