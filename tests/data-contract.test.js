// 字段契约不许悄悄变 —— 改可以，但必须是**故意的**。
//
// ── 为什么（2026-09-18）────────────────────────────────────────
//
// 金恩来：「后面在用你继续写代码时，如何防止你又把不该改的字段
//   或者别的功能等等给改了，的预防措施也要做。」
//
// CI 已经很扎实（类型、测试、构建、密钥扫描、迁移检查、权限矩阵、E2E），
// 但**没有一道闸门盯着"字段本身"**。下面这几种改动，现有闸门全都放行：
//
//   · 把 projectAmount 改名成 amount ——
//     类型能过（两边一起改）、测试能过（测试也一起改），
//     但**线上库里的旧数据读不出来了**
//   · 删掉一个"没人引用"的字段 ——
//     编译零问题，而它可能是财务每月导出时唯一用得上的那一列
//   · 把 kind:'amount' 改成 'int' ——
//     金额的 ×100 ÷100 消失，8000 元变成 80 元，没有任何红字
//
// 共同点：**改动静默，代价是数据级的。**
// 这类问题没法靠"多写几条测试"防住，因为你事先不知道要防哪一个。
//
// 所以用 golden file：契约写进仓库，每次比对，不一致就红。
// 不是禁止改，是不许悄悄改 —— 改动会出现在 diff 里，会被看见。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(root, 'tests/fixtures/data-contract.json');

const current = () => JSON.parse(
  execFileSync('node', [path.join(root, 'scripts/data-contract.mjs')], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
);

const 差异 = (base, now) => {
  const 少了 = [], 多了 = [], 改了 = [];
  for (const [group, items] of Object.entries(base)) {
    const nowItems = now[group];
    if (!nowItems) { 少了.push(`整组不见了：${group}`); continue; }
    for (const item of items) if (!nowItems.includes(item)) 少了.push(`${group}：${item}`);
    for (const item of nowItems) if (!items.includes(item)) 多了.push(`${group}：${item}`);
  }
  for (const group of Object.keys(now)) if (!base[group]) 多了.push(`新增一组：${group}`);
  return { 少了, 多了, 改了 };
};

test('仓储字段映射和基线一致 —— 前端字段↔库表列这座桥不许悄悄动', () => {
  assert.ok(fs.existsSync(baselinePath), '基线文件不见了，跑 `node scripts/data-contract.mjs --write` 重建');
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const { 少了, 多了 } = 差异(base.仓储字段映射, current().仓储字段映射);

  assert.deepEqual(少了, [],
    '**基线里有、现在没有了** —— 这些字段被删掉或改名了：\n  ' + 少了.join('\n  ')
    + '\n\n线上库里已经有按旧名字存的数据。如果这是故意的：\n'
    + '  1. 先想清楚旧数据怎么办（要不要写迁移）\n'
    + '  2. 跑 `node scripts/data-contract.mjs --write`\n'
    + '  3. 在提交信息里写清为什么改 —— 这是给未来的人看的');

  assert.deepEqual(多了, [],
    '**新增了字段，但基线没更新** —— 这通常是好事，只是要留个记录：\n  ' + 多了.join('\n  ')
    + '\n\n跑 `node scripts/data-contract.mjs --write` 更新基线。');
});

test('核心实体的字段和基线一致 —— 页面全都按这个写', () => {
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const { 少了, 多了 } = 差异(base.核心实体字段, current().核心实体字段);

  assert.deepEqual(少了, [],
    '**核心实体少了字段** —— 改名或删除会让读旧数据的地方悄悄拿到 undefined：\n  '
    + 少了.join('\n  ') + '\n\n确认是故意的就跑 `node scripts/data-contract.mjs --write`。');
  assert.deepEqual(多了, [],
    '核心实体新增了字段，基线没更新：\n  ' + 多了.join('\n  ')
    + '\n\n跑 `node scripts/data-contract.mjs --write`。');
});

test('金额字段必须标 kind:amount —— 标错一位就差 100 倍', () => {
  /*
    库里金额存的是**分**，仓储层靠 kind:'amount' 自动 ×100 / ÷100。
    标成 'int' 的话 8000 元会变成 80 元，而且不报错。
    工时更要命：标成 amount 的话 0.5 小时会存成 50。
    （CLAUDE.md 第四条就是这个。）
  */
  const now = current().仓储字段映射;
  const 疑似金额 = [];
  for (const [file, rows] of Object.entries(now)) {
    for (const row of rows) {
      const [api, rest] = row.split(' → ');
      const kind = (rest.match(/\(([^)]+)\)/) || [])[1] || '';
      const 像钱 = /(amount|Amount|price|Price|cost|Cost|fee|Fee)$/.test(api);
      const 像工时 = /(hours|Hours)$/.test(api);
      if (像钱 && kind !== 'amount') 疑似金额.push(`${file}：${row} —— 名字像金额却不是 kind:'amount'`);
      if (像工时 && kind === 'amount') 疑似金额.push(`${file}：${row} —— 工时不能用 amount，0.5 小时会存成 50`);
    }
  }
  assert.deepEqual(疑似金额, [], 疑似金额.join('\n  '));
});
