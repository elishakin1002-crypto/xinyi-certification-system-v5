#!/usr/bin/env node
/**
 * 数据契约 —— 把「有哪些字段」固化成基线，改了必须是**故意的**。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-18）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来：「后面在用你继续写代码时，如何防止你又把不该改的字段
 *   或者别的功能等等给改了，的预防措施也要做。」
 *
 * 这个问题问得非常准。CI 已经很扎实（类型、测试、构建、密钥扫描、
 * 迁移检查、权限矩阵、E2E），但**没有任何一道闸门盯着"字段本身"**：
 *
 *   · 我把 `projectAmount` 顺手改名成 `amount` —— 类型能过（两边一起改），
 *     测试能过（测试也一起改了），但**线上库里的旧数据全部读不出来**
 *   · 我删掉一个没人引用的字段 —— 编译一点问题没有，
 *     而那个字段可能是财务每月导出时唯一用得上的那一列
 *   · 我把 `kind: 'amount'` 改成 `'int'` —— 金额的 ×100 ÷100 消失，
 *     8000 元变成 80 元，没有任何红字
 *
 * 共同点：**改动是静默的，代价是数据级的。**
 * 这类问题用"写测试覆盖它"防不住，因为你不知道要覆盖哪一个。
 *
 * ── 做法：golden file（基线快照）──────────────────────────────
 *
 * 成熟团队对付"契约悄悄变了"用的是同一招：把契约**写进仓库**，
 * 每次跑测试和它比对。不一致就红，并且要求人**显式更新基线**——
 * 于是这个改动一定会出现在 diff 里、出现在 code review 里。
 *
 * 不是禁止改，是**不许悄悄改**。
 *
 * ── 盯什么 ────────────────────────────────────────────────────
 *
 *   1. `server/repos/*.js` 的字段映射（api 名 ↔ 数据库列 ↔ 换算方式）
 *      —— 这是前端字段和库表列之间唯一的桥
 *   2. `types.ts` 里核心实体的字段名
 *      —— 前端所有页面按这个写
 *
 * 用法：
 *   node scripts/data-contract.mjs            # 打印当前契约
 *   node scripts/data-contract.mjs --write    # 更新基线（要在提交信息里说明为什么）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = path.join(ROOT, 'tests/fixtures/data-contract.json');

/** 从 repo 文件里抽 { api, col, kind } 三元组 —— 这是字段契约的核心 */
export const readRepoFields = () => {
  const dir = path.join(ROOT, 'server/repos');
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.js') || name.startsWith('_')) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const rows = [...src.matchAll(/\{\s*api:\s*'([^']+)'\s*,\s*col:\s*'([^']+)'\s*(?:,\s*kind:\s*'([^']+)')?/g)]
      .map(m => `${m[1]} → ${m[2]}${m[3] ? ` (${m[3]})` : ''}`);
    if (rows.length) out[name] = rows.sort();
  }
  return out;
};

/**
 * 从 types.ts 抽核心实体的字段名。
 * 只盯**业务实体**，不盯所有 interface —— 后者改动频繁，
 * 盯太多会让基线天天变，人就开始无脑 --write，闸门就废了。
 */
const CORE_TYPES = ['Lead', 'Customer', 'Contract', 'Receivable', 'Project', 'ProjectTask', 'Settlement', 'AuditIssue'];

export const readCoreTypes = () => {
  const src = fs.readFileSync(path.join(ROOT, 'types.ts'), 'utf8');
  const out = {};
  for (const name of CORE_TYPES) {
    const start = src.indexOf(`export interface ${name} {`);
    if (start < 0) { out[name] = ['(找不到这个类型)']; continue; }
    const body = src.slice(start, src.indexOf('\n}', start));
    const fields = [...body.matchAll(/^\s{2}(\w+)\??\s*:/gm)].map(m => m[1]);
    out[name] = [...new Set(fields)].sort();
  }
  return out;
};

export const currentContract = () => ({
  说明: '这份文件是自动生成的字段契约基线。改它之前先读 scripts/data-contract.mjs 顶上那段。',
  仓储字段映射: readRepoFields(),
  核心实体字段: readCoreTypes()
});

const main = () => {
  const contract = currentContract();
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(contract, null, 2) + '\n', 'utf8');
    console.log(`✅ 基线已更新：${path.relative(ROOT, BASELINE)}`);
    console.log('   ⚠️ 提交时请在提交信息里写清**为什么**要改字段契约 —— 这是给未来的人看的。');
    return;
  }
  console.log(JSON.stringify(contract, null, 2));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
