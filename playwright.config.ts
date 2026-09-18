import { defineConfig, devices } from '@playwright/test';

const frontendPort = Number(process.env.E2E_FRONTEND_PORT || 3100);
const backendPort = Number(process.env.E2E_BACKEND_PORT || 3101);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${frontendPort}`;

/*
  ── e2e 的环境开关必须显式钉死，不能继承 .env.local（2026-09-18）──

  这些灰度开关（线索/客户/合同/项目走不走 PG）**测试进程读不到
  .env.local，服务端却读得到** —— 于是本机跑 e2e 时两边对不上：
  服务端按 PG 路径跑，测试却按"没开灰度"来断言，必然红。
  CI 没有 .env.local，两边都是关的，所以 CI 绿、本机红。

  **本机和 CI 跑的不是同一条路** —— 这正是这个项目写过的那句
  「测试全绿，但生产走的是另一条没测过的路」。
  鉴权那两个开关也是同一个问题，一起钉在这里。

  ⚠️ 现在钉成「关」，是为了先让本机和 CI 一致、e2e 能跑起来。
  但**生产跑的是 PG 那条路**，所以 e2e 目前并没有覆盖生产的真实路径。
  这一条记在 docs/上线前验收总计划.md 的「没做的」里，上线后补。
*/
const E2E_ENV = {
  VITE_AUTH_REQUIRED: '0',
  XINYI_SESSION_AUTH_REQUIRED: '0',
  VITE_LEADS_API_ENABLED: '0',
  VITE_LEADS_API_READ_ENABLED: '0',
  VITE_CUSTOMERS_API_ENABLED: '0',
  VITE_CUSTOMERS_API_READ_ENABLED: '0',
  VITE_CONTRACTS_API_READ_ENABLED: '0',
  VITE_CONTRACTS_API_WRITE_ENABLED: '0',
  VITE_PROJECTS_API_READ_ENABLED: '0',
  VITE_PROJECTS_API_WRITE_ENABLED: '0',
} as const;

/*
  同一份开关同时喂给**测试进程**和**被测服务**。
  只喂一边就是上面那个 bug 的来源。
*/
for (const [k, v] of Object.entries(E2E_ENV)) process.env[k] = v;
const e2eEnvPrefix = Object.entries(E2E_ENV).map(([k, v]) => `${k}=${v}`).join(' ');

/*
  ── e2e 必须用自己的库（2026-09-14）──────────────────────────

  原来这里没指定数据库，于是 e2e 起的服务读 .env.local，**打在开发库上**。
  两个后果，第二个更要命：

    1. 跑一次 e2e 就往开发库里塞一堆 E2E 客户、E2E 员工
    2. **种子管理员建不出来** —— seedAdminIfConfigured 遇到已存在的 admin
       就直接 return，而开发库里 admin 早就有了（是真人的密码）。
       于是 e2e 拿 local-test-password 永远登不进去。

  这件事被掩盖了很久，因为 login() 的断言写错了：
  它断言页面上有「工作台」三个字，而**登录页的标题里就有**
  （「登录后进入工作台、线索、合同、项目与财务闭环。」）——
  登录失败也照样通过。四条用例"绿着"，其实一条都没真正跑起来。

  库名以 _test 结尾，和单元测试用的 assertTestDb 同一条防线：
  绝不允许 e2e 打到生产或开发库上。
*/
const e2eDbUrl = process.env.E2E_DB_URL
  || (process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/xinyi_dev').replace(/\/[^/]*$/, '/xinyi_e2e_test');
if (!/_test$/.test(new URL(e2eDbUrl).pathname.slice(1))) {
  throw new Error(`e2e 的数据库名必须以 _test 结尾，现在是 ${e2eDbUrl} —— 拒绝在非测试库上跑 e2e`);
}

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
        /*
          ── 鉴权模式必须显式钉死，不能继承 .env.local（2026-09-18 修）──

          smoke.spec 假设「免登录直接进工作台」，auth.spec 则自己用
          localStorage 的 xinyi_auth_required 打开鉴权 —— 这是设计。

          但这里没有覆盖 VITE_AUTH_REQUIRED，`npm run dev` 会读 .env.local。
          于是本机（.env.local 里 VITE_AUTH_REQUIRED=1）跑 e2e，
          前端全局要求登录，**smoke 的 9 条全部挂在登录页**；
          而 CI 没有 .env.local（gitignore），鉴权是关的，全绿。

          **本机和 CI 跑的不是同一条路** —— 这正是这个项目写过的那句
          「测试全绿，但生产走的是另一条没测过的路」。
          后果是本机根本跑不了 e2e，而 e2e 恰恰是上线前最该反复跑的那个。

          所以这里把两个开关都显式置 0：auth.spec 需要鉴权时自己打开。
        */
        command: `INTEL_CRON_ENABLED=false PORT=${backendPort} VITE_DEV_PORT=${frontendPort} VITE_API_PORT=${backendPort} XINYI_DB_URL=${e2eDbUrl} DATABASE_URL=${e2eDbUrl} AUTH_STORE_PATH=.runtime/e2e-auth-store.json XINYI_AUTH_SEED_ADMIN_PASSWORD=local-test-password ${e2eEnvPrefix} npm run dev`,
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
    },
    /*
      六条核心流程的回归。2026-09-14 加。

      为什么单独一个 project 而不是塞进 smoke：
      smoke 查的是「页面能不能打开、有没有外部 CDN 请求」，一分钟跑完；
      这一组要真登录、真建数据、真点按钮，慢得多。
      分开之后，改前端时可以只跑 smoke 快速验，发版前再跑全套。
    */
    {
      name: 'core-flows',
      testMatch: /core-flows\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
