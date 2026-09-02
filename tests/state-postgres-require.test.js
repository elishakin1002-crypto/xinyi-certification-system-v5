const test = require('node:test');
const assert = require('node:assert/strict');
const { startServerProcess, stopServerProcess } = require('./helpers/serverProcess');

test('server fails fast when postgres is required but DATABASE_URL is missing', async () => {
  let started = null;
  try {
    /*
      两个变量都要清空。
      2026-08-21 之前 stateStore 只认 DATABASE_URL，而系统其余部分用 XINYI_DB_URL——
      同一个库两个名字，导致 PG 后端从未初始化、一切静默退回文件存储。
      修复时给 stateStore 加了 XINYI_DB_URL 回退，所以这个用例要清两个，
      否则 XINYI_DB_URL 有值时服务本就该正常启动（PG 确实可用，要求已满足）。
    */
    started = await startServerProcess({
      XINYI_REQUIRE_POSTGRES: 'true',
      DATABASE_URL: '',
      XINYI_DB_URL: ''
    });
  } catch (error) {
    assert.match(
      String(error?.message || ''),
      /XINYI_REQUIRE_POSTGRES=true (but DATABASE_URL is not configured|但 DATABASE_URL \/ XINYI_DB_URL 都未配置)|postgres-required-but-database-url-missing|均未配置|Server exited before ready/i
    );
    return;
  }

  // Defensive cleanup for unexpected startup success.
  await stopServerProcess(started.child);
  assert.fail('server should not start when postgres is required but DATABASE_URL is missing');
});
