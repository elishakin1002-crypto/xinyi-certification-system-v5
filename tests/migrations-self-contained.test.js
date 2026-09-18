/*
  迁移必须能从零建出一个库。

  ══════════════════════════════════════════════════════════════
  这条测试对应的事故（2026-09-18）
  ══════════════════════════════════════════════════════════════

  给 CI 配数据库时，`createdb && npm run migrate` 在全新库上失败：

      执行 018 会话来源记录 ... 失败
      relation "auth_sessions" does not exist

  真因：auth_users / auth_sessions / app_state_latest / app_state_history /
  auth_audit_logs 这几张表**没有任何迁移创建过** —— 它们由
  server/authStore.js 和 server/stateStore.js 在服务启动时现建。
  而 018、022、025 都要 ALTER 它们。

  生产库一直没事纯属**顺序上的巧合**：服务先跑过、表已经在了。
  也就是说这套迁移从来就建不出一个新环境，只是没人从零试过 ——
  而真要从零建的时候（换服务器、灾备重建），通常是出事之后。

  ── 这条测试盯什么 ────────────────────────────────────────────

  静态解析 db/migrations/*.sql：**任何一张被 ALTER / 被外键引用 /
  被建索引的表，必须由某个不晚于它的迁移 CREATE 出来。**

  不连数据库，所以 CI 上没库也能跑；而且它拦的是"写的时候"，
  不是"跑到那一行才炸"。

  为什么不用「跑一遍真迁移」来验：那需要一个空库，本机不一定有；
  更重要的是，真跑一遍只能告诉你第一个炸的地方，静态检查能一次列全。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..', 'db', 'migrations');

/*
  注释里出现 `ALTER TABLE xxx` 是很正常的（讲为什么这么改），
  不能把它当成真的语句。**整行删掉会让行号错位**，所以是"抹白"：
  把注释内容换成等长空格，行数和行内位置都保持不变。
*/
const stripComments = (sql) =>
  sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i) + ' '.repeat(line.length - i);
    })
    .join('\n');

const migrations = () =>
  fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => ({
      file,
      version: file.match(/^(\d+)/)[1],
      sql: stripComments(fs.readFileSync(path.join(DIR, file), 'utf8'))
    }))
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));

const matchAll = (sql, re) => [...sql.matchAll(re)].map((m) => m[1].toLowerCase());

test('迁移能从零建库：被 ALTER / 被引用的表，必须先由某个迁移建出来', () => {
  const created = new Set();
  const problems = [];

  for (const { file, sql } of migrations()) {
    // 先收「这个迁移用到了谁」，再把它自己建的表登记进去 ——
    // 同一个文件里「先 CREATE 再 ALTER」是完全正常的写法。
    const used = [
      ...matchAll(sql, /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi).map((t) => [t, 'ALTER TABLE']),
      ...matchAll(sql, /\bREFERENCES\s+([a-z_][a-z0-9_]*)/gi).map((t) => [t, 'REFERENCES']),
      ...matchAll(sql, /\bCREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[a-z0-9_]+\s+ON\s+([a-z_][a-z0-9_]*)/gi)
        .map((t) => [t, 'CREATE INDEX ON'])
    ];

    for (const name of matchAll(sql, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      created.add(name);
    }

    for (const [table, how] of used) {
      if (!created.has(table)) problems.push(`${file}：${how} ${table} —— 但没有任何迁移建过它`);
    }
  }

  assert.deepEqual(
    problems,
    [],
    '以下表只在运行时代码里建过，全新库上跑迁移会炸：\n  ' + problems.join('\n  ')
  );
});

test('000 补的那几张表确实在迁移里被建出来了', () => {
  /*
    这几张表是 2026-09-18 补的。单独钉一遍是因为上面那条测试
    只保证"自洽"——把 000 删掉、同时把 018/022/025 也删掉，它照样绿。
    而这几张表是系统的地基（账号、会话、审计、前端状态镜像），
    少任何一张，新环境都起不来。
  */
  const all = migrations().map((m) => m.sql).join('\n');
  for (const t of ['auth_users', 'auth_sessions', 'auth_audit_logs', 'app_state_latest', 'app_state_history']) {
    assert.match(
      all,
      new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${t}\\b`, 'i'),
      `迁移里没有建 ${t} —— 全新环境会缺这张表`
    );
  }
});
