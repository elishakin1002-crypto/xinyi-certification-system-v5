import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const stripSlash = (value) => String(value || '').replace(/\/$/, '');
const frontendBaseProvided = Boolean(String(process.env.DEPLOY_FRONTEND_BASE || '').trim());
const backendBaseProvided = Boolean(String(process.env.DEPLOY_BACKEND_BASE || '').trim());
const frontendBase = stripSlash(process.env.DEPLOY_FRONTEND_BASE || 'http://127.0.0.1:3000');
const backendBase = stripSlash(process.env.DEPLOY_BACKEND_BASE || 'http://127.0.0.1:3001');
const expectedStateMode = String(process.env.STATE_EXPECTED_MODE || 'postgres').trim().toLowerCase();
const expectedAuthMode = String(process.env.AUTH_EXPECTED_MODE || 'postgres').trim().toLowerCase();
const reportPath = String(process.env.TEST_ENV_ACCEPTANCE_REPORT || '').trim();
const selectedSteps = String(process.env.TEST_ENV_ACCEPTANCE_STEPS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const selected = selectedSteps.length > 0 ? new Set(selectedSteps) : null;
const sensitiveEnvKeys = [
  'AUTH_SMOKE_PASSWORD',
  'XINYI_AUTH_SMOKE_PASSWORD',
  'XINYI_AUTH_SEED_ADMIN_PASSWORD',
  'XINYI_API_AUTH_TOKEN',
  'API_AUTH_TOKEN',
  'KIMI_API_KEY',
  'GEMINI_API_KEY',
  'DATABASE_URL'
];
const sensitiveValues = Array.from(new Set(
  sensitiveEnvKeys
    .map((key) => String(process.env[key] || '').trim())
    .filter((value) => value.length >= 4)
));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const redactText = (text) =>
  sensitiveValues.reduce(
    (next, value) => next.replace(new RegExp(escapeRegExp(value), 'g'), '[REDACTED]'),
    String(text || '')
  );

const baseEnv = {
  ...process.env,
  TEST_HOST: process.env.TEST_HOST || frontendBase,
  DEPLOY_FRONTEND_BASE: frontendBase,
  DEPLOY_BACKEND_BASE: backendBase,
  STATE_EXPECTED_MODE: expectedStateMode,
  AUTH_EXPECTED_MODE: expectedAuthMode,
  STATE_SYNC_BASE: process.env.STATE_SYNC_BASE || backendBase,
  AUTH_HEALTH_URL: process.env.AUTH_HEALTH_URL || `${backendBase}/api/auth/health`,
  AUTH_API_BASE: process.env.AUTH_API_BASE || backendBase,
  AUTH_EXPECTED_MIN_USERS: process.env.AUTH_EXPECTED_MIN_USERS || (expectedAuthMode === 'postgres' ? '1' : '')
};

const steps = [
  {
    id: 'domain',
    name: 'test domain smoke',
    args: ['scripts/test-domain-smoke.mjs']
  },
  {
    id: 'preflight',
    name: 'deploy preflight',
    args: ['scripts/preflight-deploy.mjs', '--profile=test', '--strict=true']
  },
  {
    id: 'deploy',
    name: 'deploy smoke',
    args: ['scripts/deploy-smoke.mjs']
  },
  {
    id: 'state-persistence',
    name: 'state persistence smoke',
    args: ['scripts/state-persistence-smoke.mjs']
  },
  {
    id: 'auth-mode',
    name: 'auth postgres mode smoke',
    args: ['scripts/check-auth-mode.mjs']
  },
  {
    id: 'auth-api',
    name: 'auth api smoke',
    args: ['scripts/auth-api-smoke.mjs']
  },
  {
    id: 'leads-api',
    name: 'leads api smoke',
    args: ['scripts/leads-api-smoke.mjs']
  },
  {
    id: 'customers-api',
    name: 'customers api smoke',
    args: ['scripts/customers-api-smoke.mjs']
  },
  {
    id: 'contracts-api',
    name: 'contracts api smoke',
    args: ['scripts/contracts-api-smoke.mjs']
  },
  {
    id: 'projects-api',
    name: 'projects api smoke',
    args: ['scripts/projects-api-smoke.mjs']
  }
].filter((step) => !selected || selected.has(step.id));

const runStep = (step) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, step.args, {
      cwd: process.cwd(),
      env: baseEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('exit', (code, signal) => {
      resolve({
        ...step,
        code: Number.isInteger(code) ? code : null,
        signal: signal || '',
        stdout,
        stderr,
        elapsedMs: Date.now() - started
      });
    });
  });

const printBlock = (label, text) => {
  const clean = redactText(text).trim();
  if (!clean) return;
  clean.split('\n').forEach((line) => console.log(`${label} ${line}`));
};

const writeReport = async (results, summary) => {
  if (!reportPath) return;
  const resolved = path.resolve(process.cwd(), reportPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(
    resolved,
    JSON.stringify({
      generatedAt: summary.generatedAt,
      frontendBase,
      backendBase,
      expectedStateMode,
      expectedAuthMode,
      selectedSteps: selected ? Array.from(selected) : [],
      redaction: {
        enabled: sensitiveValues.length > 0,
        keys: sensitiveEnvKeys.filter((key) => String(process.env[key] || '').trim().length >= 4)
      },
      summary,
      results: results.map((item) => ({
        id: item.id,
        name: item.name,
        pass: item.code === 0,
        code: item.code,
        signal: item.signal,
        elapsedMs: item.elapsedMs,
        stdout: redactText(item.stdout),
        stderr: redactText(item.stderr)
      }))
    }, null, 2)
  );
  console.log(`[test-env-acceptance] report=${resolved}`);
};

const run = async () => {
  if (steps.length === 0) {
    console.error('[test-env-acceptance] ERROR: no steps selected');
    process.exit(1);
  }
  if ((expectedStateMode === 'postgres' || expectedAuthMode === 'postgres') && (!frontendBaseProvided || !backendBaseProvided)) {
    console.error('[test-env-acceptance] ERROR: DEPLOY_FRONTEND_BASE and DEPLOY_BACKEND_BASE are required when validating postgres-backed test environments.');
    process.exit(1);
  }

  console.log(`[test-env-acceptance] frontend=${frontendBase} backend=${backendBase} stateMode=${expectedStateMode} authMode=${expectedAuthMode}`);
  if (selected) console.log(`[test-env-acceptance] selectedSteps=${Array.from(selected).join(',')}`);

  const results = [];
  for (const step of steps) {
    console.log(`START | ${step.id} | ${step.name}`);
    const result = await runStep(step);
    results.push(result);
    printBlock(`[${step.id}:stdout]`, result.stdout);
    printBlock(`[${step.id}:stderr]`, result.stderr);
    const pass = result.code === 0;
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${step.id} | elapsedMs=${result.elapsedMs} | code=${String(result.code)}${result.signal ? ` | signal=${result.signal}` : ''}`);
  }

  const fail = results.filter((item) => item.code !== 0).length;
  const summary = {
    total: results.length,
    pass: results.length - fail,
    fail,
    generatedAt: new Date().toISOString()
  };
  await writeReport(results, summary);
  console.log(`SUMMARY | total=${summary.total} pass=${summary.pass} fail=${summary.fail} generatedAt=${summary.generatedAt}`);
  if (fail > 0) process.exit(1);
};

run().catch((error) => {
  console.error(`[test-env-acceptance] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
