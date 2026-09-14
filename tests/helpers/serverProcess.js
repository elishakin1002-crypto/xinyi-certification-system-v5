const { spawn } = require('node:child_process');
const net = require('node:net');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('Cannot resolve free port')));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });

const waitUntilReady = async (baseUrl, timeoutMs = 12000, shouldStop = null) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (typeof shouldStop === 'function' && shouldStop()) {
      throw new Error(`Server exited before ready: ${baseUrl}`);
    }
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) return;
    } catch {
      // Keep polling until timeout.
    }
    await delay(120);
  }
  throw new Error(`Server readiness timeout: ${baseUrl}`);
};

/**
 * 起一个测试服务进程。
 *
 * @param envOverrides 额外的环境变量
 * @param opts.seedCustomers 先种几个客户（id 数组）。
 *
 *   ── 为什么需要 seedCustomers（2026-09-14）──────────────────
 *   库里加了外键之后，合同和项目的 customer_id 必须指向真实存在的客户。
 *   在这之前很多测试直接写 `customerId: 'C-PROJ-1'` 造孤儿数据 ——
 *   能跑通只是因为当时数据库不管。
 *
 *   不在 truncate 里统一种：那会让「列表应该是空的」这类断言全部失效
 *   （试过，一下红了四条）。**让每个用例显式说自己要什么**，
 *   既不污染别人，也一眼看得出这个用例依赖哪些前置数据。
 */
const startServerProcess = async (envOverrides = {}, opts = {}) => {
  // 每个用例一个干净的库，见 testDb.js 的说明
  await require('./testDb').truncateTestDb();
  if (Array.isArray(opts.seedCustomers) && opts.seedCustomers.length) {
    await require('./testDb').seedCustomers(opts.seedCustomers);
  }
  const port = await getFreePort();
  const env = {
    ...process.env,
    // 测试库 + 关鉴权，统一来源见 testDb.js
    ...require('./testDb').testEnv(),
    ...envOverrides,
    PORT: String(port)
  };

  const child = spawn('node', ['server/app.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  let stdout = '';
  let exited = false;
  let exitCode = null;
  let exitSignal = null;

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk || '');
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitUntilReady(baseUrl, 12000, () => exited);
  } catch (error) {
    child.kill('SIGTERM');
    const logs = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    const exitMeta = exited ? ` (exit code=${String(exitCode)}, signal=${String(exitSignal)})` : '';
    throw new Error(`${error.message}${exitMeta}\n${logs}`.trim());
  }

  return {
    baseUrl,
    child
  };
};

const stopServerProcess = async (child) =>
  new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolve();
    }, 2000).unref();
  });

module.exports = {
  startServerProcess,
  stopServerProcess
};
