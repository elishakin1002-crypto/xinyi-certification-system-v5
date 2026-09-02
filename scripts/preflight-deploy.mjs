import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const cwd = process.cwd();
const loadIfExists = (p) => {
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
};

loadIfExists(path.resolve(cwd, '.env.local'));
loadIfExists(path.resolve(cwd, '.env'));

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.match(/^--([^=]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [String(key), String(value)])
);

const profile = String(args.get('profile') || process.env.PRECHECK_PROFILE || 'test').trim().toLowerCase();
const strict = String(args.get('strict') || process.env.PRECHECK_STRICT || 'true').trim().toLowerCase() !== 'false';

const get = (key) => String(process.env[key] || '').trim();
const parseBoolean = (raw, fallback = false) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
};

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const MIN_DEPLOY_TOKEN_LENGTH = 24;
const MIN_DEPLOY_PASSWORD_LENGTH = 12;
const hasStrongTokenLength = (value) => String(value || '').trim().length >= MIN_DEPLOY_TOKEN_LENGTH;
const hasStrongPasswordLength = (value) => String(value || '').trim().length >= MIN_DEPLOY_PASSWORD_LENGTH;
const isPostgresUrl = (value) => /^postgres(?:ql)?:\/\//i.test(String(value || '').trim());
const isLocalDatabaseUrl = (value) => /(?:localhost|127\.0\.0\.1|\[::1\])/i.test(String(value || ''));
const forbiddenFrontendSecretKeys = Object.keys(process.env)
  .filter((key) => /^VITE_/i.test(key))
  .filter((key) => /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE)/i.test(key))
  .filter((key) => String(process.env[key] || '').trim());

const databaseUrl = get('DATABASE_URL');
const pgSslMode = get('PGSSLMODE').toLowerCase();
const hasAiKey = Boolean(get('KIMI_API_KEY') || get('GEMINI_API_KEY'));
const apiToken = get('XINYI_API_AUTH_TOKEN') || get('API_AUTH_TOKEN');
const authSmokeAccount = get('AUTH_SMOKE_ACCOUNT') || get('XINYI_AUTH_SMOKE_ACCOUNT');
const authSmokePassword = get('AUTH_SMOKE_PASSWORD') || get('XINYI_AUTH_SMOKE_PASSWORD');
const authSeedPassword = get('XINYI_AUTH_SEED_ADMIN_PASSWORD');
const corsAllowedOrigins = get('CORS_ALLOWED_ORIGINS');
const requirePostgres = parseBoolean(get('XINYI_REQUIRE_POSTGRES') || get('REQUIRE_POSTGRES'), false);
const requireAuthPostgres = parseBoolean(get('XINYI_AUTH_REQUIRE_POSTGRES'), false);
const backendBase = get('VITE_AI_BACKEND_URL') || '/api/ai';
const apiAuthRequiredRaw = get('XINYI_API_AUTH_REQUIRED');
const sessionAuthRequired = parseBoolean(get('XINYI_SESSION_AUTH_REQUIRED'), false);
const sessionRoleEnforcement = parseBoolean(get('XINYI_SESSION_ROLE_ENFORCEMENT'), true);
const sessionCookieSecure = parseBoolean(get('XINYI_SESSION_COOKIE_SECURE'), false);
const intelLocalFallbacksEnabled = parseBoolean(get('VITE_INTEL_LOCAL_FALLBACKS_ENABLED'), false);
const stateSyncEnabled = parseBoolean(get('VITE_STATE_SYNC_ENABLED'), true);
const authRequired = parseBoolean(get('VITE_AUTH_REQUIRED'), false);
const leadsApiEnabled = parseBoolean(get('VITE_LEADS_API_ENABLED'), false);
const leadsApiReadEnabled = parseBoolean(get('VITE_LEADS_API_READ_ENABLED'), false);
const leadsApiVerifyWritesEnabled = parseBoolean(get('VITE_LEADS_API_VERIFY_WRITES_ENABLED'), false);
const customersApiEnabled = parseBoolean(get('VITE_CUSTOMERS_API_ENABLED'), false);
const customersApiReadEnabled = parseBoolean(get('VITE_CUSTOMERS_API_READ_ENABLED'), false);
const customersApiVerifyWritesEnabled = parseBoolean(get('VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED'), false);
const contractsApiReadEnabled = parseBoolean(get('VITE_CONTRACTS_API_READ_ENABLED'), false);
const contractsApiWriteEnabled = parseBoolean(get('VITE_CONTRACTS_API_WRITE_ENABLED'), false);
const contractsApiVerifyWritesEnabled = parseBoolean(get('VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED'), false);
const projectsApiReadEnabled = parseBoolean(get('VITE_PROJECTS_API_READ_ENABLED'), false);
const projectsApiWriteEnabled = parseBoolean(get('VITE_PROJECTS_API_WRITE_ENABLED'), false);
const projectsApiVerifyWritesEnabled = parseBoolean(get('VITE_PROJECTS_API_VERIFY_WRITES_ENABLED'), false);
const publicLeadEnabled = parseBoolean(get('XINYI_PUBLIC_LEAD_ENABLED'), false);
const publicLeadToken = get('XINYI_PUBLIC_LEAD_TOKEN');

if (!hasAiKey) {
  warn('Neither KIMI_API_KEY nor GEMINI_API_KEY is configured.');
}

const isTestLike = profile === 'test' || profile === 'staging' || profile === 'prod' || profile === 'production';

if (isTestLike) {
  if (!requirePostgres) {
    fail('XINYI_REQUIRE_POSTGRES must be true in test/staging/prod profile.');
  }
  if (!requireAuthPostgres) {
    fail('XINYI_AUTH_REQUIRE_POSTGRES must be true in test/staging/prod profile.');
  }
  if (!databaseUrl) {
    fail('DATABASE_URL is required in test/staging/prod profile.');
  } else if (!isPostgresUrl(databaseUrl)) {
    fail('DATABASE_URL must use postgres:// or postgresql:// in test/staging/prod profile.');
  } else if (isLocalDatabaseUrl(databaseUrl)) {
    fail('DATABASE_URL must not point to localhost in test/staging/prod profile.');
  }
  if (pgSslMode !== 'require') {
    fail('PGSSLMODE must be require in test/staging/prod profile.');
  }
  if (!hasAiKey) {
    fail('KIMI_API_KEY or GEMINI_API_KEY is required in test/staging/prod profile.');
  }
  if (forbiddenFrontendSecretKeys.length > 0) {
    fail(`Frontend environment variables must not contain secrets in test/staging/prod profile: ${forbiddenFrontendSecretKeys.join(', ')}`);
  }
  if (!apiToken) {
    fail('XINYI_API_AUTH_TOKEN is required in test/staging/prod profile.');
  } else if (!hasStrongTokenLength(apiToken)) {
    fail(`XINYI_API_AUTH_TOKEN must be at least ${MIN_DEPLOY_TOKEN_LENGTH} characters in test/staging/prod profile.`);
  }
  if (!authSmokeAccount) {
    fail('AUTH_SMOKE_ACCOUNT or XINYI_AUTH_SMOKE_ACCOUNT is required in test/staging/prod profile.');
  }
  if (!authSmokePassword) {
    fail('AUTH_SMOKE_PASSWORD or XINYI_AUTH_SMOKE_PASSWORD is required in test/staging/prod profile.');
  } else if (!hasStrongPasswordLength(authSmokePassword)) {
    fail(`AUTH_SMOKE_PASSWORD or XINYI_AUTH_SMOKE_PASSWORD must be at least ${MIN_DEPLOY_PASSWORD_LENGTH} characters in test/staging/prod profile.`);
  }
  if (authSeedPassword && !hasStrongPasswordLength(authSeedPassword)) {
    fail(`XINYI_AUTH_SEED_ADMIN_PASSWORD must be at least ${MIN_DEPLOY_PASSWORD_LENGTH} characters when configured in test/staging/prod profile.`);
  }
  if (!corsAllowedOrigins) {
    fail('CORS_ALLOWED_ORIGINS is required in test/staging/prod profile.');
  }
  const corsOrigins = corsAllowedOrigins.split(',').map((item) => item.trim()).filter(Boolean);
  if (corsOrigins.includes('*')) {
    fail('CORS_ALLOWED_ORIGINS must not contain "*" in test/staging/prod profile.');
  }
  if (corsOrigins.some((origin) => /^http:\/\//i.test(origin))) {
    fail('CORS_ALLOWED_ORIGINS must use https origins in test/staging/prod profile.');
  }
  if (corsOrigins.some((origin) => /localhost|127\.0\.0\.1|\[::1\]/i.test(origin))) {
    fail('CORS_ALLOWED_ORIGINS must not contain localhost origins in test/staging/prod profile.');
  }
  if (apiAuthRequiredRaw && !parseBoolean(apiAuthRequiredRaw, true)) {
    fail('XINYI_API_AUTH_REQUIRED must not be false in test/staging/prod profile.');
  }
  if (!sessionAuthRequired) {
    fail('XINYI_SESSION_AUTH_REQUIRED must be enabled in test/staging/prod profile.');
  }
  if (!sessionRoleEnforcement) {
    fail('XINYI_SESSION_ROLE_ENFORCEMENT must be enabled in test/staging/prod profile.');
  }
  if (!sessionCookieSecure) {
    fail('XINYI_SESSION_COOKIE_SECURE must be enabled in test/staging/prod profile.');
  }
  if (intelLocalFallbacksEnabled) {
    fail('VITE_INTEL_LOCAL_FALLBACKS_ENABLED must be disabled in test/staging/prod profile.');
  }
  if (!stateSyncEnabled) {
    fail('VITE_STATE_SYNC_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!authRequired) {
    fail('VITE_AUTH_REQUIRED must be enabled in test/staging/prod profile.');
  }
  if (!leadsApiEnabled) {
    fail('VITE_LEADS_API_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!leadsApiReadEnabled) {
    fail('VITE_LEADS_API_READ_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!leadsApiVerifyWritesEnabled) {
    fail('VITE_LEADS_API_VERIFY_WRITES_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!customersApiEnabled) {
    fail('VITE_CUSTOMERS_API_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!customersApiReadEnabled) {
    fail('VITE_CUSTOMERS_API_READ_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!customersApiVerifyWritesEnabled) {
    fail('VITE_CUSTOMERS_API_VERIFY_WRITES_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!contractsApiReadEnabled) {
    fail('VITE_CONTRACTS_API_READ_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!contractsApiWriteEnabled) {
    fail('VITE_CONTRACTS_API_WRITE_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!contractsApiVerifyWritesEnabled) {
    fail('VITE_CONTRACTS_API_VERIFY_WRITES_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!projectsApiReadEnabled) {
    fail('VITE_PROJECTS_API_READ_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!projectsApiWriteEnabled) {
    fail('VITE_PROJECTS_API_WRITE_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (!projectsApiVerifyWritesEnabled) {
    fail('VITE_PROJECTS_API_VERIFY_WRITES_ENABLED must be enabled in test/staging/prod profile.');
  }
  if (publicLeadEnabled && !publicLeadToken) {
    fail('XINYI_PUBLIC_LEAD_TOKEN is required when XINYI_PUBLIC_LEAD_ENABLED=true in test/staging/prod profile.');
  } else if (publicLeadEnabled && !hasStrongTokenLength(publicLeadToken)) {
    fail(`XINYI_PUBLIC_LEAD_TOKEN must be at least ${MIN_DEPLOY_TOKEN_LENGTH} characters when XINYI_PUBLIC_LEAD_ENABLED=true in test/staging/prod profile.`);
  }
}

if (/localhost:3001|127\.0\.0\.1:3001/i.test(backendBase)) {
  fail(`VITE_AI_BACKEND_URL should not point to local backend in deploy profile: "${backendBase}"`);
}

if (backendBase && !backendBase.startsWith('/api') && !/^https?:\/\//i.test(backendBase)) {
  warn(`VITE_AI_BACKEND_URL looks unusual: "${backendBase}"`);
}

const mode = strict ? 'strict' : 'non-strict';
console.log(`[preflight] profile=${profile} mode=${mode}`);

if (warnings.length > 0) {
  warnings.forEach((item) => console.warn(`[preflight] WARN: ${item}`));
}

if (errors.length > 0) {
  errors.forEach((item) => console.error(`[preflight] ERROR: ${item}`));
  if (strict) process.exit(1);
}

console.log('[preflight] completed');
