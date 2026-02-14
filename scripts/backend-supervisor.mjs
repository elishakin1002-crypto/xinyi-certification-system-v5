import { spawn } from 'node:child_process';
import net from 'node:net';

let child = null;
let manualStopping = false;
let restartCount = 0;
const targetPort = Number(process.env.PORT || 3001);

const isPortOccupied = (port) => new Promise((resolve) => {
  const tester = net.createServer();
  tester.unref();
  tester.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      resolve(true);
      return;
    }
    resolve(false);
  });
  tester.once('listening', () => {
    tester.close(() => resolve(false));
  });
  tester.listen(port, '0.0.0.0');
});

const startBackend = () => {
  const startedAt = Date.now();
  child = spawn('node', ['server/app.js'], {
    stdio: 'inherit',
    shell: false
  });

  child.on('exit', (code, signal) => {
    const uptimeMs = Date.now() - startedAt;
    const uptimeSec = Math.round(uptimeMs / 1000);
    if (manualStopping) return;

    restartCount += 1;
    console.error(`[backend-supervisor] backend exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}, uptime=${uptimeSec}s), restarting in 1s...`);
    setTimeout(startBackend, 1000);
  });
};

const shutdown = () => {
  manualStopping = true;
  if (!child) process.exit(0);
  child.once('exit', () => process.exit(0));
  child.kill('SIGTERM');
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const boot = async () => {
  const occupied = await isPortOccupied(targetPort);
  if (occupied) {
    console.error(`[backend-supervisor] port ${targetPort} is already in use. Please stop the existing process first.`);
    process.exit(1);
  }
  console.log('[backend-supervisor] starting backend with auto-restart...');
  startBackend();
};

boot();
