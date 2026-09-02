const expectedMode = String(process.env.AUTH_EXPECTED_MODE || 'postgres').trim().toLowerCase();
const endpoint = String(process.env.AUTH_HEALTH_URL || 'http://127.0.0.1:3001/api/auth/health').trim();
const expectedMinUsersRaw = String(process.env.AUTH_EXPECTED_MIN_USERS || '').trim();
const expectedMinUsers = expectedMinUsersRaw ? Number(expectedMinUsersRaw) : 0;

const run = async () => {
  try {
    if (expectedMinUsersRaw && (!Number.isFinite(expectedMinUsers) || expectedMinUsers < 0)) {
      console.error(`[auth-mode] FAIL: AUTH_EXPECTED_MIN_USERS must be a non-negative number, actual=${expectedMinUsersRaw}`);
      process.exit(1);
    }

    const res = await fetch(endpoint, { method: 'GET' });
    const raw = await res.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (!res.ok || !body || typeof body !== 'object') {
      console.error(`[auth-mode] FAIL: invalid response (HTTP ${res.status}) ${String(raw).slice(0, 160)}`);
      process.exit(1);
    }

    const mode = String(body?.data?.mode || '').toLowerCase();
    if (!mode) {
      console.error(`[auth-mode] FAIL: response missing data.mode -> ${JSON.stringify(body).slice(0, 200)}`);
      process.exit(1);
    }

    if (mode !== expectedMode) {
      console.error(`[auth-mode] FAIL: expected mode=${expectedMode}, actual mode=${mode}`);
      process.exit(1);
    }

    if (expectedMinUsersRaw) {
      const users = Number(body?.data?.users);
      if (!Number.isFinite(users) || users < expectedMinUsers) {
        console.error(`[auth-mode] FAIL: expected users>=${expectedMinUsers}, actual users=${Number.isFinite(users) ? users : 'missing'}`);
        process.exit(1);
      }
      console.log(`[auth-mode] OK: mode=${mode} users=${users}`);
      return;
    }

    console.log(`[auth-mode] OK: mode=${mode}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[auth-mode] FAIL: ${msg}`);
    process.exit(1);
  }
};

run();
