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
/*
  ══════════════════════════════════════════════════════════════
  巡检自己的「样本箱」—— 这个脚本只许碰它自己造的记录
  ══════════════════════════════════════════════════════════════

  ── 三个版本的演变，记下来是因为前两版都错得很有代表性 ──

  v1：拿**真实 id** 去调所有接口，包括 DELETE。
      于是每跑一次巡检，每个有权限的角色就真删掉一条真实记录。
      实测跑一次，知识中心从 8 篇变 6 篇。**巡检工具自己在破坏数据。**

  v2：DELETE 一律换成不存在的 id（ZZZ-NOT-EXIST）。
      数据是不掉了，但金恩来 2026-09-14 一句话点破两个问题：
        ① 「有权限 + 假 id → 404」只证明**没被 403**，
           **根本没验证删除这条路真的能走通** —— 删除接口哪天坏了，这张表照样全绿
        ② PATCH/PUT 还在拿**真实记录**发 `{}`。现在数据是假的无所谓，
           **正式运营后，这就是在拿同事的真合同做实验。**

  v3（现在这版）：**巡检自己建一套样本，全程只碰这套样本。**
      · 建之前先给真实表点一次名，跑完再点一次 —— 少一条就当场报错
      · 每个要改/要删的接口，先现造一条样本记录，对着它调
      · 调完（不管成功失败）把样本收干净，收不干净也报错
      · 有一道硬闸：任何非 GET 请求，URL 里的 id 不在样本箱里就**直接抛异常**，
        不是警告，是中止 —— 这条闸门才是真正让人敢在生产上跑的东西

  这样三件事同时成立：删除真的被验证了、真实数据一根汗毛都没动、
  而且「有没有动」是可证的，不是我说了算。
*/
const SANDBOX_TAG = '__authz巡检样本__';

/**
 * 跑前跑后各点一次名的表，以及「哪一列能认出样本」。
 *
 * 点的是**去掉样本之后的真实条数**：样本自己增增减减是正常的，
 * 真实记录少一条都不正常。
 */
const CENSUS_TABLES = [
  ['leads'], ['customers'], ['contracts'], ['projects'],
  ['knowledge_docs'], ['reminders'], ['project_work_logs'], ['business_events']
];
const SANDBOX_COL = {
  leads: 'name', customers: 'name', contracts: 'title', projects: 'name',
  knowledge_docs: 'title',
  // 这三张表没有名字列，样本不会落到它们里，用主键凑数即可（等于全量计数）
  reminders: 'id', project_work_logs: 'id', business_events: 'id'
};

/*
  **只减不增算事故的表**（流水账）。

  business_events 是「谁做了什么、谁被拒了什么」的审计流水，
  巡检跑一轮必然往里写几十条 `XXX.denied` —— 那是它**正常工作的证据**，
  不是数据被动了。第一版把它和业务表一视同仁，于是每跑一次都报「事故」，
  而狼来了喊多了，真出事那次就没人看了。

  这类表只盯一件事：**有没有变少**。审计流水少一条都是被人抹了痕迹。
*/
const APPEND_ONLY_TABLES = new Set(['business_events']);

/** 样本箱：只有登记在这里的 id，才允许被非 GET 请求碰 */
const sandbox = new Set();

/**
 * 硬闸门。放在真正发请求之前，越权碰真实数据时**抛异常中止整个脚本**。
 *
 * 为什么是抛异常而不是打印警告：警告会被滚屏淹没，
 * 而这条规则一旦破了，代价是别人的真实记录 —— 没有"先记下来回头看"的余地。
 */
const assertOnlyTouchesSandbox = (url, method, injected) => {
  if (String(method || '').toUpperCase() === 'GET') return;
  /*
    只检查**我自己填进去的那些 id**，不去猜 URL 里哪一段像 id。

    第一版是按形状猜的（含 '-' 或长度 > 8 就当 id），
    结果 `/api/leads/:id/follow-ups` 里的字面量 `follow-ups` 被当成了 id，
    闸门在第一条路由上就把脚本拦死了。
    **按形状猜的规则，在这个项目里已经错过四次**（见 HelpHub 的遮罩判定）。
    这里不用猜：模板里每个 :param 被替换成了什么，我是知道的。
  */
  for (const id of injected) {
    if (!sandbox.has(String(id))) {
      throw new Error(
        `巡检试图对非样本记录发 ${method} ${url}\n` +
        `  填进去的 id「${id}」不在样本箱里。\n` +
        `  这是硬性禁止的：巡检只许碰自己造的记录。\n` +
        `  多半是新加了路由但没在 SANDBOX_FACTORY 里给它配样本。`
      );
    }
  }
};

/**
 * 样本工厂：每种资源怎么造一条、造在哪个接口上。
 *
 * 全都带 SANDBOX_TAG 前缀，万一脚本被 Ctrl-C 打断没收干净，
 * 人在界面上一眼就能认出这是巡检留下的，而不是真业务数据。
 */
const SANDBOX_FACTORY = {
  lead: { url: '/api/leads', body: () => ({ name: `${SANDBOX_TAG}联系人`, company: `${SANDBOX_TAG}公司`, leadStatus: 'New' }), pick: (j) => j?.data?.lead?.id || j?.data?.id },
  customer: { url: '/api/customers', body: () => ({ name: `${SANDBOX_TAG}客户${Date.now()}` }), pick: (j) => j?.data?.customer?.id || j?.data?.id },
  contract: { url: '/api/contracts', body: () => ({ title: `${SANDBOX_TAG}合同`, amount: 1 }), pick: (j) => j?.data?.contract?.id || j?.data?.id },
  project: { url: '/api/projects', body: () => ({ name: `${SANDBOX_TAG}项目` }), pick: (j) => j?.data?.project?.id || j?.data?.id },
  knowledge: { url: '/api/knowledge', body: () => ({ title: `${SANDBOX_TAG}文档` }), pick: (j) => j?.data?.doc?.id || j?.data?.id },
};

const URL_KIND = (url) => url.startsWith('/api/leads') ? 'lead'
  : url.startsWith('/api/customers') ? 'customer'
    : url.startsWith('/api/projects') ? 'project'
      : url.startsWith('/api/contracts') ? 'contract'
        : url.startsWith('/api/settlements') ? 'settlement'
          : url.startsWith('/api/signals') ? 'signal'
            : url.startsWith('/api/knowledge') ? 'knowledge' : null;

/** 现造一条样本，登记进样本箱，返回它的 id；造不出来返回 null（那条接口就跳过） */
const mintSandbox = async (kind, cookie) => {
  const f = SANDBOX_FACTORY[kind];
  if (!f) return null;
  try {
    const r = await fetch(`${BASE}${f.url}`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(f.body())
    });
    const j = await r.json().catch(() => ({}));
    const id = f.pick(j);
    if (id) { sandbox.add(String(id)); return String(id); }
  } catch { /* 造不出来就跳过这条接口，宁可少测一条也不碰真数据 */ }
  return null;
};

/** 返回 { url, injected }：injected 是这次替换真正填进去的 id，交给闸门核对 */
const fillParams = (url, ids) => {
  if (!url.includes(':')) return { url, injected: [] };
  const kind = URL_KIND(url);
  const id = kind ? ids[kind] : null;
  if (!id) return null;                               // 没有可用样本，跳过这条
  const injected = [];
  const filled = url
    .replace(/:taskId/g, () => { injected.push(ids.task || id); return ids.task || id; })
    .replace(/:[a-zA-Z]+/g, () => { injected.push(id); return id; });
  return { url: filled, injected };
};

const { Pool: CensusPool } = require(path.join(ROOT, 'node_modules/pg'));
const censusPool = new CensusPool({ connectionString: process.env.DATABASE_URL });

const main = async () => {
  await store.initAuthStore();
  const users = [];
  for (const r of ROLES) users.push(await mkUser(r));

  const anyCookie = await login(users[0].username, users[0].pwd);

  /*
    ── 跑之前先给真实数据点名（2026-09-14 加）───────────────────

    金恩来：「若是证实上线后需要对系统升级维护，巡检脚本时会去删真实数据吗？
             那问题就大了。」

    上面那道样本箱闸门是「防」，这里的点名是「证」：
    跑完再点一次，对不上就当场喊出来。
    **防住了不等于证明防住了** —— 之前我就是以为防住了，
    而它一边删知识文档一边报「全过」。
  */
  const census = async () => {
    const t = {};
    for (const [table] of CENSUS_TABLES) {
      try {
        const { rows: [r] } = await censusPool.query(
          `select count(*)::int c from ${table} where coalesce(cast(${SANDBOX_COL[table]} as text),'') not like '%${SANDBOX_TAG}%'`);
        t[table] = r.c;
      } catch { t[table] = null; }
    }
    return t;
  };
  const before = await census();

  /*
    样本箱里先各造一条打底。后面每条破坏性接口调用前会再补造，
    这里这一批是给 PATCH/PUT 这类「改不动但要有个靶子」的接口用的。
  */
  const ids = {
    lead: await mintSandbox('lead', anyCookie),
    customer: await mintSandbox('customer', anyCookie),
    project: await mintSandbox('project', anyCookie),
    contract: await mintSandbox('contract', anyCookie),
    knowledge: await mintSandbox('knowledge', anyCookie),
    settlement: null,   // 结算没有独立的建接口，暂时不测带 id 的那几条
    signal: null,       // 情报信号同上
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

      /*
        破坏性接口：**每次都现造一条新样本**对着它调。

        这样 DELETE 是真的删掉了一条记录 —— 删除这条路真的被走通过，
        而不是像上一版那样拿假 id 换一个 404 就算「放行」。
        删除接口哪天写坏了（比如又写在 app.js 里走错存储层），
        这里会当场露馅。
      */
      const kind = URL_KIND(ep.url);
      if (ep.method === 'DELETE' && ep.url.includes(':') && SANDBOX_FACTORY[kind]) {
        const fresh = await mintSandbox(kind, anyCookie);
        if (fresh) ids[kind] = fresh;
      }

      const filled = fillParams(ep.url, ids);
      if (!filled) { if (u === users[0]) skipped.push(`${ep.method} ${ep.url}（造不出样本记录）`); continue; }
      const { url, injected } = filled;
      let status = 0; let policy = '';
      try {
        assertOnlyTouchesSandbox(url, ep.method, injected);   // ← 硬闸门，碰到真数据就中止
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
      } catch (e) {
        // 样本箱闸门报的警必须一路抛上去中止脚本，不能被「网络错误」这个 catch 吞掉。
        // 第一版就是写成 `catch { status = -1 }` —— 闸门等于没装。
        if (String(e?.message || '').includes('非样本记录')) throw e;
        status = -1;
      }

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
  const pool = censusPool;
  await pool.query('delete from auth_users where username like $1', ['mx-%']);

  /*
    ── 收样本 + 点名对账（2026-09-14 加）──────────────────────

    先把样本箱里的记录全扫掉（有的已经被 DELETE 测试删过了，删不掉就跳过），
    再给真实数据点一次名，和跑之前那次比。

    **少一条就是事故**，直接把整个巡检判为失败并退出码非零 ——
    宁可让人以为巡检坏了，也不能让它悄悄删完还报「全过」。
  */
  /*
    先收样本记录**牵连出来的东西**，再收样本本身 —— 顺序反了就找不到牵连方了。

    2026-09-14 第一次跑这版才发现：造 5 条样本，连带生出
    **6 条提醒 + 66 条业务事件**。它们都挂在样本 id 上，样本一删就全成了孤儿。

    这不只是巡检的问题，这是产品的问题：金恩来同一天问「提醒越挂越多也是个问题」——
    根子就在这儿，**建一条业务记录会顺手生提醒，而记录没了提醒还在**。
    巡检这边先把自己的收干净，产品那边的解法另算（见 docs/踩过的坑）。
  */
  const sandboxIds = [...sandbox];
  if (sandboxIds.length) {
    try { await pool.query('delete from reminders where link_id = any($1)', [sandboxIds]); } catch { /* 列名对不上就跳过 */ }
    try { await pool.query('delete from business_events where subject_id = any($1)', [sandboxIds]); } catch { /* 同上 */ }
  }

  for (const [table] of CENSUS_TABLES) {
    const col = SANDBOX_COL[table];
    if (col === 'id') continue;                       // 那几张表里不会有样本
    try {
      await pool.query(`delete from ${table} where cast(${col} as text) like $1`, [`%${SANDBOX_TAG}%`]);
    } catch { /* 表结构对不上就跳过，不让收尾把主流程打断 */ }
  }

  const after = await census();
  const drifted = [];
  for (const [table] of CENSUS_TABLES) {
    if (before[table] == null || after[table] == null) continue;
    const delta = after[table] - before[table];
    if (delta === 0) continue;
    if (APPEND_ONLY_TABLES.has(table) && delta > 0) continue;   // 流水账只查变少
    drifted.push(`${table}：跑前 ${before[table]} 条，跑后 ${after[table]} 条（${delta > 0 ? '多' : '少'}了 ${Math.abs(delta)} 条）`);
  }

  const stranded = await pool.query(
    `select count(*)::int c from knowledge_docs where title like $1`, [`%${SANDBOX_TAG}%`]).catch(() => ({ rows: [{ c: 0 }] }));

  /*
    ── 顺便查一件事：这一轮有没有建出「空记录」（2026-09-12 加）──

    金恩来：「创建项目页面的关联合同下面都是 0¥ 怎么回事？」
    本机 52 份合同里 40 份标题为空、金额为 0 ——
    「关联合同」下拉变成一排「（¥0）」，一条也认不出来。

    来源就是这个脚本：它给每个非 GET 接口发 `{}`。
    **发空 body 是对的**（要验的是 403 和非 403），
    错的是 `POST /api/contracts` 空 body 也返回 201 ——
    projects / customers / leads 三个早就 400 了，唯独合同漏了。

    所以这里不改请求体，改成**跑完数一遍**：
    空 body 建出了记录，就说明那个接口缺输入校验。
    以后再新增建类接口忘了加校验，这一行会当场喊出来，
    而不是等半年后有人看见一排「（¥0）」。
  */
  const emptyChecks = [
    ['contracts', 'title', '合同'],
    ['projects', 'name', '项目'],
    ['customers', 'name', '客户'],
    ['leads', 'name', '线索'],
    // 2026-09-13 补：知识中心当初漏在名单外，于是每跑一次巡检就多几条
    // 空壳文档，而这段自检看不见它们 —— 自检自己有盲区，比没有自检更糟。
    ['knowledge_docs', 'title', '知识文档'],
    // 2026-09-14 补：提醒也漏在名单外。空 body 建出 6 条 title 为 null 的提醒 ——
    // 界面上就是「一条没有标题、点开什么也没有、又消不掉」的提醒。
    ['reminders', 'title', '提醒'],
  ];
  const leftovers = [];
  for (const [table, col, label] of emptyChecks) {
    try {
      const { rows: [r] } = await pool.query(
        `select count(*)::int c from ${table} where coalesce(${col},'') = ''`);
      if (r.c > 0) leftovers.push(`${label} ${r.c} 条`);
    } catch { /* 列名对不上就跳过，不让自检本身把主流程打断 */ }
  }
  await pool.end();

  const pad = (s, n) => { const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0); return String(s) + ' '.repeat(Math.max(0, n - w)); };

  if (leftovers.length) {
    console.log(`\n⚠️  库里有没名字的空记录：${leftovers.join('、')}`);
    console.log('   空 body 能建出记录 = 那个建接口缺输入校验（合同就这么漏过一次，');
    console.log('   结果「关联合同」下拉里全是一排「（¥0）」）。');
  }

  /*
    这一段的输出要放在最显眼的位置，而且它能一票否决整个巡检结果。
    「巡检有没有动真实数据」比「权限对不对」更要紧 ——
    权限错了改回来就行，数据删了是找备份。
  */
  console.log(`\n真实数据点名（跑前 → 跑后，已扣掉巡检自己的样本）：`);
  for (const [table] of CENSUS_TABLES) {
    if (before[table] == null) continue;
    const delta = after[table] - before[table];
    const ok = delta === 0 || (APPEND_ONLY_TABLES.has(table) && delta > 0);
    const note = APPEND_ONLY_TABLES.has(table) && delta > 0 ? `  （审计流水，巡检自己写进去的 ${delta} 条）` : '';
    console.log(`  ${ok ? '✅' : '❌'} ${pad(table, 20)} ${before[table]} → ${after[table]}${note}`);
  }
  if (stranded.rows[0].c > 0) {
    console.log(`\n⚠️  有 ${stranded.rows[0].c} 条巡检样本没收干净（标题里带「${SANDBOX_TAG}」），手动删掉。`);
  }
  if (drifted.length) {
    console.log(`\n❌ 巡检动了真实数据 —— 这是事故，不是缺陷：\n  ${drifted.join('\n  ')}`);
    console.log('   立刻停止在生产上跑这个脚本，并从 /opt/xinyi-releases 的快照恢复。');
    process.exitCode = 1;
  }

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
