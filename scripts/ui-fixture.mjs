/**
 * 验收样本数据 —— 答案已知的一小组项目，专门用来验「卡片上的数字对不对」。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-17）
 * ══════════════════════════════════════════════════════════════
 *
 * 金总要的是「看看数据是否一致及准确」，于是派了 Codex 和我各读一遍界面对答案。
 * 但库被他故意清空了（2 个项目、1 个合同），**两边都读到 0，一致，
 * 什么也没验证到**。数字对账要有答案，空库上没有答案。
 *
 * 所以造一组「长相是设计好的」项目：每一个都只踩中某一张卡的口径，
 * 而且踩得干干净净 —— 谁该进哪张卡，不看代码、只看这张表就能自己算出来。
 *
 * **这份文件故意不写出四张卡应该显示几。**
 * 写了的话，对答案就退化成「照抄」。正确做法是双方各自根据下面这张表
 * 算一遍、再去界面读一遍，三列并排比：我算的 / Codex 算的 / 界面显示的。
 * 三列不一致的地方才是这轮的产出。
 *
 * ── 怎么用 ────────────────────────────────────────────────────
 *
 *   node scripts/ui-fixture.mjs           # 建样本（幂等，重复跑不会翻倍）
 *   node scripts/ui-fixture.mjs --clean   # 只删自己造的（UAT-验收- 前缀），别的一律不碰
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentials } from './ui-accounts.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });

const API = process.env.UI_API || 'http://localhost:3001';
const PREFIX = 'UAT-验收-';

/*
  状态一律用枚举值（Active / Completed），不许写中文。
  第一版我写了 `status: '进行中'`，接口原样收下并存进库 ——
  项目在列表里看得见，四张统计卡却一个都不算它。
  接口那边已经改成 400 了（见 server/routes/batch2.js），
  这里留着这段注释，是因为下一个造数据的人还会这么想当然。
*/
const day = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);

const task = (title, deadline, status = '待处理') => ({
  id: `T-${title}`, title, owner: '验收-咨询顾问', deadline, status, requiresApproval: false
});

/**
 * 八个项目，每个只为一件事而生。
 * 「负责人」一律写死成验收顾问，除了那个故意不填的 —— 归属会影响
 * 「与我相关」视角下的可见性，混进来会让人分不清是归属错了还是口径错了。
 */
const FIXTURE = [
  { key: 'A', name: `${PREFIX}A-在跑无异常`, status: 'Active', manager: '验收-咨询顾问',
    deadline: day(60), projectAmount: 10000, tasks: [task('A1', day(60))],
    说明: '进行中；交期 60 天后；一条任务也是 60 天后；有负责人、有任务、有金额' },

  { key: 'B', name: `${PREFIX}B-项目交期还剩3天`, status: 'Active', manager: '验收-咨询顾问',
    deadline: day(3), projectAmount: 10000, tasks: [task('B1', day(60))],
    说明: '进行中；项目交期 3 天后；任务却在 60 天后' },

  { key: 'C', name: `${PREFIX}C-任务交期还剩5天`, status: 'Active', manager: '验收-咨询顾问',
    deadline: day(60), projectAmount: 10000, tasks: [task('C1', day(5))],
    说明: '进行中；项目交期 60 天后；有一条未完成任务在 5 天后' },

  { key: 'D', name: `${PREFIX}D-有一条任务逾期3天`, status: 'Active', manager: '验收-咨询顾问',
    deadline: day(60), projectAmount: 10000, tasks: [task('D1', day(-3))],
    说明: '进行中；项目交期 60 天后；有一条未完成任务交期已过 3 天' },

  { key: 'E', name: `${PREFIX}E-没有负责人`, status: 'Active', manager: '待指派',
    deadline: day(60), projectAmount: 10000, tasks: [task('E1', day(60))],
    说明: '进行中；负责人写的是「待指派」；其余齐全' },

  { key: 'F', name: `${PREFIX}F-一条任务都没排`, status: 'Active', manager: '验收-咨询顾问',
    deadline: day(60), projectAmount: 10000, tasks: [],
    说明: '进行中；任务列表是空的；其余齐全' },

  { key: 'G', name: `${PREFIX}G-交付类但金额为0`, status: 'Active', manager: '验收-咨询顾问',
    deadline: day(60), projectAmount: 0, tasks: [task('G1', day(60))],
    说明: '进行中；交付类（对外收费）；金额 0；其余齐全' },

  { key: 'H', name: `${PREFIX}H-已结项`, status: 'Completed', manager: '验收-咨询顾问',
    deadline: day(-10), projectAmount: 10000, tasks: [task('H1', day(-20), '已完成')],
    说明: '已结项；交期和任务都在过去；任务已完成' }
];

const post = async (cookie, url, body) => {
  const res = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
};

/**
 * 清掉样本。
 *
 * ⚠️ 直接改库，不走接口 —— **系统本来就没有「删项目」这个功能**，
 * 接口和前端都没有。那是设计：「谁做的」这条链不能断（见 CLAUDE.md 第一条）。
 * 样本数据是个例外，它本来就不该留在库里。
 *
 * 第一版我写成了 `DELETE /api/projects/:id`，路由根本不存在，
 * 于是脚本打印「已清掉 0 个」然后正常退出 —— 一个**说清理了其实没清理**的脚本，
 * 正是这个项目最怕的那种「不报错但一直是错的」。
 *
 * 三条硬约束：
 *   1. 只在本机库上跑
 *   2. 只删 `UAT-验收-` 前缀的行，别的一律不碰
 *   3. **先备份再删，备份失败就中止**（CLAUDE.md 第三条）
 *
 * 关系表和 JSON 镜像两处都要删。只删一处的症状是「删了刷新又回来」——
 * 这个项目已经出过。
 */
const clean = async (existing) => {
  const url = process.env.DATABASE_URL || '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('\n❌ 拒绝执行：DATABASE_URL 不是本机地址。\n');
    process.exit(1);
  }
  if (!existing.length) { console.log('库里没有 ' + PREFIX + ' 项目，无需清理'); return; }

  const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
  const fsMod = require('node:fs');
  const pool = new Pool({ connectionString: url });
  try {
    const rows = await pool.query("select * from projects where name like $1", [`${PREFIX}%`]);
    const mirror = await pool.query("select dataset_value from app_state_latest where dataset_key = 'projects_v8'");

    const backup = path.join(ROOT, `.runtime/backups/ui-fixture-${Date.now()}.json`);
    fsMod.mkdirSync(path.dirname(backup), { recursive: true });
    fsMod.writeFileSync(backup, JSON.stringify({ projects: rows.rows, mirror: mirror.rows[0]?.dataset_value ?? null }, null, 2));
    if (!fsMod.existsSync(backup) || fsMod.statSync(backup).size === 0) {
      throw new Error('备份没写成功，中止 —— 没备份就不删');
    }

    const del = await pool.query('delete from projects where name like $1', [`${PREFIX}%`]);

    const list = Array.isArray(mirror.rows[0]?.dataset_value) ? mirror.rows[0].dataset_value : [];
    const kept = list.filter((p) => !String(p?.name || '').startsWith(PREFIX));
    if (kept.length !== list.length) {
      await pool.query(
        "update app_state_latest set dataset_value = $1::jsonb, updated_at = NOW() where dataset_key = 'projects_v8'",
        [JSON.stringify(kept)]
      );
    }
    console.log(`已清掉 ${del.rowCount} 行（关系表）+ ${list.length - kept.length} 条（JSON 镜像）`);
    console.log(`备份：${path.relative(ROOT, backup)}`);
    console.log('库里其它数据一律没动。');
  } finally {
    await pool.end();
  }
};

const main = async () => {
  const book = credentials();
  if (!book?.ADMIN) throw new Error('没有验收账号 —— 先跑 `node scripts/ui-accounts.mjs`');

  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: book.ADMIN.username, password: book.ADMIN.password })
  });
  if (!loginRes.ok) throw new Error(`登录失败 ${loginRes.status}`);
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  if (!/xinyi_session=/.test(cookie)) throw new Error('没拿到会话 cookie');

  const listRes = await fetch(`${API}/api/projects`, { headers: { cookie } });
  const listed = await listRes.json().catch(() => ({}));
  const existing = (listed?.data?.projects || listed?.data || listed?.projects || [])
    .filter((p) => String(p?.name || '').startsWith(PREFIX));

  if (process.argv.includes('--clean')) return clean(existing);

  const have = new Set(existing.map((p) => String(p.name)));
  let 新建 = 0;
  for (const spec of FIXTURE) {
    if (have.has(spec.name)) { console.log(`  已有 ${spec.key} ${spec.name}`); continue; }
    await post(cookie, '/api/projects', {
      name: spec.name,
      manager: spec.manager,
      status: spec.status,
      deadline: spec.deadline,
      projectAmount: spec.projectAmount,
      projectMode: 'delivery',
      projectCategory: 'Delivery',
      projectType: '体系认证咨询',
      tasks: spec.tasks,
      appVersion: 'ui-fixture'
    });
    新建 += 1;
    console.log(`  建了 ${spec.key} ${spec.name}`);
  }

  console.log(`\n✅ 验收样本就绪（新建 ${新建} 个，共 ${FIXTURE.length} 个 ${PREFIX} 项目）。`);
  console.log('   每个项目的长相见 docs/验收样本数据.md —— 那份文件故意不写"卡片应该显示几"。');
  console.log('   清理：node scripts/ui-fixture.mjs --clean');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { FIXTURE, PREFIX };
