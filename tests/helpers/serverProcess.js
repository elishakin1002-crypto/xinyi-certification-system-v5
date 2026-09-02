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

const startServerProcess = async (envOverrides = {}) => {
  // 每个用例一个干净的库，见 testDb.js 的说明
  await require('./testDb').truncateTestDb();
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
