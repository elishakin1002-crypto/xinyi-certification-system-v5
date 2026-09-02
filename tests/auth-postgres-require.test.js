const test = require('node:test');
const assert = require('node:assert/strict');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

test('server fails fast when auth postgres is required but DATABASE_URL is missing', async () => {
  let started = null;
  try {
    started = await startServerProcess({
      XINYI_AUTH_REQUIRE_POSTGRES: 'true',
      DATABASE_URL: ''
    });
  } catch (error) {
    assert.match(
      String(error?.message || ''),
      /XINYI_AUTH_REQUIRE_POSTGRES=true but DATABASE_URL is not configured|auth-postgres-required-but-database-url-missing|Server exited before ready/i
    );
    return;
  }

  await stopServerProcess(started.child);
  assert.fail('server should not start when auth postgres is required but DATABASE_URL is missing');
});
