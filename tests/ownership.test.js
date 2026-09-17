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
const { isUnownedName, isUnownedProject, isMyProject, isMyContract, UNOWNED_LABELS } = require(out);
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

    这条钉的是**行为**不是写法：2026-09-15 下午把归属收口进
    isMyProject 之后，原来那条钉 `isUnownedProject(` 字样的断言就红了 ——
    而行为一点没变。又是形状 D（钉写法不钉意图）。
  */
  const me = { id: 'U-1', name: '黄佳佳' };
  assert.equal(isMyProject({ manager: '待指派' }, me), true,
    '无主项目被藏起来了 —— 它会对全公司每个人都隐藏');
  assert.equal(isMyProject({ manager: '别人', ownerUserId: 'U-2' }, me), false,
    '别人的项目被算成我的了');
});

test('三个页面的「与我相关」必须是同一份判定', () => {
  /*
    2026-09-15 Codex 横扫发现同一个概念有**四份**实现：
      pages/Projects.tsx    ownerUserId ✓ 姓名 ✓ 服务项 ✓ 任务 ✓ 无主 ✓
      pages/Contracts.tsx   ownerUserId ✗ 姓名 ✓ 服务项 ✗ 任务 ✓ 无主 ✗
      pages/Dashboard.tsx   ownerUserId ✗ 姓名 ✓ 服务项 ✗ 任务 ✓ 无主 ✗
      pages/Contracts.tsx 里另有一份更窄的（合同有 owner 就只比姓名）
    后果：同一个项目在项目管理里是「我的」，在工作台里不是，且不报错。

    守的是「不许再各写各的」：三处都必须引共享模块，
    而且不许自己再写 `manager === currentUser.name` 这种判定。
  */
  const SURFACES = [
    ['pages/Projects.tsx', '项目管理'],
    ['pages/Contracts.tsx', '合同管理'],
    ['pages/Dashboard.tsx', '工作台'],
  ];
  for (const [f, label] of SURFACES) {
    const src = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
    assert.match(src, /from '\.\.\/src\/modules\/ownership'/,
      `${label}（${f}）没有引 ownership.ts —— 多半又自己写了一份归属判定`);
    assert.ok(!/\.manager === currentUser\.name/.test(src),
      `${label} 里还留着 \`manager === currentUser.name\` —— 这就是漏掉 ownerUserId 和服务项负责人的那种写法`);
  }
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

test('「与我相关」必须承认它混着无人认领的项目 —— 不许只列三条判据', () => {
  /*
    2026-09-17 Codex 交叉复核指出：总经理/系统管理员/总助/销售/财务
    五个跟那个项目毫无关系的角色，打开「与我相关」都看到它，
    卡片也把它算进「进行中项目 1」。

    兜底本身是对的（无主项目藏起来会安静烂掉，就是嘉力那次），
    错的是那句提示 —— 它把判据完整列了三条、独独漏了第四条，
    于是它是一句**可以被界面当场证伪的话**。

    这条测试盯两件事：
      1. 提示文案必须提到「还没人认领」
      2. 列表里必须有那条说破它的提示，且只在「与我相关」下出现
    —— 只改文案不加提示，人还是会以为系统算错了。
  */
  const filters = stripComments(fs.readFileSync(path.join(root, 'src/modules/projectCategory.ts'), 'utf8'));
  const related = filters.split('\n').find(l => l.includes("value: 'related'")) || '';
  assert.match(related, /认领/,
    '「与我相关」的说明没提无人认领的项目，而界面里确实会出现 —— 这句话可以被当场证伪');

  const page = stripComments(fs.readFileSync(path.join(root, 'pages/Projects.tsx'), 'utf8'));
  assert.match(page, /unclaimedInView/,
    '项目管理页没有统计「这一屏里有几个没人认领」');
  assert.match(page, /viewScope === 'related' && unclaimedInView > 0/,
    '那条提示要么没挂条件，要么条件不对 —— 全公司视角下再提示一遍是噪音');
});

test('总助的「待指派负责人」必须数得到「待指派」 —— 这张卡就是为它存在的', () => {
  /*
    2026-09-17 交叉复核时读到：总助工作台「待指派负责人 0」，
    而库里躺着一个负责人是「待指派」的项目。

    真因：dashboardMetrics 里写的是
        activeProjects.filter(p => !String(p.manager || '').trim())
    只认**空字符串**。于是**这张专门用来发现"没人认领的项目"的卡片，
    恰恰看不见没人认领的项目** —— 嘉力那个项目（manager='待指派'）
    在这张卡上永远是 0。
    而新手引导还在教总助「『待指派负责人』不为零，先处理这个」。

    2026-09-15 已经为这件事收口出 isUnownedProject，这个文件漏掉了。
    所以盯的是「有没有走那份收口」，不是盯某一句写法。
  */
  const src = stripComments(fs.readFileSync(path.join(root, 'services/dashboardMetrics.ts'), 'utf8'));
  assert.match(src, /from '\.\.\/src\/modules\/ownership'/,
    'dashboardMetrics 没引 ownership.ts —— 多半又自己判了一遍空');
  assert.ok(!/!String\(p\.manager \|\| ''\)\.trim\(\)/.test(src),
    "dashboardMetrics 里还留着 `!String(p.manager||'').trim()` —— 它只认空字符串，认不出「待指派」");
  assert.match(src, /unassigned = activeProjects\.filter\(p => isUnownedProject/,
    '「待指派负责人」那张卡没有走 isUnownedProject');
});

test('占位词不是员工 —— 「人均」和「有活在手的人」不许把「待指派」算进去', () => {
  /*
    2026-09-17 Codex 交叉复核：
      总助工作台「各负责人进行中项目」把「待指派」列成一个人
      「有活在手的人 3」，真人只有 2 个
      总经理工作台「人均进行中项目 3.00」＝ 9 ÷ 3（把占位词算作一人）
      真实承载量是 8 个已认领项目 ÷ 2 人 = 4.00

    它的原话：「标题写『人均』，不应默默把占位词当员工。」
    后果是总助据此判断谁该加活谁该减活 —— 多出来的那个"人"
    会让她**低估每个人的实际承载**。

    原来两处都只挡空字符串（`.filter(Boolean)` / `if (!owner) return`），
    还是嘉力那次的同款判空。盯的是"有没有走 ownership.ts 那份收口"。
  */
  const src = stripComments(fs.readFileSync(path.join(root, 'services/dashboardMetrics.ts'), 'utf8'));

  assert.match(src, /isUnownedName/,
    'dashboardMetrics 没用 isUnownedName —— 占位词会被当成员工名');

  // 分母：真人
  assert.match(src, /owners = Array\.from\(new Set\(\s*claimedProjects/,
    '「人均」的分母还在从全部进行中项目里取名字，占位词会混进来');
  // 分子：已认领的项目
  assert.match(src, /avgInProgress = owners\.length > 0 \? claimedProjects\.length/,
    '「人均」的分子还是全部进行中项目 —— 没人认领的不该摊到真人头上');
  // 负责人分布
  assert.match(src, /if \(!owner \|\| isUnownedName\(owner\)\) return;/,
    '「谁手上活多少」还会把「待指派」列成一行');
});
