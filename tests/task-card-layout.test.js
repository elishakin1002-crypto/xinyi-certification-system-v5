// 任务卡片底部那一行，在笔记本宽度下不许把内容压变形。
//
// 2026-09-12 金恩来：「项目管理下面的任务列表在全屏显示下有BUG，排版和显示都有问题」
//
// 实测 1400 / 1500 / 1600 三个常见笔记本宽度：「核心」这个类别徽标
// 被压成 21×44 —— 一个字一行竖着叠，和旁边的下拉框糊在一起。
// **2000 宽反而是正常的**，所以我第一次按 2000 去验，一点问题都没验出来，
// 差点回他一句「没复现」。
//
// 真因：这一行里日期 + 两个 140px 下拉框 + 徽标抢宽度，加起来超过卡片内宽，
// 而徽标是唯一没设 shrink-0 的，于是全由它让位。
//
// 真实排版由 .artifacts/check-task-card-layout.cjs 开浏览器量（那才是权威）。
// 这里守的是三个容易在后续改动中被顺手删掉的 class。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const src = fs.readFileSync(path.resolve(__dirname, '../pages/Projects.tsx'), 'utf8');

test('类别徽标永远不许被压缩 —— 它是这一行里唯一会让位的东西', () => {
  const badges = src.match(/className=\{`[^`]*uppercase tracking-tighter[^`]*\$\{/g) || [];
  assert.ok(badges.length >= 3, `没找到几个类别徽标（找到 ${badges.length} 个），选择器过时了？`);
  const bad = badges.filter(b => !/shrink-0/.test(b) || !/whitespace-nowrap/.test(b));
  assert.deepEqual(bad, [], '这些类别徽标没设 shrink-0 / whitespace-nowrap，会被挤成一个字一行');
});

test('下拉框要能缩 —— 只设 max-w 没有下限，它们不肯让位', () => {
  /*
    max-w-[140px] 只管上限。flex 里元素默认 min-width:auto，
    下拉框宁可撑着也不缩，于是把压力全推给最后那个徽标。
  */
  const sels = src.match(/className="[^"]*max-w-\[140px\][^"]*"/g) || [];
  assert.ok(sels.length >= 4, `没找到几个 140px 的下拉框（找到 ${sels.length} 个）`);
  const bad = sels.filter(s => !/min-w-0/.test(s));
  assert.deepEqual(bad, [], '这些下拉框没设 min-w-0，在窄卡片里不会让位');
});

test('放不下就换行，不许挤变形', () => {
  /*
    前两条是「谁该让位」，这条是兜底：三样东西加起来真的超过卡片宽时，
    正确做法是换一行，而不是把某个元素压到变形。
  */
  const rows = src.match(/<div className="flex flex-wrap justify-between items-center gap-y-2">/g) || [];
  assert.ok(rows.length >= 2,
    `任务卡片底部那一行应该是可换行的（按服务分组 + 平铺全部两处），实际只找到 ${rows.length} 处`);
});
