/*
  测试库解析。**测试绝不能连生产库。**

  2026-08-21 发现：测试一直连着 .env.local 里的 localhost/xinyi——
  也就是装着 454 条真实线索和真实合同的那个库。
  证据：contracts 表里躺着 `CT-TXN-1 合同事务客户`，
  app_state_latest 里躺着 `test_probe_*`、`camel_case_key`。
  写脏数据还算轻的，测试里但凡有删除逻辑，删的就是真实业务数据。

  规则：库名必须以 _test 结尾，否则直接抛错。
  宁可测试跑不起来，也不能让它连上生产库。
*/
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TEST_DB = 'xinyi_test';

/*
  从 .env.local 里**只取**数据库连接信息，不把整个文件灌进 process.env。

  为什么要读文件：测试进程自己不加载 .env.local，process.env.XINYI_DB_URL 是空的。
  空字符串会让 pool.isEnabled() 返回 false，于是所有 batch 路由被整体跳过、
  测试全部落到 state store 文件回退路径上——**测试是绿的，但测的不是生产走的那条路**。
  这个坑很隐蔽：没有任何报错，覆盖率也看不出来。

  为什么不直接 dotenv.config()：那会把 XINYI_SESSION_AUTH_REQUIRED=1 之类的
  开发者本机配置一并带进测试进程，正是之前接口测试全部 401 的原因。
*/
const readEnvFile = (key) => {
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
      const m = txt.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* 文件不存在就看下一个 */ }
  }
  return '';
};

const resolveTestDbUrl = () => {
  const explicit = process.env.XINYI_TEST_DB_URL;
  if (explicit) return assertTestDb(explicit);

  const base = process.env.XINYI_DB_URL || process.env.DATABASE_URL
    || readEnvFile('XINYI_DB_URL') || readEnvFile('DATABASE_URL');
  if (!base) return '';
  // 复用生产库的连接信息（主机/账号/密码），只把库名换掉
  return assertTestDb(base.replace(/\/[^/?]+(\?|$)/, `/${DEFAULT_TEST_DB}$1`));
};

function assertTestDb(url) {
  let name;
  try {
    name = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`测试库地址无法解析：${url}`);
  }
  if (!/_test$/.test(name)) {
    throw new Error(
      `拒绝在非测试库上跑测试：库名 "${name}" 不以 _test 结尾。\n` +
      `请先建测试库：createdb ${DEFAULT_TEST_DB}，再执行 XINYI_DB_URL=<测试库地址> node scripts/migrate.mjs`
    );
  }
  return url;
}

/** 测试进程统一的环境变量。两个 helper 都用它，避免只改一个。 */
const testEnv = () => {
  const url = resolveTestDbUrl();
  return {
    XINYI_DB_URL: url,
    /*
      **显式清空 DATABASE_URL**（不是「不设」——必须是空字符串）。

      2026-09-01 生产切到 PG 存账号之后，.env.local 里有了 DATABASE_URL，
      而 serverProcess 起测试服务时会 `...process.env` 整个继承下去。
      不清空的话，每个测试用例都会连到**同一个真实的 PG 账号库**：
        · 用例之间互相看得到对方建的账号，隔离没了
        · 更糟的是它们会往生产账号库里写东西

      每个用例仍然各自用一个临时 AUTH_STORE_PATH 文件，互不干扰。

      代价要说清楚：**测试跑的是文件存储，生产跑的是 PG**，两条路。
      所以专门有 tests/auth-postgres-store.test.js 显式连测试库验 PG 那条路，
      不然「测试全绿但生产走的是另一条」的老问题又会回来。
    */
    DATABASE_URL: '',
    XINYI_SESSION_AUTH_REQUIRED: 'false',
    XINYI_API_AUTH_REQUIRED: 'false',
    XINYI_AUTHZ_MODE: 'observe',
    INTEL_CRON_ENABLED: 'false',
  };
};

module.exports = { resolveTestDbUrl, testEnv, assertTestDb, DEFAULT_TEST_DB };

/*
  清空测试库的业务数据。**每次起测试服务前调用**，给每个用例一个干净的库。

  为什么不能只在整轮开始前清一次：同一轮里 api-leads 建的线索会留到
  api-contracts 跑的时候，而那些用例第一句就是「列表应该是空的」。
  2026-08-21 接上真实 PG 后，正是这 8 个接口形状测试因此失败。

  账本表有拒绝 DELETE 的触发器（迁移 013），要先停用再恢复——
  那条触发器在生产库上是保护线，在测试库上只是碍事。
*/
let pgLib = null;
const KEEP_TABLES = new Set(['schema_migrations']);
const TRIGGER_GUARDED = ['business_events'];

const truncateTestDb = async () => {
  const url = resolveTestDbUrl();
  if (!url) return;                       // 没配测试库 = 走文件回退路径，无需清理
  pgLib = pgLib || require('pg');
  const client = new pgLib.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select tablename from pg_tables where schemaname='public'");
    const tables = rows.map((r) => r.tablename).filter((t) => !KEEP_TABLES.has(t));
    if (!tables.length) return;
    for (const t of TRIGGER_GUARDED) {
      if (tables.includes(t)) await client.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    }
    await client.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of TRIGGER_GUARDED) {
      if (tables.includes(t)) await client.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    }
  } finally {
    await client.end();
  }
};

module.exports.truncateTestDb = truncateTestDb;

/*
  ⚠️ 跑多个测试文件时必须加 --test-concurrency=1。

  serverProcess 在每次起服务前都会 truncate 测试库（给每个用例干净基线）。
  node --test 默认**并行**跑多个文件，于是两个文件会互相清空对方的数据——
  表现是偶发失败：单独跑每个文件都过，一起跑就随机红一个。

  2026-08-24 就是这么中的：npm test 有 --test-concurrency=1，
  而 test:enforce 漏了，闸门里随机报一次阻断，重跑又好了。
  **偶发失败比稳定失败更糟**：它会让人不再相信这个闸门。

  真正的解法是每个测试文件用独立的库（schema per file），
  但那要改 helper 的整个连接管理，目前的规模用串行就够。
*/
