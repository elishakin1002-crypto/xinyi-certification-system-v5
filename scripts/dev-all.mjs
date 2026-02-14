import { spawn } from 'node:child_process';

const run = (name, cmd, args) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
  child.on('exit', code => {
    if (code && code !== 0) {
      // Keep the other process output visible; exit with failing code.
      process.exitCode = code;
      console.error(`[dev:all] ${name} exited with code ${code}`);
    }
  });
  return child;
};

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const server = run('server', npmCmd, ['run', 'start:guard']);
const web = run('web', npmCmd, ['run', 'dev:ui']);

const shutdown = () => {
  server.kill('SIGTERM');
  web.kill('SIGTERM');
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
