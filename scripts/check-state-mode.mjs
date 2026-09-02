const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();
const expectedMode = String(process.env.STATE_EXPECTED_MODE || 'postgres').trim().toLowerCase();
const endpoint = String(process.env.STATE_HEALTH_URL || 'http://127.0.0.1:3001/api/state/health').trim();

const headers = apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined;

const run = async () => {
  try {
    const res = await fetch(endpoint, { method: 'GET', headers });
    const raw = await res.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (!res.ok || !body || typeof body !== 'object') {
      console.error(`[state-mode] FAIL: invalid response (HTTP ${res.status}) ${String(raw).slice(0, 160)}`);
      process.exit(1);
    }

    const mode = String(body?.data?.mode || '').toLowerCase();
    if (!mode) {
      console.error(`[state-mode] FAIL: response missing data.mode -> ${JSON.stringify(body).slice(0, 200)}`);
      process.exit(1);
    }

    if (mode !== expectedMode) {
      console.error(`[state-mode] FAIL: expected mode=${expectedMode}, actual mode=${mode}`);
      process.exit(1);
    }

    console.log(`[state-mode] OK: mode=${mode}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[state-mode] FAIL: ${msg}`);
    process.exit(1);
  }
};

run();
