const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runNodeScript } = require('./helpers/cli');

const tempFile = (name) => path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

test('acceptance record script generates markdown from test env report', async () => {
  const reportPath = tempFile('xinyi-acceptance-report') + '.json';
  const outPath = tempFile('xinyi-acceptance-record') + '.md';
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: '2026-05-20T08:00:00.000Z',
    frontendBase: 'https://test-app.xinyi-iso.com',
    backendBase: 'https://test-app.xinyi-iso.com',
    expectedStateMode: 'postgres',
    expectedAuthMode: 'postgres',
    redaction: { enabled: true, keys: ['AUTH_SMOKE_PASSWORD'] },
    summary: { total: 2, pass: 2, fail: 0, generatedAt: '2026-05-20T08:00:00.000Z' },
    results: [
      { id: 'deploy', name: 'deploy smoke', pass: true, code: 0, elapsedMs: 120 },
      { id: 'auth-api', name: 'auth api smoke', pass: true, code: 0, elapsedMs: 90 }
    ]
  }, null, 2));

  try {
    const out = await runNodeScript({
      scriptPath: 'scripts/generate-acceptance-record.mjs',
      args: [`--report=${reportPath}`, `--out=${outPath}`],
      timeoutMs: 8000
    });

    assert.equal(out.timedOut, false);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /\[acceptance-record\] record=/);
    const record = fs.readFileSync(outPath, 'utf8');
    assert.match(record, /# 测试环境验收记录/);
    assert.match(record, /https:\/\/test-app\.xinyi-iso\.com/);
    assert.match(record, /\| `deploy` \| deploy smoke \| 通过 \| 0 \| 120 \|/);
    assert.match(record, /人工业务验收/);
    assert.match(record, /结论：可进入业务测试/);
  } finally {
    fs.rmSync(reportPath, { force: true });
    fs.rmSync(outPath, { force: true });
  }
});

test('acceptance record script requires a report path', async () => {
  const out = await runNodeScript({
    scriptPath: 'scripts/generate-acceptance-record.mjs',
    env: {
      TEST_ENV_ACCEPTANCE_REPORT: ''
    },
    timeoutMs: 8000
  });

  assert.equal(out.timedOut, false);
  assert.notEqual(out.code, 0);
  assert.match(out.stderr, /--report=<path> or TEST_ENV_ACCEPTANCE_REPORT is required/);
});
