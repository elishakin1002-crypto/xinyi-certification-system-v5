/*
  flex 里的输入框必须能缩 —— 不然它旁边的按钮会被顶出容器。

  ══════════════════════════════════════════════════════════════
  这个坑这个项目已经犯了三次（2026-09-21）
  ══════════════════════════════════════════════════════════════

  金恩来截图：线索详情「跟进记录」那个纸飞机图标飞到容器外面去了。

  真因是 flex 的一条默认行为：**子项默认 `min-width: auto`，
  不会缩到自己内容宽度以下**。输入框写了 `flex-1`，它撑住内容宽度
  不让步，右边的话筒和发送按钮就被挤出容器边界。

  前两次：
    · components/Layout.tsx 顶部搜索框 —— 当时加了注释「min-w-0 是关键」
    · pages/Contracts.tsx 回款节点那一行

  **写注释没拦住第三次。** 注释只有改到那一行的人才会看见，
  而下一个人是在别的文件里写一个新的 flex 行。
  所以改成扫描（CLAUDE.md 二点五之四：要人记住的规矩，早晚有人记不住）。

  ── 只管输入类元素 ────────────────────────────────────────────

  `<input> / <select> / <textarea>` 才有"内容撑宽度"这个毛病，
  而且它们旁边通常就跟着按钮。别的元素加 flex-1 不加 min-w-0
  多数时候没问题，全禁会制造一堆假阳性，然后没人再信这条。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['pages', 'components', 'src'];

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
};

test('flex-1 的输入框都要有 min-w-0 —— 否则旁边的按钮会被顶出框外', () => {
  /*
    ── 按**元素**扫，不能按行扫（2026-09-21 的教训）──────────────

    第一版我按行匹配「同一行里既有 <input 又有 flex-1」。
    结果把 bug 放回去验的时候**它没红** —— 因为真实代码是这样写的：

        <input
          className="flex-1 text-sm ..."

    标签名和 className **不在同一行**。一个用来查溢出的检查，
    自己看不见最常见的写法。

    改成：找到开标签，往后取到 `>` 为止，在这一整段里找 className。
  */
  const bad = [];
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<(input|select|textarea)\b/g)) {
        const end = src.indexOf('>', m.index);
        if (end === -1) continue;
        const tag = src.slice(m.index, end + 1);
        const cls = tag.match(/className=["'`]([^"'`]*)["'`]/)
          || tag.match(/className=\{`([^`]*)`\}/);
        if (!cls || !/\bflex-1\b/.test(cls[1]) || /\bmin-w-0\b/.test(cls[1])) continue;
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`  ${path.relative(ROOT, file)}:${line}`);
      }
    }
  }

  assert.deepEqual(
    bad, [],
    '\n\n这些 flex-1 的输入框没有 min-w-0，旁边的按钮会被顶出容器：\n\n'
    + bad.join('\n')
    + '\n\nflex 子项默认 min-width:auto —— 撑住内容宽度不让步。\n'
    + '两条一起加：输入框 `min-w-0`（允许收缩）、按钮 `shrink-0`（不许被压扁）。\n'
  );
});
