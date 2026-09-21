/*
  一个意思只能有一个颜色。

  ══════════════════════════════════════════════════════════════
  为什么需要它（2026-09-21）
  ══════════════════════════════════════════════════════════════

  金恩来：「系统中有很多颜色，不同的颜色代表不同的意思，问题是用在
    不同的页面、功能、板块、数据上面的时候有统一过标准规范没有？」

  没有。色板（src/ui 的 8 个 tone）早就有，但从来没写过
  **什么时候用哪个** —— 于是同一件事在不同页面是不同颜色。

  扫出来更糟：**13 个色系在用，而色板只定义了 8 个**，多的全是同义重复：
      成功  emerald 147 处 + green  110 处
      中性  gray   2286 处 + slate   91 处
      警示  amber   333 处 + yellow  23 处
      危险  red     263 处 + rose     7 处

  同一个意思两套颜色没有任何好处 —— 只会让人以为"这两个不一样"。

  ── 棘轮，不是一刀切 ──────────────────────────────────────────

  和 design-system.test.js 同一个道理：几百处存量一次性全禁，
  测试立刻红，然后被人加跳过从此失效。所以基线只许降不许升。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'fixtures', 'color-semantics-baseline.json');
const DIRS = ['pages', 'components'];

/** 和 src/ui/index.tsx 的 BANNED_COLOR_FAMILIES 对应 —— 改那边记得改这边 */
const BANNED = {
  green: 'emerald', slate: 'gray', yellow: 'amber', rose: 'red', cyan: 'blue',
  teal: 'emerald', sky: 'blue', violet: 'purple', fuchsia: 'purple',
  pink: 'purple', lime: 'emerald', zinc: 'gray', neutral: 'gray', stone: 'gray'
};

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
};

/* 注释里出现色名是正常的（讲为什么换掉它），抹白而不是删行，保住行号 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i) + ' '.repeat(l.length - i);
    })
    .join('\n');

const count = () => {
  const res = {};
  for (const fam of Object.keys(BANNED)) res[fam] = 0;
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const fam of Object.keys(BANNED)) {
        const re = new RegExp(`\\b(?:bg|text|border|ring|from|to|via|divide)-${fam}-\\d{2,3}\\b`, 'g');
        res[fam] += (src.match(re) || []).length;
      }
    }
  }
  return res;
};

test('同义色系不许再变多 —— 一个意思一个颜色', () => {
  const now = count();
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const grew = [];
  for (const [fam, replacement] of Object.entries(BANNED)) {
    const before = base[fam] ?? 0;
    if (now[fam] > before) {
      grew.push(`  · ${fam}：${before} → ${now[fam]}（多了 ${now[fam] - before} 处）→ 改用 ${replacement}`);
    }
  }
  assert.deepEqual(
    grew, [],
    '\n\n又用了同义色系：\n\n' + grew.join('\n')
    + '\n\n每个色都已经有对应的 tone 了（见 src/ui/index.tsx 的 TONE_MEANING）。\n'
    + '同一个意思两套颜色，只会让人以为"这两个不一样"。\n'
    + '要表达新的意思，先在 Tone 里加一个并写明含义，不要在页面里挑个没人用过的色系。\n'
    + '（棘轮：只许降不许升。还清了跑 node scripts/color-semantics-baseline.mjs）\n'
  );
});

test('色板里每个 tone 都要写明什么时候用', () => {
  /*
    只有颜色没有含义，等于没有规范 —— 下一个人照样按感觉挑。
  */
  const ui = fs.readFileSync(path.join(ROOT, 'src/ui/index.tsx'), 'utf8');
  assert.match(ui, /TONE_MEANING/, 'src/ui 里应当有 TONE_MEANING');
  for (const tone of ['red', 'amber', 'emerald', 'blue', 'indigo', 'purple', 'orange', 'gray']) {
    // 参数顺序是 (实际字符串, 正则) —— 第一版我写反了，测试自己报 TypeError
    assert.match(ui.slice(ui.indexOf('TONE_MEANING')), new RegExp(`${tone}:\\s*'[^']{6,}'`),
      `TONE_MEANING 里 ${tone} 没有写含义`);
  }
  // 红色的含义必须写清"已经出事"——这是最容易被滥用的一个
  const meaning = ui.slice(ui.indexOf('TONE_MEANING'), ui.indexOf('TONE_MEANING') + 800);
  assert.match(meaning, /red:\s*'[^']*出事/, '红色的含义要写明"已经出事"，否则什么都会被标红');
});
