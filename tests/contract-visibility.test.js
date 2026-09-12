// 合同可见性：谁看得到合同、谁看得到金额，是两件事。
//
// 2026-09-12 金恩来：「我登录的是黄佳佳的账号……提示合同已经存在……
// 是不是因为之前是用管理员的账号录入的，所以黄佳佳的账号看不到。
// 他们若是都想当然自己录入也遇到了同样的问题是要去问其他人有没有录入吗？」
//
// 撞到的是一个自相矛盾：
//   · constants.ts 里四个角色的 readScope 全是 'ALL'
//     （权限模型说「合同都能看，只有金额分级」）
//   · 合同页自己又硬写了一条「顾问只能看自己的」，把模型盖掉了
//
// 后果：查重扫的是全量 → 查得到；列表被过滤 → 找不到。
// 页面里甚至早就写了「滚动到那一份」的代码，只是被筛选挡着，静默失败。
// 人只能去群里问「这份是不是你录过了」—— 而合同就在他自己邮箱里。
//
// 真实行为由 .artifacts/check-contract-visibility.cjs 开浏览器验
// （顾问：与我相关 1 行 → 全公司 11 行，金额仍是 ¥ ***；财务看到真金额）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** 扫源码一律先去注释 —— 注释里写着 bug 的名字，会误伤也会误放 */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('四个角色的 readScope 都是 ALL —— 这是模型说的话', () => {
  /*
    如果哪天有人把某个角色改成 OWN，那这一页的过滤就该跟着改。
    钉住它，是为了让「模型」和「页面」只有一个真相。
  */
  const src = code('constants.ts');
  for (const role of ['CONSULTANT', 'SALES', 'FINANCE', 'ADMIN']) {
    const m = new RegExp(`\\n  ${role}: \\{([\\s\\S]*?)\\n  \\},`).exec(src);
    assert.ok(m, `找不到角色 ${role}`);
    assert.match(m[1], /readScope: 'ALL'/, `${role} 的 readScope 不再是 ALL —— 合同页的过滤要跟着改`);
  }
});

test('合同页不许再按角色硬写可见性', () => {
  /*
    过滤应该按「范围开关」（与我相关/全公司），那是筛选；
    按 activeRole 硬判，那是权限 —— 权限不归页面管。
  */
  const src = code('pages/Contracts.tsx');
  assert.ok(!/activeRole === 'CONSULTANT'[\s\S]{0,200}?return false/.test(src),
    '合同页又按角色硬写了一条可见性规则，会盖掉 readScope');
  assert.match(src, /contractScope === 'related'/,
    '没有按「范围」筛选 —— 顾问要么看不到，要么一屏噪音');
});

test('顾问依然看不到金额 —— 放开的是「存在」，不是「价格」', () => {
  /*
    这条是放开可见性的前提。顾问那行注释写得很清楚：
    刻意不给 CONTRACT_VIEW_AMOUNT，避免与客户议价、同事间比价。
    放开列表的同时如果把金额也放出去，就是把一个权限设计拆掉了。
  */
  const c = code('constants.ts');
  const m = /\n  CONSULTANT: \{([\s\S]*?)\n  \},/.exec(c);
  assert.ok(!/CONTRACT_VIEW_AMOUNT/.test(m[1]), '顾问被给了看金额的权限');

  const page = code('pages/Contracts.tsx');
  assert.match(page, /canSeeContractAmount \? .* : '¥ \*\*\*'/, '金额遮罩没了');
});

test('撞上重复时要说清是谁录的，并把筛选调到看得见它', () => {
  /*
    原来只说一句「合同已存在」，而那一份多半不在他的列表里 ——
    等于告诉他「有这个东西，但你找不到，也不知道问谁」。
  */
  const ctx = code('context/AppContext.tsx');
  assert.match(ctx, /这份合同已经录过了/, '重复提示没有改写');
  assert.match(ctx, /录入人：/, '重复提示没说是谁录的');

  const page = code('pages/Contracts.tsx');
  const at = page.indexOf('result.existingContractId');
  const block = page.slice(at, at + 600);
  assert.match(block, /setContractScope\('all'\)/, '撞重复后没把范围切到全公司 —— 滚过去也看不见');
  assert.match(block, /setFilterStatus\('all'\)/, '状态筛选没放开，归档的那份仍会被挡住');
});
