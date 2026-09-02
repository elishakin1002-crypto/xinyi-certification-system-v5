const backendBase = String(
  process.env.STATE_SYNC_BASE ||
  process.env.DEPLOY_BACKEND_BASE ||
  'http://127.0.0.1:3001'
).replace(/\/$/, '');
const expectedStateMode = String(process.env.STATE_EXPECTED_MODE || '').trim().toLowerCase();
const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
const probeKey = String(process.env.STATE_PERSISTENCE_KEY || `persistence_probe_${Date.now()}`).trim();

const headers = {
  'Content-Type': 'application/json',
  ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
};

const fail = (message) => {
  console.error(`[state-persistence] FAIL: ${message}`);
  process.exit(1);
};

const ensureEnvelope = (body, label) => {
  if (!body || typeof body !== 'object') fail(`${label}: response is not JSON object`);
  for (const key of ['ok', 'code', 'message', 'data']) {
    if (!(key in body)) fail(`${label}: missing envelope field ${key}`);
  }
  if (!body.ok || Number(body.code) !== 0) {
    fail(`${label}: envelope not ok (ok=${String(body.ok)} code=${String(body.code)} message=${String(body.message || '')})`);
  }
};

const assertExpectedMode = async () => {
  const res = await fetch(`${backendBase}/api/state/health`, {
    method: 'GET',
    headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined
  });
  const { text, json } = await readJson(res);
  if (!res.ok) fail(`state health HTTP ${res.status}: ${String(text).slice(0, 160)}`);
  ensureEnvelope(json, 'state-health');

  const mode = String(json?.data?.mode || '').trim().toLowerCase();
  if (!mode) fail('state-health: data.mode is missing');
  if (expectedStateMode && mode !== expectedStateMode) {
    fail(`expected mode=${expectedStateMode}, actual mode=${mode}`);
  }
  return mode;
};

const run = async () => {
  if (!probeKey || !/^[A-Za-z0-9_.:-]+$/.test(probeKey)) {
    fail(`invalid probe key: ${probeKey || '<empty>'}`);
  }

  const mode = await assertExpectedMode();
  const payload = {
    ts: new Date().toISOString(),
    nonce: `${process.pid}-${Math.random().toString(16).slice(2)}`,
    source: 'state-persistence-smoke'
  };

  const writeRes = await fetch(`${backendBase}/api/state/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      datasets: { [probeKey]: payload },
      source: 'state-persistence-smoke'
    })
  });
  const write = await readJson(writeRes);
  if (!writeRes.ok) fail(`write HTTP ${writeRes.status}: ${String(write.text).slice(0, 160)}`);
  ensureEnvelope(write.json, 'write');
  if (Number(write.json?.data?.written || 0) < 1) fail(`write: expected written>=1, actual=${String(write.json?.data?.written)}`);

  const readRes = await fetch(`${backendBase}/api/state/sync?keys=${encodeURIComponent(probeKey)}`, {
    method: 'GET',
    headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined
  });
  const read = await readJson(readRes);
  if (!readRes.ok) fail(`read HTTP ${readRes.status}: ${String(read.text).slice(0, 160)}`);
  ensureEnvelope(read.json, 'read');

  const returned = read.json?.data?.datasets?.[probeKey];
  if (JSON.stringify(returned) !== JSON.stringify(payload)) {
    fail(`readback mismatch for key=${probeKey}`);
  }

  console.log(`[state-persistence] OK: mode=${mode} key=${probeKey} written=1 readback=match`);
};

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
