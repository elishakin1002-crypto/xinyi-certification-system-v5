/*
  手机上能做的事，不许比桌面少。

  ══════════════════════════════════════════════════════════════
  为什么需要它（2026-09-20）
  ══════════════════════════════════════════════════════════════

  金恩来：「手机尺寸下，合同管理中合同详情的在线阅览、已收款报备选项
    都不见了，这几个选项在手机尺寸下还是很实用的……这类 BUG 系统里
    应该还有不少，为什么你之前大检查的时候没有检查出来？」

  **因为那种检查方式从原理上就覆盖不到。** 这个项目有 10 个文件用
  `hidden md:block` / `md:hidden` 渲染**两套完全独立的界面**。
  我之前那次「按钮清点」跑在桌面宽度下，手机分支里有什么、少什么，
  它一个都看不见。不是漏了一两个，是漏了一半的界面。

  扫出来 15 处（2026-09-20）：
    合同：预览、归档、立项、跳转项目、挑附件 —— 手机上全没有
    工作台头部：全局搜索、问题反馈 —— 手机上全没有
    审计：提取经验、打开知识文档 —— 手机上没有
    财务：结算回退 —— 手机上没有

  ── 这道闸门的边界 ────────────────────────────────────────────

  它是**静态扫描**，比的是 onClick 里调了哪个函数。
  抓不到「点了没反应」那一类（合同的手机卡片就是：onClick 调了
  toggleExpand，但展开后要显示的内容只在桌面表格里渲染）。
  那一类归 e2e/layout-smoke.spec.ts 在 375px 下真的点。
  两种手段各管一段，缺一不可。

  ── 为什么是棘轮 ──────────────────────────────────────────────

  和 tests/design-system.test.js 同一个道理：15 处历史差异一次性全禁，
  测试立刻变红，然后被人加个跳过从此失效。
  所以基线只许降不许升 —— 新写的功能必须两边都有。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'fixtures', 'mobile-parity-baseline.json');

/**
 * 有些动作**本来就该只有一边有**，不算差异。
 * 加进这张表的时候必须写清为什么 —— 不写理由的豁免，下一个人无法判断该不该删。
 */
const ALLOWED_ONE_SIDED = {
  setIsSidebarOpen: '汉堡菜单只在手机上存在，桌面侧边栏常驻',
  setIsMobileSearchOpen: '手机搜索是收起/展开的，桌面搜索框常驻，不需要这个开关',
  handleOpenScopeResult: '桌面搜索有"按模块分组"的结果面板；手机屏幕放不下，直接跳到最匹配的模块 —— 结果一样，少一步'
};

/*
  分析逻辑在 scripts/lib/mobileParity.mjs（ESM）。
  测试是 CJS，所以用子进程跑一次拿 JSON —— 比把逻辑抄一遍强，
  抄两份早晚会分叉（这个项目在"种类表两处定义"上刚栽过）。
*/
const scan = () => {
  const out = execFileSync('node', ['--input-type=module', '-e', `
    import fs from 'node:fs'; import path from 'node:path';
    const { parityOf } = await import('${path.join(ROOT, 'scripts/lib/mobileParity.mjs')}');
    const walk = d => fs.readdirSync(d,{withFileTypes:true}).flatMap(e =>
      e.isDirectory() ? walk(path.join(d,e.name)) : (/\\.tsx$/.test(e.name) ? [path.join(d,e.name)] : []));
    const files = [...walk('pages'), ...walk('components')].filter(f => {
      const s = fs.readFileSync(f,'utf8');
      return /hidden\\s+(md|lg):/.test(s) && /(md|lg):hidden/.test(s);
    });
    const res = {};
    for (const f of files) {
      const r = parityOf(f);
      if (r.desktopOnly.length || r.mobileOnly.length) {
        res[f] = { desktopOnly: r.desktopOnly, mobileOnly: r.mobileOnly };
      }
    }
    process.stdout.write(JSON.stringify(res));
  `], { cwd: ROOT, encoding: 'utf8' });
  const raw = JSON.parse(out);
  // 去掉合法的单边动作
  for (const file of Object.keys(raw)) {
    raw[file].desktopOnly = raw[file].desktopOnly.filter((a) => !ALLOWED_ONE_SIDED[a]);
    raw[file].mobileOnly = raw[file].mobileOnly.filter((a) => !ALLOWED_ONE_SIDED[a]);
    if (!raw[file].desktopOnly.length && !raw[file].mobileOnly.length) delete raw[file];
  }
  return raw;
};

const countOf = (res) =>
  Object.values(res).reduce((n, v) => n + v.desktopOnly.length + v.mobileOnly.length, 0);

test('手机和桌面的功能差异不许变多', () => {
  const now = scan();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  const nowCount = countOf(now);
  if (nowCount <= baseline.total) return;

  // 变多了 —— 把新增的那几条精确指出来，而不是只报一个数字
  const added = [];
  for (const [file, v] of Object.entries(now)) {
    const was = baseline.byFile[file] || { desktopOnly: [], mobileOnly: [] };
    for (const a of v.desktopOnly) if (!was.desktopOnly.includes(a)) added.push(`  · ${file}：「${a}」只有桌面能做，手机上没有`);
    for (const a of v.mobileOnly) if (!was.mobileOnly.includes(a)) added.push(`  · ${file}：「${a}」只有手机能做，桌面上没有`);
  }

  assert.fail(
    `\n\n手机和桌面的功能又不一致了（${baseline.total} → ${nowCount}）：\n\n${added.join('\n')}\n\n`
    + '这个项目用 `hidden md:block` / `md:hidden` 渲染两套独立界面，\n'
    + '**加功能时两边都要加**，不然手机上的同事就是做不了这件事。\n'
    + '确实该只有一边有的，写进 ALLOWED_ONE_SIDED 并说明理由。\n'
    + '（这是棘轮：数字只许降不许升。还清了旧账跑 '
    + 'node scripts/mobile-parity-baseline.mjs 把基线调下去。）\n'
  );
});

test('基线里记的差异还在，不许悄悄调高', () => {
  const now = scan();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.ok(
    baseline.total - countOf(now) <= 3,
    `基线（${baseline.total}）比实际（${countOf(now)}）高出太多 —— `
    + '基线是用来收紧的，不是用来预留额度的。跑 node scripts/mobile-parity-baseline.mjs 重新生成。'
  );
});
