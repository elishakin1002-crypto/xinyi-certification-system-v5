import dns from 'node:dns/promises';

const rawHost = String(process.env.TEST_HOST || process.env.TEST_DOMAIN || '').trim();
const allowHttp = ['1', 'true', 'yes', 'on'].includes(String(process.env.DOMAIN_SMOKE_ALLOW_HTTP || '').trim().toLowerCase());
const allowLocalhost = ['1', 'true', 'yes', 'on'].includes(String(process.env.DOMAIN_SMOKE_ALLOW_LOCALHOST || '').trim().toLowerCase());
const skipDns = ['1', 'true', 'yes', 'on'].includes(String(process.env.DOMAIN_SMOKE_SKIP_DNS || '').trim().toLowerCase());
const timeoutMs = Number(process.env.DOMAIN_SMOKE_TIMEOUT_MS || 10000);

const checks = [];

const add = (name, pass, detail = {}) => {
  checks.push({ name, pass, ...detail });
};

const normalizeUrl = (value) => {
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
};

const resolveDns = async (hostname) => {
  try {
    const records = await dns.resolveAny(hostname);
    return records.length > 0 ? records : [{ type: 'NONE' }];
  } catch (error) {
    try {
      const records = await dns.lookup(hostname, { all: true });
      return records.map((record) => ({ type: record.family === 6 ? 'AAAA' : 'A', address: record.address }));
    } catch {
      throw error;
    }
  }
};

const fetchWithTimeout = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 10000);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
};

const run = async () => {
  const url = normalizeUrl(rawHost);
  if (!url) {
    add('test-host-present', false, { reason: 'TEST_HOST or TEST_DOMAIN is required' });
  } else {
    add('test-host-present', true, { host: url.hostname });
  }

  if (url) {
    const protocolOk = url.protocol === 'https:' || allowHttp;
    add('https-required', protocolOk, {
      protocol: url.protocol,
      reason: protocolOk ? '' : 'test domain must use https; set DOMAIN_SMOKE_ALLOW_HTTP=1 only for local script tests'
    });

    const hostOk = allowLocalhost || !/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i.test(url.hostname);
    add('non-localhost-domain', hostOk, {
      host: url.hostname,
      reason: hostOk ? '' : 'test domain must not be localhost; set DOMAIN_SMOKE_ALLOW_LOCALHOST=1 only for local script tests'
    });
  }

  if (url && !skipDns) {
    try {
      const records = await resolveDns(url.hostname);
      add('dns-resolves', records.length > 0, {
        records: records.map((record) => record.type || record.family || 'UNKNOWN').join(',')
      });
    } catch (error) {
      add('dns-resolves', false, {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  } else if (url) {
    add('dns-resolves', true, { reason: 'skipped' });
  }

  if (url) {
    try {
      const rootUrl = new URL('/', url);
      const res = await fetchWithTimeout(rootUrl);
      const text = await res.text();
      const hasRootMarker = /<div[^>]+id=["']root["']|<script[^>]+type=["']module["']/i.test(text);
      const pass = res.ok && hasRootMarker;
      add('frontend-root-loads', pass, {
        status: res.status,
        finalUrl: res.url,
        reason: pass ? '' : 'frontend root marker missing or non-2xx response'
      });
    } catch (error) {
      add('frontend-root-loads', false, {
        status: 0,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  checks.forEach((check) => {
    const flag = check.pass ? 'PASS' : 'FAIL';
    const fields = [
      flag,
      check.name,
      check.host ? `host=${check.host}` : '',
      check.protocol ? `protocol=${check.protocol}` : '',
      check.records ? `records=${check.records}` : '',
      check.status !== undefined ? `HTTP ${check.status}` : '',
      check.finalUrl ? `url=${check.finalUrl}` : '',
      check.reason ? `reason=${check.reason}` : ''
    ].filter(Boolean);
    console.log(fields.join(' | '));
  });

  const fail = checks.filter((check) => !check.pass).length;
  console.log(`SUMMARY | total=${checks.length} pass=${checks.length - fail} fail=${fail} generatedAt=${new Date().toISOString()}`);
  if (fail > 0) process.exit(1);
};

run().catch((error) => {
  console.error(`[test-domain-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
