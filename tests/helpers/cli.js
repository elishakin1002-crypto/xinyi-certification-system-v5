const { spawn } = require('node:child_process');

const runNodeScript = ({ scriptPath, env = {}, args = [], timeoutMs = 8000 }) =>
  new Promise((resolve) => {
    const child = spawn('node', [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref();

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut
      });
    });
  });

module.exports = {
  runNodeScript
};
