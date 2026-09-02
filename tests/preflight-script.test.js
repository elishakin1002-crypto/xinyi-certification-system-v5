const test = require('node:test');
const assert = require('node:assert/strict');
const { runNodeScript } = require('./helpers/cli');

test('preflight test profile fails when required deploy env is missing', async () => {
  const out = await runNodeScript({
    scriptPath: 'scripts/preflight-deploy.mjs',
    args: ['--profile=test', '--strict=true'],
    env: {
      XINYI_REQUIRE_POSTGRES: '',
      DATABASE_URL: '',
      PGSSLMODE: '',
      KIMI_API_KEY: '',
      GEMINI_API_KEY: '',
      XINYI_API_AUTH_TOKEN: '',
      AUTH_SMOKE_ACCOUNT: '',
      AUTH_SMOKE_PASSWORD: '',
      CORS_ALLOWED_ORIGINS: '',
      VITE_AI_BACKEND_URL: '/api/ai'
    }
  });

  assert.equal(out.timedOut, false);
  assert.notEqual(out.code, 0);
  assert.match(out.stderr, /DATABASE_URL is required|PGSSLMODE must be require|KIMI_API_KEY or GEMINI_API_KEY is required|XINYI_API_AUTH_TOKEN is required|AUTH_SMOKE_ACCOUNT|AUTH_SMOKE_PASSWORD|CORS_ALLOWED_ORIGINS is required/i);
});

test('preflight test profile passes when required deploy env is set', async () => {
  const out = await runNodeScript({
    scriptPath: 'scripts/preflight-deploy.mjs',
    args: ['--profile=test', '--strict=true'],
    env: {
      XINYI_REQUIRE_POSTGRES: 'true',
      XINYI_AUTH_REQUIRE_POSTGRES: 'true',
      DATABASE_URL: 'postgres://dummy:dummy@db.example.test:5432/dummy',
      PGSSLMODE: 'require',
      KIMI_API_KEY: 'ci-kimi-key-placeholder',
      XINYI_API_AUTH_TOKEN: 'api-token-for-preflight-test',
      AUTH_SMOKE_ACCOUNT: 'admin@example.test',
      AUTH_SMOKE_PASSWORD: 'admin-pass-123',
      XINYI_AUTH_SEED_ADMIN_PASSWORD: 'seed-admin-pass-123',
      XINYI_SESSION_AUTH_REQUIRED: 'true',
      XINYI_SESSION_ROLE_ENFORCEMENT: 'true',
      XINYI_SESSION_COOKIE_SECURE: 'true',
      CORS_ALLOWED_ORIGINS: 'https://example.test',
      VITE_AI_BACKEND_URL: '/api/ai',
      VITE_INTEL_LOCAL_FALLBACKS_ENABLED: '0',
      VITE_STATE_SYNC_ENABLED: '1',
      VITE_AUTH_REQUIRED: '1',
      VITE_LEADS_API_ENABLED: '1',
      VITE_LEADS_API_READ_ENABLED: '1',
      VITE_LEADS_API_VERIFY_WRITES_ENABLED: '1',
      VITE_CUSTOMERS_API_ENABLED: '1',
      VITE_CUSTOMERS_API_READ_ENABLED: '1',
      VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED: '1',
      VITE_CONTRACTS_API_READ_ENABLED: '1',
      VITE_CONTRACTS_API_WRITE_ENABLED: '1',
      VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED: '1',
      VITE_PROJECTS_API_READ_ENABLED: '1',
      VITE_PROJECTS_API_WRITE_ENABLED: '1',
      VITE_PROJECTS_API_VERIFY_WRITES_ENABLED: '1',
      XINYI_PUBLIC_LEAD_ENABLED: 'true',
      XINYI_PUBLIC_LEAD_TOKEN: 'public-lead-token-for-test'
    }
  });

  assert.equal(out.timedOut, false);
  assert.equal(out.code, 0);
  assert.match(out.stdout, /\[preflight\] completed/i);
});

test('preflight test profile rejects unsafe deploy toggles', async () => {
  const out = await runNodeScript({
    scriptPath: 'scripts/preflight-deploy.mjs',
    args: ['--profile=test', '--strict=true'],
    env: {
      XINYI_REQUIRE_POSTGRES: 'true',
      XINYI_AUTH_REQUIRE_POSTGRES: 'false',
      DATABASE_URL: 'postgres://dummy:dummy@localhost:5432/dummy',
      PGSSLMODE: 'disable',
      KIMI_API_KEY: '',
      GEMINI_API_KEY: '',
      XINYI_API_AUTH_TOKEN: 'token',
      AUTH_SMOKE_ACCOUNT: 'admin@example.test',
      AUTH_SMOKE_PASSWORD: 'short',
      XINYI_AUTH_SEED_ADMIN_PASSWORD: 'short',
      XINYI_API_AUTH_REQUIRED: 'false',
      XINYI_SESSION_AUTH_REQUIRED: 'false',
      XINYI_SESSION_ROLE_ENFORCEMENT: 'false',
      XINYI_SESSION_COOKIE_SECURE: 'false',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://example.test,*',
      VITE_AI_BACKEND_URL: '/api/ai',
      VITE_INTEL_LOCAL_FALLBACKS_ENABLED: '1',
      VITE_STATE_SYNC_ENABLED: '0',
      VITE_AUTH_REQUIRED: '0',
      VITE_LEADS_API_ENABLED: '0',
      VITE_LEADS_API_READ_ENABLED: '0',
      VITE_LEADS_API_VERIFY_WRITES_ENABLED: '0',
      VITE_CUSTOMERS_API_ENABLED: '0',
      VITE_CUSTOMERS_API_READ_ENABLED: '0',
      VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED: '0',
      VITE_CONTRACTS_API_READ_ENABLED: '0',
      VITE_CONTRACTS_API_WRITE_ENABLED: '0',
      VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED: '0',
      VITE_PROJECTS_API_READ_ENABLED: '0',
      VITE_PROJECTS_API_WRITE_ENABLED: '0',
      VITE_PROJECTS_API_VERIFY_WRITES_ENABLED: '0',
      VITE_KIMI_API_KEY: 'should-not-be-public',
      XINYI_PUBLIC_LEAD_ENABLED: 'true',
      XINYI_PUBLIC_LEAD_TOKEN: ''
    }
  });

  assert.equal(out.timedOut, false);
  assert.notEqual(out.code, 0);
  assert.match(out.stderr, /must not contain "\*"|must use https origins|must not contain localhost origins|DATABASE_URL must not point to localhost|PGSSLMODE must be require|KIMI_API_KEY or GEMINI_API_KEY is required|must not be false|must be disabled|must be enabled|must be at least 24 characters|must be at least 12 characters|XINYI_PUBLIC_LEAD_TOKEN is required|Frontend environment variables must not contain secrets/i);
});
