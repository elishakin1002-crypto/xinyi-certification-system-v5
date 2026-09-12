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

test('合同必须落到客户身上 —— 「不绑定」不能是默认值', () => {
  /*
    2026-09-12 金恩来：「合同和客户我发现也没有关联起来，就是我在创建合同时
    没有给到可以选择关联老客户或者创建新客户的选项。」

    下拉本来是有的，缺的是**建新客户的口子**；而第一项又是「不绑定」
    且是默认值 —— 最省事的路径就是不绑定。
    **生产上 12 份合同有 4 份没关联客户，整整三分之一。**

    代价不在合同这一页：客户 360 看不到这份合同、回款算不进这家的累计、
    「这家做过什么」永远缺一块。
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/<option value="">不绑定/.test(page),
    '「不绑定」又变回下拉的默认第一项了');
  assert.match(page, /<option value="">— 选一家客户 —<\/option>/, '默认项不是「选一家客户」');
  assert.match(page, /handleQuickCreateContractCustomer/, '合同弹窗里没有「直接新建客户」的口子');
  assert.match(page, /落到某一家客户身上/, '没选客户时不会拦一下');
});

test('合同里建客户不许自己写查重 —— 走 addCustomer 那个收口', () => {
  /*
    这是第三个建客户的入口（前两个：客户管理、建项目弹窗）。
    每多一个入口就多一次「在这里再写一遍规则」的机会，
    而那正是他建出 3 个「测试1」的原因。
  */
  const page = code('pages/Contracts.tsx');
  const at = page.indexOf('handleQuickCreateContractCustomer');
  const fn = page.slice(at, at + 900);
  assert.match(fn, /addCustomer\(/, '没走 addCustomer，可能自己实现了一套');
  assert.ok(!/customers\s*\.find\(\s*c\s*=>\s*c\.name\s*===/.test(fn), '又自己写了一套按名字查重');
  assert.match(fn, /created\.duplicated/, '没区分「新建了」和「复用了已有的」');
});

test('服务选择器要能选「公司用过但不在目录里」的那些', () => {
  /*
    他问：「目录里没有、需要加上的服务项目，是不是可以增加设置成模版的选项。」

    没有建「自定义目录」那套存储（要加表、迁移、同步，而且从此两份目录要维护）。
    改成把**已经录进合同的服务名**直接当候选：零基建，
    而且自带淘汰 —— 用得多就是「该写进标准目录」的信号。
  */
  const picker = code('components/ServicePicker.tsx');
  assert.match(picker, /usedNames/, '选择器没有接收「用过的服务名」');
  assert.match(picker, /公司用过（不在标准目录）/, '没有把用过的单独分组标出来');

  const page = code('pages/Contracts.tsx');
  assert.match(page, /usedServiceNames/, '合同页没有把历史服务名喂给选择器');
});

test('「客户名称」只在不绑定时出现 —— 平时它是选出来的结果，不是要填的字段', () => {
  /*
    2026-09-12 金恩来：「有关联客户又客户名称是不是重复了，或者有点设计过度了」。

    他说得对。customerName 在**每一条路径上都是自动填的**：
    选客户时填、当场新建时填、AI 从合同里读出来时填。
    摆成第二个输入框等于把同一件事问两遍，而且两边能填得不一样 ——
    改了名字 customerId 就被清空，合同又变回没关联，
    我们刚修好的问题会从这儿漏回来。

    成熟做法是一个查找框（Salesforce Account lookup）：选一家就完事。
    唯一真需要手填名字的时刻是「明确不绑定任何客户」——
    那时它是唯一的客户线索。
  */
  const page = code('pages/Contracts.tsx');
  assert.ok(!/<label[^>]*>客户名称<\/label>/.test(page),
    '「客户名称」又变回一个常驻的输入框了');
  assert.match(page, /formData\.customerId === '__none__' &&[\s\S]{0,400}?customerName/,
    '不绑定时没有给填名字的地方 —— 那份合同会认不出是谁的');
  assert.match(page, /选了「不绑定」就得写上客户名称/, '不绑定时没有校验名字');
});

test('AI 读到的客户名要摆出来对照，并且可操作', () => {
  /*
    去掉输入框不能把 AI 的结果一起丢掉。
    合同上的名字如果和选中的对不上，要摆出原话；没匹配上的，
    给一个「按这个名字建一家」的按钮 —— 让结果可操作，
    而不是塞进一个框里等人自己核对。
  */
  const page = code('pages/Contracts.tsx');
  assert.match(page, /合同上写的是：/, '没有把合同原文里的客户名摆出来');
  assert.match(page, /按这个名字建一家/, '没匹配上时没有给一键新建的口子');
});

test('弹窗里的上传区用 compact，别吃掉半屏', () => {
  /*
    他：「合同录入区域是不是搞的太大了，下面服务项目的下拉框
    常常受尺寸影响，显示不全。要拖到下面才能显示全！」

    大尺寸那版近 180px 高，在 max-h-[90vh] 的弹窗里吃掉小半屏。
    组件本来就有 compact 变体（一行按钮，实测 34px）——
    我差点又新写一个，幸好先看了一眼。
  */
  const page = code('pages/Contracts.tsx');
  const at = page.indexOf('<IngestionUploader');
  const block = page.slice(at, at + 500);
  assert.match(block, /\bcompact\b/, '合同弹窗里的上传区没用 compact');
});

test('服务下拉放不下就往上开，不许被滚动容器裁掉', () => {
  /*
    下拉是 absolute，而弹窗是 max-h-[90vh] + overflow-y-auto ——
    字段在偏下位置时，列表会被裁掉一半，人得先滚动才能看全，选完再滚回来。
    原生 select 和成熟组件库都是「下面不够就往上开」。
  */
  const picker = code('components/ServicePicker.tsx');
  assert.match(picker, /openUp/, '下拉没有判断方向');
  assert.match(picker, /bottom-full/, '没有往上开的那一档');
  assert.match(picker, /window\.innerHeight - r\.bottom/, '没有量下方剩余空间');
});
