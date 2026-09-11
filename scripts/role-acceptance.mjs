#!/usr/bin/env node
/**
 * 岗位验收测试：四个真实岗位各跑一遍，出报告。
 *
 * ══════════════════════════════════════════════════════════════
 * 这个脚本要回答的问题
 * ══════════════════════════════════════════════════════════════
 *
 * 不是「代码有没有 bug」（那是 npm test 的活），
 * 而是**「这个岗位的人明天登录进来，能不能干活」**：
 *
 *   ① 登得进来吗
 *   ② 该看见的菜单看得见吗、不该看的挡住了吗
 *   ③ 打开之后**有没有东西**（最容易翻车的一条 —— 权限对、页面在、
 *      但数据一条都不属于他，于是他看到一片空白）
 *   ④ 他的日常动作做得成吗（顾问记日志、总助看团队…）
 *   ⑤ 越权的动作是被干净地拒绝（403），还是把服务器搞崩（500）
 *
 * ⑤ 单独强调：**403 和 500 是两件事**。403 是「设计如此」，
 * 500 是「你没想到有人会这么点」—— 后者往往还伴随脏数据。
 *
 * 用法：
 *   node scripts/role-acceptance.mjs                  # 用 .runtime/测试账号-4人.json
 *   node scripts/role-acceptance.mjs --base=http://…  # 指定环境
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://localhost:3001';
const CRED = path.join(ROOT, '.runtime/测试账号-4人.json');

if (!fs.existsSync(CRED)) { console.error(`找不到测试账号文件：${CRED}`); process.exit(1); }
const accounts = JSON.parse(fs.readFileSync(CRED, 'utf8'));

/**
 * 每个岗位「该能」和「不该能」的清单。
 *
 * 判据来自 constants.ts 的 ROLE_PERMISSIONS —— 但**故意不 import 它**：
 * 拿同一份定义既生成又校验，等于自己考自己，permission 写错了也发现不了。
 * 这里按业务常识独立写一遍，两边对不上就说明有一边错了。
 */
const EXPECT = {
  '李智薇': {
    岗位: '总助',
    该能: ['/api/projects', '/api/customers', '/api/leads', '/api/contracts', '/api/auth/users'],
    不该能: ['/api/ai/usage'],           // 全公司 AI 用量只给老板和系统管理员
    关键: '看得到全团队的交付情况',
  },
  '黄佳佳': {
    岗位: '咨询顾问 · 食品认证',
    该能: ['/api/projects', '/api/customers', '/api/leads', '/api/contracts'],
    不该能: ['/api/auth/users', '/api/ai/usage', '/api/auth/audit-logs'],
    关键: '看得到自己名下的客户和任务',
  },
  '商春姿': {
    岗位: '咨询顾问 · 食品包装',
    该能: ['/api/projects', '/api/customers', '/api/leads', '/api/contracts'],
    不该能: ['/api/auth/users', '/api/ai/usage', '/api/auth/audit-logs'],
    关键: '看得到自己名下的客户和任务',
  },
  '黄邦煜': {
    岗位: '咨询顾问 · 体系认证',
    该能: ['/api/projects', '/api/customers', '/api/leads', '/api/contracts'],
    不该能: ['/api/auth/users', '/api/ai/usage', '/api/auth/audit-logs'],
    关键: '看得到自己名下的客户和任务',
  },
};

const login = async (account, password) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const setCookie = r.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, cookie, user: body?.data?.user || null, message: body?.message };
};

const call = async (cookie, method, url, body) => {
  const r = await fetch(`${BASE}${url}`, {
    method, headers: { cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* 有些是 204 */ }
  return { status: r.status, json };
};

const countOf = (json) => {
  const d = json?.data || {};
  for (const k of ['projects', 'customers', 'leads', 'contracts', 'users']) {
    if (Array.isArray(d[k])) return d[k].length;
  }
  return Array.isArray(d) ? d.length : null;
};

const findings = [];
const note = (级别, 岗位, 问题, 详情) => findings.push({ 级别, 岗位, 问题, 详情 });

const run = async () => {
  console.log(`\n岗位验收测试 —— ${new Date().toISOString().slice(0, 10)}   环境 ${BASE}`);
  console.log('='.repeat(78));

  for (const [name, info] of Object.entries(accounts)) {
    const exp = EXPECT[name];
    if (!exp) continue;
    console.log(`\n【${name}】${exp.岗位}   账号 ${info.账号}`);
    console.log('-'.repeat(78));

    // ① 登得进来吗
    const s = await login(info.账号, info.密码);
    if (!s.ok || !s.cookie) {
      console.log(`  ❌ 登录失败：${s.status} ${s.message || ''}`);
      note('阻断', name, '登不进系统', `${s.status} ${s.message || ''}`);
      continue;
    }
    console.log(`  ✅ 登录成功 —— 角色 ${(s.user?.roles || []).join(',')}`);

    // ② + ③ 该能的，要通、而且要有东西
    for (const url of exp.该能) {
      const r = await call(s.cookie, 'GET', url);
      const n = countOf(r.json);
      if (r.status !== 200) {
        console.log(`  ❌ ${url.padEnd(22)} ${r.status} —— 该能访问却被挡`);
        note('阻断', name, `该能访问却被挡：${url}`, `HTTP ${r.status}`);
      } else if (n === 0) {
        console.log(`  ⚠️  ${url.padEnd(22)} 200 但 0 条 —— 打开是空的`);
        note('空转', name, `${url} 返回 0 条`, '页面打开一片空白，人会以为系统没数据');
      } else {
        console.log(`  ✅ ${url.padEnd(22)} 200  ${n === null ? '' : n + ' 条'}`);
      }
    }

    // ⑤ 不该能的，要 403，**不能是 500**
    for (const url of exp.不该能) {
      const r = await call(s.cookie, 'GET', url);
      if (r.status === 403 || r.status === 401) {
        console.log(`  ✅ ${url.padEnd(22)} ${r.status}  正确拒绝`);
      } else if (r.status >= 500) {
        console.log(`  ❌ ${url.padEnd(22)} ${r.status}  越权请求把服务端搞崩了`);
        note('严重', name, `越权请求返回 ${r.status}`, `${url} 应该是 403，结果是服务端错误`);
      } else {
        console.log(`  ❌ ${url.padEnd(22)} ${r.status}  **越权成功**`);
        note('严重', name, `越权可访问：${url}`, `应拒绝，实际 HTTP ${r.status}`);
      }
    }

    // ③b 这个岗位真正每天要看的那几个数字
    const proj = await call(s.cookie, 'GET', '/api/projects');
    const list = proj.json?.data?.projects || [];
    const me = s.user?.name;
    const mine = list.filter((p) => p.manager === me || p.ownerUserId === s.user?.id);
    const myTasks = list.flatMap((p) => (p.tasks || []).filter((t) => t.owner === me));
    const openTasks = myTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Skipped');

    if (exp.岗位 === '总助') {
      const unassigned = list.flatMap((p) => (p.tasks || []).filter((t) => !String(t.owner || '').trim()));
      console.log(`  📊 全团队项目 ${list.length} 个 / 无主任务 ${unassigned.length} 条`);
      if (list.length === 0) note('阻断', name, '总助看不到任何项目', '她的工作台就是看团队交付，空的等于没用');
    } else {
      console.log(`  📊 与我相关项目 ${mine.length} 个 / 我的任务 ${myTasks.length} 条（未完成 ${openTasks.length}）`);
      if (mine.length === 0) {
        note('阻断', name, '「与我相关」是 0 个项目', '默认筛选就是与我相关，打开即空白');
      }
      /*
        这里要看的是**未完成**，不是总数。

        「我的任务」页默认筛「未完成」（isOpenTask 同时排除 Completed 和 Skipped），
        所以一个人哪怕名下挂着 27 条任务，只要全是已完成的，
        他打开还是一片空白 —— 而这恰恰最容易骗过测试：
        第一版这里判的是 myTasks.length，27 条，绿的，
        可真人点进去看到的是 0 条。
      */
      if (myTasks.length === 0) {
        note('阻断', name, '「我的任务」名下一条任务都没有', '顾问每天第一件事就是看这个');
      } else if (openTasks.length === 0) {
        note('空转', name, `名下 ${myTasks.length} 条任务全是已完成/已跳过`,
          '「我的任务」默认筛「未完成」，所以他打开看到的是 0 条 —— 会以为系统没派活给他');
      }
    }
  }

  // ── 报告 ──────────────────────────────────────────────────
  console.log(`\n${'='.repeat(78)}\n结论\n${'='.repeat(78)}`);
  if (!findings.length) {
    console.log('\n✅ 四个岗位都能登录、权限边界正确、打开有东西。可以叫人来测了。\n');
    return;
  }
  const order = { 严重: 0, 阻断: 1, 空转: 2 };
  findings.sort((a, b) => order[a.级别] - order[b.级别]);
  for (const f of findings) {
    console.log(`\n[${f.级别}] ${f.岗位} —— ${f.问题}`);
    console.log(`        ${f.详情}`);
  }
  console.log(`\n共 ${findings.length} 项。「阻断」是指这个岗位的人来了也测不了，要先解决。\n`);
  process.exitCode = findings.some((f) => f.级别 !== '空转') ? 1 : 0;
};

run().catch((e) => { console.error('失败:', e.message); process.exit(1); });
