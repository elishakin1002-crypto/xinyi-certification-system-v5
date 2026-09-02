import { defineConfig, devices } from '@playwright/test';

const frontendPort = Number(process.env.E2E_FRONTEND_PORT || 3100);
const backendPort = Number(process.env.E2E_BACKEND_PORT || 3101);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  webServer: process.env.E2E_SKIP_WEB_SERVER
    ? undefined
    : {
        command: `INTEL_CRON_ENABLED=false PORT=${backendPort} VITE_DEV_PORT=${frontendPort} VITE_API_PORT=${backendPort} AUTH_STORE_PATH=.runtime/e2e-auth-store.json XINYI_AUTH_SEED_ADMIN_PASSWORD=local-test-password npm run dev`,
        url: baseURL,
        reuseExistingServer: process.env.E2E_REUSE_EXISTING_SERVER === '1',
        timeout: 120_000
      },
  projects: [
    {
      name: 'chromium',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'auth-required',
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
