/**
 * 情报抓取实跑自检 —— 真登录、真点「抓取今日情报」、真看抓回来几条。
 *
 * ── 为什么要有这个脚本（2026-09-13）──────────────────────────
 *
 * 金恩来：「你自己检查时每次都是"全过"、"0 处不符"，
 *           我去检查时就那里问题这里问题，说明什么？」
 *
 * 说明我的自检查的是**我想到的规则**，而他跑的是**真实流程**。
 * 情报雷达就是典型：接口在、路由在、页面在、测试全绿 ——
 * 但情报源一条没配，AI 提取门槛形同虚设，服务端角色表和菜单对不上。
 * 三样都不报错，合起来的结果是「这个按钮永远没用」。
 *
 * 所以这个脚本不检查代码长什么样，只问一句：
 * **现在拿一个真账号点下去，能不能抓到东西？**
 *
 * 它会：
 *   1. 建一个一次性账号（随机密码，不落盘、不打印）
 *   2. 用它登录，POST /api/intel/fetch
 *   3. 打印每个情报源各抓到多少字、AI 提取出几条
 *   4. 删掉这个一次性账号（它没经手过任何记录，可以删）
 *
 * 用法：
 *   node scripts/check-intel-fetch.mjs                      # 打本机 3001
 *   BASE=http://127.0.0.1:3001 node scripts/check-intel-fetch.mjs
 *
 * ⚠️ 会真的联网抓取并调用一次 AI，别放进 CI 里每次跑。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const store = require(path.join(ROOT, 'server/authStore.js'));

const main = async () => {
  console.log(`\n情报抓取实跑自检 —— ${BASE}\n`);

  // 1. 一次性账号。密码随机生成、只在内存里待几秒，不打印也不落盘。
  const pwd = `Ik-${crypto.randomBytes(9).toString('base64url')}!aA1`;
  const username = `intelcheck-${Date.now().toString(36)}`;
  const user = await store.createUser({
    username, name: '情报自检', password: pwd,
    roles: ['ADMIN'], activeRole: 'ADMIN', status: 'active', mustChangePassword: false
  });

  let cookie = '';
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: username, password: pwd })
    });
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    if (!cookie) throw new Error(`登录没拿到 cookie（HTTP ${r.status}）`);

    // 2. 先看服务端认为有哪些情报源
    const cfg = await (await fetch(`${BASE}/api/intel/config`, { headers: { cookie } })).json();
    const urls = cfg?.data?.config?.sourceUrls || [];
    console.log(`情报源：${urls.length} 个`);
    if (urls.length === 0) {
      console.log('\n❌ 一个源都没有 —— 「抓取今日情报」必然返回空。\n');
      process.exitCode = 1;
      return;
    }

    // 3. 真抓一次
    console.log('正在抓取（会联网 + 调一次 AI，慢，最多等 90 秒）…\n');
    const t0 = Date.now();
    /*
      ── 必须用界面上真实的筛选条件，不能传空（2026-09-15）──────────

      原来这里传 `{}`，服务端于是走 DEFAULT_*（宽范围），每次都抓到 20 条。
      而界面上的筛选器走的是 /api/intel/config 返回的那一套 ——
      **两套条件不同，于是自检永远绿、用户永远抓不到。**

      金恩来连着三轮说「情报雷达还是不行」，我三轮都没找到，
      就是因为自检和真实路径喂的参数不一样。
      自检必须走用户真正走的那条路，否则它检的是另一个系统。
    */
    const res = await fetch(`${BASE}/api/intel/fetch`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        regions: cfg?.data?.config?.regions,
        industries: cfg?.data?.config?.industries,
        limit: cfg?.data?.config?.limit ?? 20
      })
    });
    const body = await res.json();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    const report = body?.data?.sourceReport || [];
    if (report.length) {
      console.log('每个源抓回来的正文字数：');
      for (const s of report) {
        console.log(`  ${s.ok ? '✅' : '❌'} ${String(s.chars).padStart(5)} 字  ${s.url}`);
      }
      console.log('');
    }

    const signals = body?.data?.signals || [];
    const live = body?.data?.source === 'server';
    if (signals.length > 0 && live) {
      console.log(`✅ 抓到 ${signals.length} 条（耗时 ${secs}s，模型 ${body.data.model || '未知'}）\n`);
      for (const s of signals.slice(0, 5)) {
        console.log(`  · [${s.kind}] ${s.title}`);
      }
      console.log('');
    } else if (signals.length > 0) {
      console.log(`⚠️ 本次没抓到新的，回退了缓存里的 ${signals.length} 条（耗时 ${secs}s）`);
      console.log(`   ${body?.message || ''}\n`);
      process.exitCode = 1;
    } else {
      console.log(`❌ 一条都没抓到（耗时 ${secs}s）`);
      console.log(`   ${body?.message || JSON.stringify(body).slice(0, 400)}\n`);
      process.exitCode = 1;
    }
  } finally {
    // 4. 收摊。这个账号没经手过任何记录，删得掉；删不掉就停用，绝不留一个能登录的活口。
    try {
      await store.deleteUserIfUnused(user.id);
    } catch {
      try { await store.updateUser(user.id, { status: 'disabled' }); } catch { /* 已经没了 */ }
    }
  }
};

main().then(() => process.exit(process.exitCode || 0)).catch((e) => {
  console.error('\n❌ 自检本身出错了（不代表功能坏了，先看这条）：', e.message, '\n');
  process.exit(2);
});
