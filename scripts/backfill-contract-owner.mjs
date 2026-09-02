/**
 * 给合同补归属人（待办 P0-17 的合同部分）。
 *
 * ── 为什么要补 ────────────────────────────────────────────────
 * 12 份合同的 owner_user_id **全是空的**。这挡着两件事：
 *   ① 顾问看**自己签的**合同金额
 *      —— 老板指出「能录不能看」这个设计不成立：顾问手里拿着纸质合同去上传，
 *      金额他早就知道了。正确的规则是「不该看**别人的**」，而那需要归属人。
 *   ② 按人统计业绩
 *
 * ── 为什么默认填曾云俊 ────────────────────────────────────────
 * 老板明确说过：**公司的销售主要靠他，合同都是他签的**，
 * 顾问大多不知道合同价格，除了自己签的续签。
 *
 * 所以「全部归老板，有例外再单独改」是最接近事实的起点，
 * 而不是留空等一个永远不会有人来填的表格。
 *
 * ── 这不是猜，是有依据的默认值 ────────────────────────────────
 * 但依据也可能有例外。所以：
 *   · 预演会把 12 份合同**逐条列出来**，让人扫一眼
 *   · 已经有归属人的**一律不动**
 *   · 改完之后单独改某一份，在合同页面上点几下就行
 *
 * 用法：
 *   node scripts/backfill-contract-owner.mjs                     # 预演
 *   node scripts/backfill-contract-owner.mjs --apply             # 执行
 *   node scripts/backfill-contract-owner.mjs --owner <账号名>     # 指定归给谁
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^(XINYI_DB_URL|DATABASE_URL|AUTH_STORE_PATH|PGSSLMODE)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const wantOwner = (() => {
  const i = argv.indexOf('--owner');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'admin';
})();

const pool = require(path.join(root, 'server/db/pool.js'));
const store = require(path.join(root, 'server/authStore.js'));

const main = async () => {
  const users = await store.listUsers();
  const owner = users.find((u) => String(u.username || '').toLowerCase() === wantOwner.toLowerCase());
  if (!owner) {
    console.error(`\n❌ 找不到账号 ${wantOwner}。现有账号：`);
    users.forEach((u) => console.error(`   ${String(u.username || '').padEnd(16)} ${u.name}`));
    process.exit(2);
  }

  const { rows } = await pool.query(`
    SELECT id, customer_name, amount, sign_date, owner, owner_user_id
      FROM contracts ORDER BY sign_date NULLS LAST`);

  const todo = rows.filter((r) => !String(r.owner_user_id || '').trim());
  const done = rows.filter((r) => String(r.owner_user_id || '').trim());

  console.log(`\n归属人 → ${owner.name}（${owner.username}）\n`);
  console.log(`合同 ${rows.length} 份，其中 ${todo.length} 份没有归属人：\n`);
  for (const r of todo) {
    /*
      **合同金额在库里存的是「分」**（repos/_mapper.js 的 amount 类型做元→分 ×100）。
      直接拿原始列当元显示，24,400 元会变成 244 万——
      第一版就是这么输出的，一眼看出不对才发现。

      和工时那次是同一个坑：走仓储读回来是对的（会自动除 100），
      **直接跑 SQL 拿到的是分**。凡是绕开仓储直查库的地方都要自己换算。
    */
    const amt = r.amount ? `¥${(Number(r.amount) / 100).toLocaleString('zh-CN')}` : '（无金额）';
    console.log(`  ${String(r.customer_name || '').slice(0, 26).padEnd(28)}${amt.padEnd(14)}${String(r.sign_date || '').slice(0, 10)}`);
  }
  if (done.length) {
    console.log(`\n已有归属人、不动的 ${done.length} 份：`);
    done.forEach((r) => console.log(`  ${String(r.customer_name || '').slice(0, 26).padEnd(28)}→ ${r.owner || r.owner_user_id}`));
  }

  if (todo.length === 0) { console.log('\n没有要补的。\n'); process.exit(0); }

  if (!apply) {
    console.log('\n⚠️  依据是「老板签所有合同」这条业务事实。**扫一眼上面的清单**，');
    console.log('   如果有哪份其实是别人签的，改完之后在合同页面单独调整即可。');
    console.log('\n确认后执行：node scripts/backfill-contract-owner.mjs --apply\n');
    process.exit(0);
  }

  console.log('\n先备份…');
  try {
    execFileSync('npm', ['run', 'backup'], { cwd: root, stdio: 'ignore' });
    console.log('备份完成');
  } catch {
    console.error('\n❌ 备份失败，中止。\n');
    process.exit(1);
  }

  const ids = todo.map((r) => r.id);
  const r = await pool.query(
    'UPDATE contracts SET owner_user_id = $1, owner = $2 WHERE id = ANY($3::text[])',
    [owner.id, owner.name, ids]);

  const { rows: after } = await pool.query(
    "SELECT count(*)::int total, count(*) FILTER (WHERE coalesce(owner_user_id,'') <> '')::int has FROM contracts");
  console.log(`\n✅ 补了 ${r.rowCount} 份。现在 ${after[0].has}/${after[0].total} 份有归属人。\n`);
  process.exit(0);
};

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });
