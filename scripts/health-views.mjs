#!/usr/bin/env node
// 视角体检：把「不同身份看到什么」算成矩阵，人工逐个视角点是查不全的。
//
//   npm run health:views
//
// 三件事：
//   ① 列出每个角色在各页面能看到哪些受控区块（依据 ROLE_CAPABILITIES.actions）
//   ② 找出**用硬编码角色数组**而不是权限码的门 —— 这类门不在权限矩阵里，
//      health:permissions 查不到，改了角色定义也不会跟着变，是越权问题的常见来源
//   ③ 找出**矛盾组合** —— 例如「能确认到账但看不到金额」「能完成任务但没有查看权」，
//      这种组合在真人身上一定会表现成 bug，但单看某一个视角发现不了
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const constants = fs.readFileSync('constants.ts', 'utf8');

/** 只取真实业务角色，排除任务模板/流程模板（它们也长得像 {id, name}） */
const readRoles = () => {
  const block = constants.match(/export const SYSTEM_ROLES[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error('找不到 SYSTEM_ROLES');
  return [...block[1].matchAll(/id:\s*'([A-Z_]+)'\s*,\s*name:\s*'([^']+)'/g)]
    .map((m) => ({ id: m[1], name: m[2] }));
};

const readActions = (roleId) => {
  const cap = constants.match(/export const ROLE_CAPABILITIES[^=]*=\s*\{([\s\S]*)\n\};/);
  if (!cap) throw new Error('找不到 ROLE_CAPABILITIES');
  const m = cap[1].match(new RegExp(`\\b${roleId}:\\s*\\{[\\s\\S]*?actions:\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
};

/**
 * 扫页面里的权限门。两种写法：
 *   checkActionPermission('X', ...)  → 走权限矩阵，好
 *   ['ADMIN','MANAGER'].includes(activeRole) → 硬编码，绕过矩阵
 */
const scanGates = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const gates = [];
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;

  for (const m of src.matchAll(/const\s+(can[A-Z]\w*|is[A-Z]\w*)\s*=\s*checkActionPermission\(\s*'([A-Z_]+)'/g)) {
    gates.push({ file, line: lineAt(m.index), name: m[1], kind: 'action', action: m[2] });
  }
  // 硬编码角色数组
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*\[([^\]]*?'(?:ADMIN|SYS_ADMIN|MANAGER|SALES|CONSULTANT|FINANCE)'[^\]]*?)\]\s*\.includes\(\s*(activeRole|currentUser\.activeRole|role)\s*\)/g)) {
    gates.push({
      file, line: lineAt(m.index), name: m[1], kind: 'hardcoded',
      roles: [...m[2].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]),
    });
  }
  // 内联的 activeRole === 'X' || activeRole === 'Y' 判断
  for (const m of src.matchAll(/(\w+)\s*=\s*[^;\n]*?activeRole\s*===\s*'([A-Z_]+)'\s*\|\|[^;\n]*?activeRole\s*===\s*'([A-Z_]+)'/g)) {
    gates.push({ file, line: lineAt(m.index), name: m[1], kind: 'hardcoded', roles: [m[2], m[3]] });
  }
  return gates;
};

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
};

// 逻辑上互相依赖的权限：前者成立时后者必须也成立，否则界面必然矛盾
const IMPLIES = [
  ['PAYMENT_CONFIRM', 'CONTRACT_VIEW_AMOUNT', '能确认到账，却看不到合同金额——不知道金额怎么核对'],
  ['SETTLEMENT_VIEW', 'CONTRACT_VIEW_AMOUNT', '能看结算提成，却看不到合同金额——提成基数从哪来'],
  ['TASK_COMPLETE', 'PROJECT_VIEW', '能完成任务，却没有项目查看权'],
  ['PROJECT_ASSIGN_MANAGER', 'PROJECT_VIEW', '能指派负责人，却没有项目查看权'],
  ['SETTLEMENT_VIEW', 'PROJECT_VIEW', '能看项目结算，却没有项目查看权'],
];

const main = () => {
  const roles = readRoles();
  const roleActions = new Map(roles.map((r) => [r.id, new Set(readActions(r.id))]));
  const files = walk('pages').concat(walk('components'));
  const gates = files.flatMap((f) => { try { return scanGates(f); } catch { return []; } });

  const actionGates = gates.filter((g) => g.kind === 'action');
  const hardGates = gates.filter((g) => g.kind === 'hardcoded');

  // ── ① 矩阵 ──
  const shown = [...new Set(actionGates.map((g) => g.action))].sort();
  console.log('\n━━ 角色 × 受控动作矩阵（依据 ROLE_CAPABILITIES）\n');
  const w = 12;
  console.log('  ' + '角色'.padEnd(20) + shown.map((a) => a.replace(/^(CONTRACT|PROJECT)_/, '').slice(0, w - 1).padEnd(w)).join(''));
  for (const r of roles) {
    const set = roleActions.get(r.id);
    console.log('  ' + `${r.name}(${r.id})`.padEnd(20) + shown.map((a) => (set.has(a) ? '✓' : '·').padEnd(w)).join(''));
  }

  // ── ② 硬编码角色门 ──
  console.log(`\n━━ 绕过权限矩阵的硬编码角色门（${hardGates.length} 处）`);
  if (hardGates.length === 0) console.log('  无');
  else {
    console.log('  这类门不在权限矩阵里，health:permissions 查不到；改角色定义时不会同步。');
    for (const g of hardGates) {
      console.log(`  ${g.file}:${g.line}  ${g.name} = [${g.roles.join(', ')}]`);
    }
  }

  // ── ③ 矛盾组合 ──
  console.log('\n━━ 权限矛盾组合');
  let bad = 0;
  for (const r of roles) {
    const set = roleActions.get(r.id);
    for (const [a, needs, why] of IMPLIES) {
      if (set.has(a) && !set.has(needs)) { console.log(`  ✗ ${r.name}：${why}`); bad += 1; }
    }
  }
  if (bad === 0) console.log('  无矛盾');

  console.log(`\n扫描 ${files.length} 个页面，找到 ${actionGates.length} 个权限码门、${hardGates.length} 个硬编码门。\n`);
  if (hardGates.length || bad) process.exitCode = 1;
};

main();
