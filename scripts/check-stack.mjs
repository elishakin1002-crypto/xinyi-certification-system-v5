const apiToken = String(process.env.XINYI_API_AUTH_TOKEN || process.env.API_AUTH_TOKEN || '').trim();

const check = async (name, url) => {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[${name}] HTTP ${res.status} ${text.slice(0, 120)}`);
      return false;
    }
    console.log(`[${name}] OK ${res.status} ${text.slice(0, 120)}`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[${name}] FAIL ${msg}`);
    return false;
  }
};

const run = async () => {
  const backend = await check('backend /api/ai/health', 'http://127.0.0.1:3001/api/ai/health');
  const proxy = await check('frontend proxy /api/ai/health', 'http://127.0.0.1:3000/api/ai/health');
  if (backend && proxy) {
    console.log('[stack] all healthy');
    process.exit(0);
  }
  console.error('[stack] unhealthy');
  process.exit(1);
};

run();
