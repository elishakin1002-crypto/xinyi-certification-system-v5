// 不许再产出「无主项目」—— 无主 = 对每个人都隐藏。
//
// 2026-09-15 金恩来用「合同识别」一次建了合同 + 客户 + 项目，然后看到：
//     合同管理 · 与我相关   有「浙江嘉力生物技术开发有限公司」
//     项目管理 · 与我相关   没有
// 他：「合同管理与我有关的包括"嘉力"而项目管理中与我有关的不包括"嘉力"怎么回事？」
//
// 真因：项目建出来了（两处存储都有），但
//     contract.owner  = '黄佳佳'   ← 建合同写了操作人
//     project.manager = '待指派'   ← 建项目写死了这个词，ownerUserId 也是空
// 「与我相关」的四条判据一条都不成立 → 全公司每个人都看不到它，
// 包括刚刚亲手建它的人。
//
// 原来那道防线是 `if (!p.manager || p.manager === '待定') return null;`——
// 只挡了 '待定' 一个词。这是 CLAUDE.md 二点五第 1 条的形状：
// **判空写成枚举几个已知的词**，别人换个说法就漏，而且不报错。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `ownership-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/modules/ownership.ts'),
  '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`
], { stdio: 'pipe' });
const { isUnownedName, isUnownedProject, UNOWNED_LABELS } = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch { /* 已经没了 */ } });

const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

test('「待指派」必须被认成没有负责人 —— 这就是漏过去的那个词', () => {
  assert.equal(isUnownedName('待指派'), true, '正是它让嘉力那个项目变成无主的');
  assert.equal(isUnownedName('待定'), true);
  assert.equal(isUnownedName(''), true);
  assert.equal(isUnownedName('   '), true, '空白字符也要当没填');
  assert.equal(isUnownedName(undefined), true);
  assert.equal(isUnownedName('黄佳佳'), false, '真名字被当成无主就全反了');
});

test('有 ownerUserId 就不算无主，哪怕名字是占位词', () => {
  // 名字可能被改、可能重名，ID 才是权威的那一份
  assert.equal(isUnownedProject({ manager: '待指派', ownerUserId: 'U-123' }), false);
  assert.equal(isUnownedProject({ manager: '黄佳佳', ownerUserId: '' }), false);
  assert.equal(isUnownedProject({ manager: '待指派', ownerUserId: '' }), true,
    '嘉力那条数据就长这样');
  assert.equal(isUnownedProject({ manager: '待指派' }), true);
});

test('建项目的兜底不许再按"枚举几个词"写 —— 必须走 ownership.ts', () => {
  /*
    守的是形状不是写法：只要 AppContext 里再出现一句自己判 '待定'/'待指派'
    的代码，就说明又开了一个平行实现，下次换个词照样漏。
  */
  const src = stripComments(fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8'));
  assert.match(src, /from '\.\.\/src\/modules\/ownership'/,
    'AppContext 没有引 ownership.ts —— 多半又自己写了一遍判空');
  assert.ok(!/p\.manager === '待定'/.test(src),
    "AppContext 里还留着 `p.manager === '待定'` —— 这正是漏掉 '待指派' 的那行");
});

test('合同识别建项目时必须带负责人，不许写死占位词', () => {
  /*
    钉的是那条具体的路径：addContract(createProject=true)。
    它是自动的，没有人可以问，所以只能跟着合同的归属人走 ——
    「谁做的」这条链不能有一段是空的（CLAUDE.md 第 1 条）。
  */
  const src = fs.readFileSync(path.join(root, 'context/AppContext.tsx'), 'utf8');
  const block = src.slice(src.indexOf('if (createProject)'));
  const head = block.slice(0, 1600);
  assert.ok(!/manager: '待指派'/.test(head),
    "合同识别又把 manager 写死成 '待指派' 了 —— 建出来的项目谁都看不见");
  assert.match(head, /manager: newContract\.owner/,
    '合同识别建项目时没有把合同的归属人带过去');
  assert.match(head, /ownerUserId:/,
    '只有名字没有 ID：改名或重名时归属会当场失效，而且不报错');
});

test('无主项目不许被「与我相关」藏起来 —— 那是要人认领的异常', () => {
  /*
    第二道防线。口子已经在 AppContext 堵了，但生产库里可能还有
    历史无主项目。藏起来的后果是一个没人做的项目安安静静地烂掉。
  */
  const src = stripComments(fs.readFileSync(path.join(root, 'pages/Projects.tsx'), 'utf8'));
  assert.match(src, /from '\.\.\/src\/modules\/ownership'/,
    '项目管理没有引 ownership.ts');
  const mine = src.slice(src.indexOf('const isMineProject'));
  assert.match(mine.slice(0, 900), /isUnownedProject\(/,
    'isMineProject 没有放行无主项目 —— 它会对全公司每个人都隐藏');
});

test('「无主」的说法只能在一个地方加', () => {
  // 防的是另一头：以后有人在别处又写一份同义词列表
  assert.ok(UNOWNED_LABELS.includes('待指派') && UNOWNED_LABELS.includes('待定'),
    '同义词表里少了已知的说法');
  const offenders = [];
  const walk = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      if (fs.statSync(p).isDirectory()) { walk(path.join(dir, name)); continue; }
      if (!/\.(tsx|ts)$/.test(name) || /\.d\.ts$/.test(name)) continue;
      if (p.endsWith('ownership.ts')) continue;
      const src = stripComments(fs.readFileSync(p, 'utf8'));
      // 自己拼一张「待指派/待定」的判空表 = 又一个会漏的平行实现
      if (/\[\s*'待定'\s*,\s*'待指派'|'待指派'\s*,\s*'待定'/.test(src)) {
        offenders.push(path.join(dir, name));
      }
    }
  };
  ['pages', 'components', 'services', 'context', 'src/modules', 'src/utils'].forEach(walk);
  assert.deepEqual(offenders, [],
    '这些文件自己又列了一份"无主"同义词表：\n  ' + offenders.join('\n  ')
    + '\n  请改成引 src/modules/ownership.ts —— 加词只加那一处。');
});
