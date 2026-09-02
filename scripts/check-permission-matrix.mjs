#!/usr/bin/env node
/**
 * 权限矩阵体检：角色 × 页面 × 敏感元素。
 *
 * 起因：权限问题一直靠人工逐个发现（"你指一个我查一个"）。这个脚本把审查固化下来，
 * 每次改角色能力或加页面都跑一次，越权在提交前就暴露。
 *
 * 检查三件事：
 *   1. 每个路由是否有守卫（侧边栏隐藏入口挡不住直接输网址）
 *   2. 角色能进的页面是否符合其导航权限
 *   3. 敏感元素（金额/提成）所在页面是否有对应权限门
 *
 * 用法：npm run health:permissions
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fail = [];
const warn = [];

const constants = read('constants.ts');
const app = read('App.tsx');

/* ---------- 解析角色能力 ---------- */
const navBlock = constants.match(/export const ROLE_PERMISSIONS[^=]*=\s*\{([\s\S]*?)\n\};/);
const rolePerms = {};
for (const line of navBlock[1].trim().split('\n')) {
  const m = line.match(/^\s*(\w+):\s*\[(.*?)\]/);
  if (m) rolePerms[m[1]] = [...m[2].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

const capBlock = constants.match(/export const ROLE_CAPABILITIES[^=]*=\s*\{([\s\S]*?)\n\};/);
const roleActions = {};
for (const role of Object.keys(rolePerms)) {
  const m = capBlock[1].match(new RegExp(`${role}:\\s*\\{\\s*\\n\\s*actions:\\s*\\[([\\s\\S]*?)\\]`));
  roleActions[role] = m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]) : [];
}

/* ---------- 1. 路由守卫覆盖 ---------- */
const routes = [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)]
  .map(([, p, el]) => ({ path: p, el }))
  // /dashboard 是所有角色的落地页，按设计对全员开放，不需要守卫
  .filter((r) => !['/', '/login', '/change-password', '/dashboard', '*'].includes(r.path));

const unguarded = routes.filter((r) => !r.el.includes('ProtectedRoute'));
if (unguarded.length) {
  fail.push(`以下路由没有守卫，直接输网址即可进入：${unguarded.map((r) => r.path).join(', ')}`);
}

/* ---------- 2. 角色 × 页面矩阵 ---------- */
const guards = {};
for (const r of routes) {
  const m = r.el.match(/ProtectedRoute\s+(permission|action)="([A-Z_]+)"/);
  if (m) guards[r.path] = { kind: m[1], code: m[2] };
}
const canEnter = (role, g) =>
  g.kind === 'permission' ? rolePerms[role].includes(g.code) : roleActions[role].includes(g.code);

/* ---------- 3. 敏感元素权限门 ---------- */
const SENSITIVE_PAGES = {
  'pages/Contracts.tsx': { needs: 'CONTRACT_VIEW_AMOUNT', hint: '合同金额' },
  'pages/Customers.tsx': { needs: 'CONTRACT_VIEW_AMOUNT', hint: '客户财务信息' },
  'pages/Projects.tsx': { needs: 'SETTLEMENT_VIEW', hint: '项目结算与提成' },
};
for (const [file, { needs, hint }] of Object.entries(SENSITIVE_PAGES)) {
  const src = read(file);
  if (!src.includes(needs)) {
    fail.push(`${file} 展示${hint}，但页内找不到 ${needs} 权限判断`);
  }
}

/* ---------- 输出 ---------- */
const NAMES = { ADMIN: '老板', SYS_ADMIN: '系统管理员', MANAGER: '交付负责人', SALES: '销售', CONSULTANT: '咨询顾问', FINANCE: '财务' };
const roles = Object.keys(rolePerms);
console.log('\n角色 × 页面访问矩阵\n');
console.log('页面'.padEnd(24) + roles.map((r) => (NAMES[r] || r).padEnd(11)).join(''));
console.log('─'.repeat(24 + roles.length * 11));
for (const p of Object.keys(guards).sort()) {
  console.log(p.padEnd(26) + roles.map((r) => (canEnter(r, guards[p]) ? '✅' : '—').padEnd(12)).join(''));
}

console.log(`\n路由守卫覆盖：${routes.length - unguarded.length}/${routes.length}`);
if (warn.length) warn.forEach((w) => console.log(`⚠️  ${w}`));
if (fail.length) {
  console.log('\n❌ 权限体检未通过：');
  fail.forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('✅ 权限体检通过\n');
