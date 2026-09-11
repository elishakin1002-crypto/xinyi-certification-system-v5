#!/usr/bin/env node
/**
 * 上线前测试覆盖矩阵 —— **从代码里算出来，不手写**。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来 2026-09-11：
 *
 * 「应该不是一伙检查出这里有漏洞，一伙检查出那里有漏洞，
 *   应该是有一份全面详细的上线前的测试计划吧！并按之执行吧」
 *
 * 他是对的。之前的做法是**散点排查** —— 聊到哪查到哪，
 * 确实抓到了不少真问题（自动建项目、头像消失、字段静默丢失），
 * 但它有个致命缺陷：
 *
 *   **永远不知道什么时候算测完了。**
 *
 * 散点排查给不出「哪些还没看过」这张图。而上线前真正要回答的
 * 恰恰是这个问题，不是「我们找到了多少 bug」。
 *
 * ── 为什么从代码算，不手写清单 ────────────────────────────────
 *
 * 手写的清单必然漏，而且**漏在哪儿你不知道** —— 这跟散点排查
 * 是同一个毛病，只是换了个更正式的外壳。
 *
 * 这个脚本把三份东西交叉出矩阵：
 *   · 路由表（App.tsx）            —— 有哪些页面
 *   · ROLE_PERMISSIONS（constants）—— 谁能看哪些页面
 *   · ROLE_CAPABILITIES（constants）—— 谁能做哪些动作
 *
 * 加一个页面、加一个角色、加一个动作，矩阵**自动变大**，
 * 新格子自动是「未覆盖」。清单不会过时。
 *
 * ── 自动化覆盖怎么判定 ────────────────────────────────────────
 *
 * 在 tests/ 里搜这个动作码/路由出现过没有。**这是个粗判据**：
 * 出现过不代表测得对。但它能可靠地回答反面 ——
 * **一次都没出现过的，肯定没测过**，而那才是这张表要找的东西。
 *
 * 用法：
 *   node scripts/test-coverage-matrix.mjs            # 看矩阵
 *   node scripts/test-coverage-matrix.mjs --cases    # 生成人工用例清单
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const WANT_CASES = process.argv.includes('--cases');

const ROLE_LABEL = {
  ADMIN: '总经理', SYS_ADMIN: '系统管理员', MANAGER: '总助',
  SALES: '销售', CONSULTANT: '咨询顾问', FINANCE: '财务',
};

// ── 1. 路由：有哪些页面，各自要什么权限 ──
const app = read('App.tsx');
const routes = [...app.matchAll(/<Route path="(\/[a-z0-9/-]*)"[^>]*element=\{([\s\S]{0,180}?)\}\s*\/>/g)]
  .map((m) => {
    const perm = m[2].match(/permission="([A-Z_]+)"/)?.[1] || null;
    const action = m[2].match(/action="([A-Z_]+)"/)?.[1] || null;
    return { path: m[1], perm, action };
  })
  .filter((r) => r.path !== '/' && !/Navigate/.test(r.path));

/*
  去重 + 去掉不算业务页面的两个。

  /login 和 /change-password 在 App.tsx 里各出现两次（鉴权分支里一次、
  主分支里一次重定向），直接交叉会把它们数两遍 ——
  **矩阵里多出来的格子和漏掉的格子一样有害**：
  它让「20 个页面」这个数字不可信，而这张表的全部价值就是数字可信。
  它俩也不是业务页面（一个是登录、一个是强制改密），不进覆盖矩阵。
*/
const SKIP = new Set(['/login', '/change-password']);
const seen = new Set();
const pages = routes.filter((r) => {
  if (SKIP.has(r.path) || seen.has(r.path)) return false;
  seen.add(r.path);
  return true;
});

// ── 2. 权限定义 ──
const constants = read('constants.ts');
const sliceBlock = (name) => {
  const i = constants.indexOf(`export const ${name}`);
  if (i < 0) return '';
  const open = constants.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < constants.length; j += 1) {
    if (constants[j] === '{') depth += 1;
    if (constants[j] === '}') { depth -= 1; if (depth === 0) return constants.slice(open, j + 1); }
  }
  return '';
};

const parsePerRole = (block, key) => {
  const out = {};
  for (const role of Object.keys(ROLE_LABEL)) {
    const re = new RegExp(`\\b${role}\\s*:\\s*(\\{[\\s\\S]*?\\}|\\[[\\s\\S]*?\\])`, 'm');
    const m = block.match(re);
    if (!m) { out[role] = []; continue; }
    const body = key ? (m[1].match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`))?.[1] || '') : m[1];
    out[role] = [...body.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
  }
  return out;
};

const perms = parsePerRole(sliceBlock('ROLE_PERMISSIONS'), null);
const caps = parsePerRole(sliceBlock('ROLE_CAPABILITIES'), 'actions');

// ── 3. 自动化覆盖：在 tests/ 里出现过没有 ──
const testBlob = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => read(`tests/${f}`)).join('\n');
const covered = (token) => testBlob.includes(`'${token}'`) || testBlob.includes(`"${token}"`) || testBlob.includes(token);

const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

const roles = Object.keys(ROLE_LABEL);

// ══ 页面 × 角色 ══
console.log('\n上线前测试覆盖矩阵');
console.log('='.repeat(94));
console.log('\n【一】页面 × 角色 —— ✅ 该能进　·  该挡住\n');
console.log(pad('页面', 24) + roles.map((r) => pad(ROLE_LABEL[r], 12)).join(''));
console.log('-'.repeat(94));

let cells = 0;
const pageCases = [];
for (const r of pages) {
  const row = roles.map((role) => {
    const ok = r.perm ? (perms[role] || []).includes(r.perm)
      : r.action ? (caps[role] || []).includes(r.action)
        : true;
    cells += 1;
    if (ok) pageCases.push({ role, path: r.path });
    return pad(ok ? '✅' : '·', 12);
  });
  console.log(pad(r.path, 24) + row.join(''));
}

// ══ 动作 × 角色 ══
const allActions = [...new Set(Object.values(caps).flat())].sort();
console.log(`\n【二】动作 × 角色 —— 共 ${allActions.length} 个动作码\n`);
console.log(pad('动作', 26) + roles.map((r) => pad(ROLE_LABEL[r], 10)).join('') + '自动化测试');
console.log('-'.repeat(94));

const uncoveredActions = [];
for (const a of allActions) {
  const row = roles.map((role) => pad((caps[role] || []).includes(a) ? '✅' : '·', 10)).join('');
  const auto = covered(a);
  if (!auto) uncoveredActions.push(a);
  console.log(pad(a, 26) + row + (auto ? '有' : '❌ 无'));
}

// ══ 结论 ══
console.log('\n' + '='.repeat(94));
console.log('结论');
console.log('='.repeat(94));
console.log(`\n页面 ${pages.length} 个 × 角色 ${roles.length} 个 = ${cells} 个格子，其中「该能进」${pageCases.length} 个`);
console.log(`动作 ${allActions.length} 个，其中 ${allActions.length - uncoveredActions.length} 个在自动化测试里出现过`);

if (uncoveredActions.length) {
  console.log(`\n❌ 这 ${uncoveredActions.length} 个动作在 tests/ 里一次都没出现过 —— **肯定没测过**：`);
  uncoveredActions.forEach((a) => console.log(`   · ${a}`));
  console.log('\n（出现过不代表测得对，但没出现过一定没测。这张表找的就是后者。）');
} else {
  console.log('\n✅ 每个动作码在自动化测试里都出现过。');
}

if (WANT_CASES) {
  console.log('\n' + '='.repeat(94));
  console.log('人工用例清单（按角色分，每人拿自己那份）');
  console.log('='.repeat(94));
  const byRole = new Map();
  pageCases.forEach(({ role, path: p }) => byRole.set(role, [...(byRole.get(role) || []), p]));
  for (const role of roles) {
    const list = byRole.get(role) || [];
    console.log(`\n■ ${ROLE_LABEL[role]}（${role}）　该能进 ${list.length} 个页面`);
    list.forEach((p) => console.log(`   [ ] ${pad(p, 22)} 能打开 / 有数据 / 帮助答得上来`));
    const denied = pages.filter((r) => !list.includes(r.path)).map((r) => r.path);
    if (denied.length) console.log(`   [ ] 直接输网址访问 ${denied.slice(0, 3).join('、')} → 应被挡住`);
  }
}
console.log();
