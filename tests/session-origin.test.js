// 会话来源记录（多地登录的前提）。
//
// ── 背景 ──────────────────────────────────────────────────────
// auth_sessions 原来只有 id / user_id / created_at / expires_at。
// 同一个账号可以在任意多个地方同时登录，**而没有任何人能看出来**。
//
// 「允许不允许多地登录」是业务决定；
// 但不管决定是什么，**没有来源记录就没有讨论的依据**，
// 而且痕迹补不回来 —— 今天不记，明天想查也只能从明天开始。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('迁移给 auth_sessions 加了来源字段', () => {
  const sql = read('db/migrations/018_会话来源记录.sql');
  for (const col of ['ip', 'user_agent', 'last_seen_at']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`), `缺少 ${col} 字段`);
  }
  assert.match(sql, /idx_auth_sessions_user_id/,
    '按 user_id 查某人的全部会话是主要用法，没索引会全表扫');
});

test('迁移和 initAuthStore 的建表语句保持同步', () => {
  /*
    **表结构在两个地方定义**：db/migrations/ 和 authStore.js 的 initAuthStore。
    生产库走迁移，测试和全新环境走 initAuthStore 里的 DDL。

    2026-09-02 加 ip/user_agent 时只改了迁移 —— 生产一切正常，
    测试全线报「column "ip" of relation "auth_sessions" does not exist」。
    这种错很容易被当成「测试环境的问题」而放过去，
    实际是任何一台新机器初始化出来的库都会缺列。
  */
  const store = read('server/authStore.js');
  for (const col of ['ip', 'user_agent', 'last_seen_at']) {
    assert.match(store, new RegExp(`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ${col}\\b`),
      `initAuthStore 没有建 ${col} 列 —— 迁移加了但新环境不会有`);
  }
});

test('登录时把 IP 和设备写进会话', () => {
  const src = read('server/authStore.js');
  assert.match(src, /INSERT INTO auth_sessions[\s\S]{0,200}user_agent/,
    '建会话时没写入 user_agent');
  assert.match(src, /trimOrigin/,
    'User-Agent 是客户端可以随便写的字符串，不截断等于让人往库里塞任意长度的内容');
});

test('取 IP 优先用 X-Forwarded-For', () => {
  /*
    生产上前面有 Nginx 反向代理。直接用 req.ip 拿到的永远是 127.0.0.1，
    记一库 127.0.0.1 等于什么都没记 —— 而且这种错不会报错，
    要等到真的去查「他从哪登的」才发现整份数据没用。
  */
  const src = read('server/app.js');
  const block = src.slice(src.indexOf("app.post('/api/auth/login'"), src.indexOf("app.post('/api/auth/login'") + 1400);
  assert.match(block, /x-forwarded-for/i, '登录接口没有从 X-Forwarded-For 取真实 IP');
  assert.match(block, /split\(','\)\[0\]/,
    'X-Forwarded-For 是「客户端, 代理1, 代理2」的链，要取第一段');
});

test('last_seen_at 只在续期时更新，不是每个请求都写', () => {
  /*
    每请求一次 UPDATE，一个人开着页面就是持续写入压力，
    而「最后活跃」精确到秒毫无意义。蹭滑动续期本身的节流。
  */
  const src = read('server/authStore.js');
  assert.match(src, /shouldRenewSession\(expiresAt\)\)\s*\{[\s\S]{0,600}last_seen_at = NOW\(\)/,
    'last_seen_at 没有跟着续期一起更新，或者写在了每个请求的路径上');
});
