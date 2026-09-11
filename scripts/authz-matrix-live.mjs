#!/usr/bin/env node
/**
 * 全角色 × 全受保护接口 的**实跑**鉴权矩阵。
 *
 * ══════════════════════════════════════════════════════════════
 * 和现有几个检查的分工
 * ══════════════════════════════════════════════════════════════
 *
 *   check-permission-matrix.mjs   静态：路由守卫有没有配齐
 *   test-coverage-matrix.mjs      静态：哪些动作码从没被测过
 *   authz.test.js                 单元：authorize() 的判定逻辑
 *   **这个脚本**                  **端到端：真的发请求，看服务端到底放不放**
 *
 * 为什么必须有端到端这一层：前三个都在「代码写得对不对」这一侧，
 * 而真正会出事的是**中间件没挂上、路由写错、守卫被绕过** ——
 * 那些静态检查一个都发现不了。
 *
 * ── 期望值从哪来 ──────────────────────────────────────────────
 *
 * **不手写。** 从两处自动推：
 *   ① 路由文件里 requireAction('X') 的 X      → 这个接口要什么动作
 *   ② constants.ts 的 ROLE_CAPABILITIES       → 谁有这个动作
 *
 * 期望 = 有这个动作就该 2xx，没有就该 403。
 * 手写期望表的话，写错了没人发现 —— 那等于拿自己的假设考自己。
 *
 * ── 判据的分寸 ────────────────────────────────────────────────
 *
 * 只判「**放不放行**」，不判业务是否成功：
 * 请求体是最小假数据，业务层大概率返回 400/404/422，那都算**放行**。
 * 要区分的是 403（拒绝）和「非 403」（放行），不是 200 和非 200。
 *
 * 还有一类必须单独抓：**5xx**。
 * 越权请求把服务端打成 500，和 403 是两回事 ——
 * 前者说明没想到有人会这么点，往往还伴随脏数据。
 *
 * 用法：node scripts/authz-matrix-live.mjs [--base=http://localhost:3001]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env.local') });
require('dotenv').config();
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://localhost:3001';
const store = require(path.join(ROOT, 'server/authStore.js'));

const ROLES = ['ADMIN', 'SYS_ADMIN', 'MANAGER', 'SALES', 'CONSULTANT', 'FINANCE'];
const LABEL = { ADMIN: '总经理', SYS_ADMIN: '系统管理员', MANAGER: '总助', SALES: '销售', CONSULTANT: '咨询顾问', FINANCE: '财务' };

// ── 从路由文件里抽「接口 → 需要什么动作」 ──
const routeFiles = fs.readdirSync(path.join(ROOT, 'server/routes')).filter((f) => f.endsWith('.js'));
const endpoints = [];
for (const f of routeFiles) {
  const src = fs.readFileSync(path.join(ROOT, 'server/routes', f), 'utf8');
  const re = /router\.(get|post|patch|put|delete)\(\s*'([^']+)'\s*,[\s\S]{0,200}?requireAction\('([A-Z_]+)'/g;
  let m;
  while ((m = re.exec(src))) {
    endpoints.push({ method: m[1].toUpperCase(), url: m[2], action: m[3], file: f });
  }
}

// ── 从 constants.ts 抽「谁有什么动作」 ──
const constants = fs.readFileSync(path.join(ROOT, 'constants.ts'), 'utf8');
const capBlock = (() => {
  const i = constants.indexOf('export const ROLE_CAPABILITIES');
  const open = constants.indexOf('{', i);
  let d = 0;
  for (let j = open; j < constants.length; j += 1) {
    if (constants[j] === '{') d += 1;
    if (constants[j] === '}') { d -= 1; if (d === 0) return constants.slice(open, j + 1); }
  }
  return '';
})();
const caps = {};
for (const role of ROLES) {
  const m = capBlock.match(new RegExp(`\\b${role}\\s*:\\s*\\{[\\s\\S]*?actions\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  caps[role] = m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]) : [];
}

// ── 造一次性账号 ──
const mkUser = async (role) => {
  const pwd = `Mx-${crypto.randomBytes(8).toString('base64url')}!aA1`;
  const username = `mx-${role.toLowerCase()}-${Date.now().toString(36)}`;
  const u = await store.createUser({
    username, name: `矩阵-${LABEL[role]}`, password: pwd,
    roles: [role], activeRole: role, status: 'active', mustChangePassword: false,
  });
  return { role, id: u.id, username, pwd };
};

const login = async (account, password) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  return (r.headers.get('set-cookie') || '').split(';')[0];
};

/**
 * 路径里的 :id 要按**资源类型**填对应的真实 id。
 *
 * 第一版统一填了项目 id，于是 /api/leads/:id 拿着项目 id 去查线索 ——
 * 资源找不到，授权层判为拒绝，结果满屏「总经理有权限却被 403」。
 * **那不是产品问题，是我的测试数据喂错了。**
 *
 * 这是同一天第三次被自己的测试脚本骗（前两次见坑 10c）。
 * 所以这里按 URL 前缀取对应资源的真实 id，取不到就跳过这条 ——
 * **宁可少测一条，也不要报一条假的。**
 */
const fillParams = (url, ids) => {
  const kind = url.startsWith('/api/leads') ? 'lead'
    : url.startsWith('/api/customers') ? 'customer'
      : url.startsWith('/api/projects') ? 'project'
        : url.startsWith('/api/contracts') ? 'contract'
          : url.startsWith('/api/settlements') ? 'settlement'
            : url.startsWith('/api/signals') ? 'signal'
              : url.startsWith('/api/knowledge') ? 'knowledge' : null;
  const id = kind ? ids[kind] : null;
  if (url.includes(':') && !id) return null;          // 没有可用 id，跳过
  return url.replace(/:taskId/g, ids.task || 'T-NONE').replace(/:[a-zA-Z]+/g, id || 'X-NONE');
};

const main = async () => {
  await store.initAuthStore();
  const users = [];
  for (const r of ROLES) users.push(await mkUser(r));

  // 取几个真实 id，避免 404 掩盖鉴权
  const anyCookie = await login(users[0].username, users[0].pwd);
  const grab = async (url, key) => {
    try {
      const j = await (await fetch(`${BASE}${url}`, { headers: { cookie: anyCookie } })).json();
      const arr = j?.data?.[key] || [];
      return arr[0]?.id || null;
    } catch { return null; }
  };
  const ids = {
    lead: await grab('/api/leads', 'leads'),
    customer: await grab('/api/customers', 'customers'),
    project: await grab('/api/projects', 'projects'),
    contract: await grab('/api/contracts', 'contracts'),
    settlement: await grab('/api/settlements', 'settlements'),
    signal: await grab('/api/signals', 'signals'),
    knowledge: await grab('/api/knowledge', 'docs'),
  };
  const skipped = [];
  const uncovered = new Set();

  const rows = [];
  const problems = [];

  for (const u of users) {
    const cookie = await login(u.username, u.pwd);
    if (!cookie) { problems.push({ 级别: '阻断', 角色: LABEL[u.role], 说明: '登不进去' }); continue; }

    for (const ep of endpoints) {
      const should = caps[u.role].includes(ep.action);
      const url = fillParams(ep.url, ids);
      if (!url) { if (u === users[0]) skipped.push(`${ep.method} ${ep.url}（没有可用的真实 id）`); continue; }
      let status = 0; let policy = '';
      try {
        const r = await fetch(`${BASE}${url}`, {
          method: ep.method,
          headers: { cookie, 'Content-Type': 'application/json' },
          body: ep.method === 'GET' ? undefined : JSON.stringify({}),
        });
        status = r.status;
        if (status === 403) {
          const j = await r.json().catch(() => ({}));
          policy = String(j?.data?.policy || '');
        }
      } catch { status = -1; }

      const denied = status === 403;
      const serverError = status >= 500;
      /*
        5xx 要分两种，第一版把它们混成了「越权请求返回 500」：
          · **没权限**的人打出 5xx → 严重，鉴权没拦住就崩了
          · **有权限**的人打出 5xx → 也是问题，但属于输入校验缺失
            （这里发的是空 body，服务端该回 400 而不是 500），
            和越权是两回事，混在一起会把注意力引到错的地方
      */
      /*
        「有权限却被 403」要靠服务端自己给的 policy 分辨，不能一律当缺陷：

          config.missing_resource:*   路由的 resource 解析器需要请求体里的 id，
                                      而这里发的是空 body —— **故障安全地拒绝是对的**，
                                      是本脚本覆盖不到，不是产品有问题
          scope:write=DEPARTMENT/OWN  「只能修改自己负责的数据」。这里用的是随便一条
          ownership.*                 记录，被拒是**正确行为** —— 数据范围正在生效
          其它                        才是真缺陷

        注意 policy 的实际写法是 `scope:write=DEPARTMENT`（冒号不是点），
        第一版正则写成 /^scope\./ 匹配不上，于是 16 条正确行为被报成阻断缺陷。
        **写匹配规则前先去看一眼真实值长什么样**，别照着自己以为的格式写。

        不做这个区分的话，这个脚本会报一堆假缺陷，
        而假缺陷比漏报更贵：它让人不再信这张表。
      */
      const harnessLimit = /^config\.|missing_resource|^scope[:.]|ownership/.test(policy);
      let verdict = 'OK';
      if (serverError) verdict = should ? '空body500' : '越权5xx';
      else if (should && denied) verdict = harnessLimit ? '脚本覆盖不到' : '该放却拒';
      else if (!should && !denied) verdict = '该拒却放';

      rows.push({ 角色: LABEL[u.role], 接口: `${ep.method} ${ep.url}`, 动作: ep.action, 应当: should ? '放行' : '拒绝', 实际: status, 判定: verdict });
      if (verdict === '脚本覆盖不到') { uncovered.add(`${ep.method} ${ep.url}  [${policy}]`); continue; }
      if (verdict !== 'OK') {
        const 级别 = verdict === '空body500' ? '一般' : (verdict === '该放却拒' ? '阻断' : '严重');
        const 说明 = verdict === '越权5xx' ? `没有权限，但请求把服务端打成 ${status}（应为 403）`
          : verdict === '空body500' ? `有权限，空请求体返回 ${status} —— 应该是 400（输入校验），不是 500`
            : verdict === '该拒却放' ? `没有 ${ep.action} 权限却返回 ${status}`
              : `有 ${ep.action} 权限却被 403 拒绝`;
        problems.push({ 级别, 角色: LABEL[u.role], 接口: `${ep.method} ${ep.url}`, 动作: ep.action, 说明 });
      }
    }
  }

  // 清理一次性账号
  const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('delete from auth_users where username like $1', ['mx-%']);
  await pool.end();

  const pad = (s, n) => { const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0); return String(s) + ' '.repeat(Math.max(0, n - w)); };
  console.log(`\n全角色 × 受保护接口 实跑鉴权矩阵  —  ${BASE}`);
  console.log('='.repeat(78));
  console.log(`接口 ${endpoints.length} 个 × 角色 ${ROLES.length} 个 = ${rows.length} 次实际请求\n`);

  for (const role of ROLES) {
    const mine = rows.filter((r) => r.角色 === LABEL[role] && r.判定 !== '脚本覆盖不到');
    const bad = mine.filter((r) => r.判定 !== 'OK');
    console.log(`  ${bad.length ? '❌' : '✅'} ${pad(LABEL[role], 12)} 放行 ${pad(mine.filter(r => r.应当 === '放行').length, 3)} 拒绝 ${pad(mine.filter(r => r.应当 === '拒绝').length, 3)} 不符 ${bad.length}`);
  }

  if (uncovered.size) console.log(`\n本脚本覆盖不到 ${uncovered.size} 个接口（需要请求体里的 id 或只能改自己的记录，空请求被故障安全地拒绝 —— 这是对的行为，留给人工用例）：\n  ${[...uncovered].join('\n  ')}`);
  if (skipped.length) console.log(`\n跳过 ${skipped.length} 个接口（库里没有对应的真实数据，测了也只是 404）：\n  ${skipped.join('\n  ')}`);

  if (problems.length) {
    console.log(`\n❌ ${problems.length} 处不符：\n`);
    problems.forEach((p) => console.log(`  [${p.级别}] ${p.角色}  ${p.接口 || ''}\n        ${p.说明}`));
    process.exitCode = 1;
  } else {
    console.log('\n✅ 全部符合预期：该放的放了，该拒的拒了，没有一个 5xx。\n');
  }
};

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
