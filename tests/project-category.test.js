// 项目分三类，分类决定「要不要有客户」。
//
// 2026-09-07 金恩来：「建立项目时一定要选择归属客户，那逻辑不就变成
// 要先建立客户再建立项目吗？」以及「政府要我们配合通知 2000 家企业
// 营业执照要年检，这个任务就没有办法选择归属客户」。
//
// 后一条更要紧：**这类活按原规则根本进不了系统**。
// 进不了系统不是少一条记录，是这件事的工时、进度、谁在做
// 全部回到微信群和个人脑子里 —— 而这恰恰是最该沉淀的那类事：
// 政府交办的事做好了，就是下一批线索。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('项目有三类，公共事务不要客户', () => {
  assert.match(read('types.ts'), /export type ProjectCategory = 'Delivery' \| 'FollowUp' \| 'Public';/,
    '没有「公共事务」这一类');
  assert.match(read('types.ts'), /export type ProjectMode = 'followup' \| 'delivery' \| 'public';/,
    'ProjectMode 没跟着加');

  const caps = read('src/utils/projectCapabilities.ts');
  assert.match(caps, /if \(project\.projectCategory === 'Public'\) return 'public';/,
    '公共事务没有映射到自己的模式');
  /*
    公共事务没有合同也没有客户 —— 服务项和回款这两块留着，
    只会让人对着空表单发愣。
  */
  assert.match(caps, /showFinancePanel: !isIntelOrigin && !isPublicProject/, '公共事务还显示回款面板');
  assert.match(caps, /showServicePanel: !isIntelOrigin && !isPublicProject/, '公共事务还显示服务项面板');
});

test('客户必填与否，由「给谁做」决定，不再看有没有合同', () => {
  /*
    2026-09-08 金恩来：「就算交付项目是指签合同后建的项目，
    但那些没有签合同就直接打款或者走流程的项目呢？有些项目小比如
    台账指导可能就没有签合同，或者有些项目是先执行，后补合同。」

    前两版把「有没有合同」当成分类依据，于是「有客户、收钱、没合同」
    这类活三个类别一个都装不下 —— 而它们是真实存在且不少的。
  */
  const src = read('pages/Projects.tsx');

  // 只看第一个问题的答案，不看合同
  assert.match(src, /if \(hasCustomer && !customerId\)/, '客户必填的判断没有改成看「给谁做」');
  assert.ok(!/projectCategory === 'Delivery' && !customerId/.test(src),
    '还在按旧的类别判断客户必填');

  // 拒绝时要告诉人下一步怎么办，而且要指向「当场新建」
  assert.match(src, /找不到？直接新建客户/, '没告诉人客户档案里没有时该怎么办');

  // 合同永远可选：不能有任何「必须先有合同」的拦截
  assert.match(src, /可以先空着，签了再来补/, '合同没有明确标成可选');
});

test('当场新建客户 —— 不用为了建项目先跑去客户管理', () => {
  /*
    金恩来：「那是不是意味着要建立项目先要创建客户，然后再去录入合同，
    最后再来创建项目？要建立一个项目准备工作有点多。」

    CRM 里这个问题的标准答案不是调流程顺序，是**在原地建**
    （Dynamics 叫 Quick Create）。为了建 A 必须先离开去建 B，
    那一步才是真正劝退人的地方。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /handleQuickCreateCustomer/, '没有当场新建客户的入口');
  assert.match(src, /创建并选中/, '新建完没有立刻选中 —— 那等于让人再去下拉里找一遍');

  // 只要名字就够；逼人填完整档案，结果是他干脆不建项目
  const fn = src.slice(src.indexOf('const handleQuickCreateCustomer'), src.indexOf('const handleCreate'));
  assert.match(fn, /const name = newCustomerName\.trim\(\)/, '新建客户要的不止一个名字');
  assert.match(fn, /customers\.find\(c => c\.name === name\)/, '同名客户会被重复创建');

  // addCustomer 必须把新建的那条返回出来，否则选不中
  assert.match(read('context/AppContext.tsx'), /addCustomer: \(customer: Omit<Customer, 'id'>\) => Customer;/,
    'addCustomer 没有返回新建的客户');
});

test('不让人选类别，类别由两个答案推出来', () => {
  /*
    多一个选项就多一次「我该选哪个」的犹豫。而「给谁做」「收不收钱」
    这两个问题他不用想 —— 答案本来就在他脑子里。
  */
  const meta = read('src/modules/projectCategory.ts');
  assert.match(meta, /export const deriveCategory/, '没有从两个答案推类别的函数');
  assert.match(meta, /label: '客户项目'/, '类别没有改成按「给谁做」命名');
  assert.match(meta, /label: '其他事务'/, '第三类的名字没改');
  assert.ok(!/label: '合同项目'/.test(meta), '「合同项目」这个把合同当前提的名字还在');

  const src = read('pages/Projects.tsx');
  assert.match(src, /这活给谁做？/, '表单里没有第一个问题');
  assert.match(src, /这活收不收钱？/, '表单里没有第二个问题');
  assert.match(src, /系统归为「/, '没有当场告诉人系统会把这活归成什么');
});

test('收不收钱是属性，不是类别', () => {
  /*
    PSA 类工具的通行做法：billable 是项目属性，合同是可选挂件，
    没有「合同项目 vs 非合同项目」这种分法。
  */
  assert.match(read('types.ts'), /billable\?: boolean;/, 'Project 上没有 billable 属性');

  const meta = read('src/modules/projectCategory.ts');
  assert.match(meta, /export const isBillable/, '没有统一的「算不算营收」判断');
  // 老数据没有这个字段，必须按原口径回推，否则历史报表数字会变
  assert.match(meta, /return p\.projectCategory === 'Delivery';/,
    '老数据没有回推规则 —— 加个字段就把历史报表改了数，比不加还糟');
});

test('售前跟进退出项目，但旧数据不删', () => {
  /*
    2026-09-08 金恩来：「把还在争取的客户去掉吧，这个放到项目里来不合理。」

    对的：线索管理本来就在管「还没成的客户」，两边各存一条谁都不准；
    而且在制项目数、延误率这些指标的分母会被污染。

    但线上已经有 15 个跟进项目、带着 11 条工时 —— 只出不进，不删。
    和账号那条规矩一样：能删错误，不能删历史。
  */
  const meta = read('src/modules/projectCategory.ts');
  assert.match(meta, /CREATABLE_CATEGORIES[^=]*=\s*\['Delivery', 'Public'\]/,
    '「售前跟进」还能被新建出来');
  assert.match(meta, /legacy: true/, 'FollowUp 没有标成停用的旧分类');

  // 筛选里那一档只在还有旧数据时出现，等收尾完自己消失
  assert.match(meta, /buildCategoryFilters/, '类别档位不是动态的');
  assert.match(read('pages/Projects.tsx'), /buildCategoryFilters\(projects\.some/,
    '没有按「库里还有没有旧跟进项目」决定要不要显示那一档');

  // 战略战役不涉及客户，本来就该是「其他事务」
  assert.match(read('pages/Strategy.tsx'), /projectCategory: 'Public'/,
    '战略战役还挂在售前跟进下面 —— 它压根没有客户');
});

test('列表上要看得出一个项目是哪一类', () => {
  /*
    2026-09-08 发现：getCategoryBadge 定义了**从来没被调用过**，
    也就是说列表上一直看不出项目的类别。
    分类的事反复讲不清，有一半原因是它压根没显示出来过。
  */
  const src = read('pages/Projects.tsx');
  const calls = (src.match(/getCategoryBadge\(/g) || []).length;
  assert.ok(calls >= 2,
    `类别徽章只出现 ${calls} 次 —— 定义了不用等于没做（电脑端表格和手机端卡片都要有）`);
  // 客户项目里既有收钱的也有不收钱的，光显示类别分不出哪些进营收
  assert.match(src, /\{earns \? '收费' : '不收费'\}/, '没有标出这一单收不收钱');
});

test('收钱却没合同要有人知道，但不能挡路', () => {
  const fin = read('pages/Finance.tsx');
  assert.match(fin, /个收费项目还没关联合同/, '财务页没有「缺合同」提醒');
  assert.match(fin, /这是提醒，不是错误/, '没说清它不是错误 —— 否则人会以为自己填错了');
});

test('建完之后，每一个筛选都要调到能看见它', () => {
  /*
    2026-09-07 第二次踩：第一次只调了「范围」和「状态」，**漏了「类别」**。
    金恩来建了三个跟进项目，而列表默认只看交付项目 ——
    三条全都好好地存在库里，他一条也没看见，
    得出「点了没反应」的结论，然后又建了两个。

    **这类 bug 会重复发生**：筛选是一个个加上去的，
    每加一个就多一条「新建的东西可能被它藏起来」的路径。
    所以这条测试盯的不是某一个筛选，是**全部**。
  */
  const src = read('pages/Projects.tsx');
  const fn = src.slice(src.indexOf('const handleCreate'), src.indexOf('const getWorkLogDraft'));

  // 页面上有几个会影响列表的筛选，建完就得处理几个
  const filters = [
    ['setViewScope', '与我相关 / 全公司'],
    ['setFilterStatus', '进行中 / 已完成 / 全部状态'],
    ['setModeScope', '客户项目 / 其他事务 / 全部类别'],
    ['setSearchTerm', '搜索框'],
  ];
  const missing = filters.filter(([fnName]) => !fn.includes(fnName)).map(([, label]) => label);
  assert.deepEqual(missing, [],
    `立项后没有重置这些筛选，新项目会被它们藏起来：${missing.join('、')}`);

  // 而且要说清为什么界面自己跳了
  assert.match(fn, /这样你才看得到它/, '切了筛选却不解释，界面自己跳一下同样莫名其妙');
});

test('页面上的列表筛选，全都要在立项后处理过', () => {
  /*
    上一条测的是「现在这四个」。这一条防的是**以后新增筛选却忘了处理** ——
    找出所有影响 filteredProjects 的 useState，逐个核对。
  */
  const src = read('pages/Projects.tsx');
  const declared = [...src.matchAll(/const \[(\w+), (set\w+)\] = useState/g)]
    .map((m) => ({ state: m[1], setter: m[2] }));

  // 哪些状态真的参与了列表过滤
  const filterMemo = src.slice(src.indexOf('const filteredProjects'), src.indexOf('const filteredProjects') + 1800);
  const used = declared.filter((d) => new RegExp(`\\b${d.state}\\b`).test(filterMemo));
  assert.ok(used.length >= 3, '没解析到参与过滤的状态，测试要跟着结构改');

  const createFn = src.slice(src.indexOf('const handleCreate'), src.indexOf('const getWorkLogDraft'));
  const forgotten = used.filter((d) => !createFn.includes(d.setter)).map((d) => d.state);
  assert.deepEqual(forgotten, [],
    `这些筛选参与列表过滤，但立项后没有重置 —— 新项目可能被藏起来：${forgotten.join('、')}`);
});

test('提醒就是提醒，不许顺手建项目', () => {
  /*
    2026-09-08 挖到的根子：addReminder 在 linkType 是 lead / customer 时，
    会**先去建一个「跟进项目」**，把提醒挂上去再存；建不成就 return，
    提醒被静默丢掉。

    线上 15 个跟进项目几乎全是这么冒出来的 —— 每条证书到期提醒
    自动变成一个项目，把在制项目数、延误率、日志覆盖率的分母全污染了。
    金恩来说的「还在争取的客户不该放进项目」，根子在这个函数，
    不在那几个按钮。

    而这个绕路从一开始就没必要：提醒模型本来就有 linkType lead/customer，
    铃铛也早就能跳 /leads 和 /customers。
  */
  const ctx = read('context/AppContext.tsx');
  const fn = ctx.slice(ctx.indexOf('const addReminder = (r: any)'), ctx.indexOf('const addReminder = (r: any)') + 2600);
  assert.ok(!/createFollowUpProjectFrom(Customer|Lead)/.test(fn),
    'addReminder 还在为了挂提醒去建项目');
  assert.match(fn, /rawLinkType === 'lead' \|\| rawLinkType === 'customer'/,
    '线索/客户的提醒没有直接存下来');
});

test('每 10 秒的系统扫描不许建项目、不许改线索状态', () => {
  /*
    2026-09-09：上一条只堵了 addReminder —— 那是**人点出来的**那条路。
    自动扫描 runSystemScans 里还有同样的两处，而且更险，因为没有人参与：

      · 线索：证书 ≤60 天 + 高意向 → createFollowUpProjectFromLead()，
        而那个函数里带一句 updateLead(id, Status.Converted)。
        也就是说线索会被系统自己标成「已转化」并永久锁死（函数里另有
        「已生成过项目就禁止重复使用」的硬锁），全程无人点击。
      · 客户：证书 ≤120 天 → createFollowUpProjectFromCustomer()，
        去重键用的是 contractRef 里的 `CUSTCERT:` 前缀 ——
        而 016_contractRef职责分离 早把这类前缀清空了，去重必然落空。

    这个扫描每 10 秒跑一次。它至今没爆，纯粹是因为库里 455 条线索
    一条都没填 targetCertExpiryDate、11 家客户一张证书到期日都没填。
    换句话说：**上线前补数据这个动作本身就会引爆它。**

    所以这条测试盯的是扫描函数体，而不是某个按钮。
  */
  const ctx = read('context/AppContext.tsx');
  const scan = ctx.slice(ctx.indexOf('const runSystemScans = ()'), ctx.indexOf('// 3. Finance Scanning'));
  assert.ok(scan.length > 500, '没截到 runSystemScans 的线索/客户扫描段，测试要跟着结构改');

  // 剥掉注释再查 —— 上面那段注释本身就在讲这个坑（坑 #26 的教训）
  const code = scan.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(!/createFollowUpProjectFrom/.test(code), '系统扫描又开始自动建跟进项目了');
  assert.ok(!/projectCategory:\s*'FollowUp'/.test(code), '系统扫描在生成人工建不出来的旧类别');
  assert.ok(!/setProjects|commitProjectTransaction/.test(code), '系统扫描不该动项目表');
  assert.ok(!/updateLead\s*\(/.test(code), '系统扫描不该改线索状态 —— 转化是人的判断');

  // 拆掉自动立项之后，提醒必须还在，否则等于把这个能力整个删了
  assert.match(code, /AUTO-LEAD-WARN-/, '线索证书到期提醒没了');
  assert.match(code, /AUTO-CUST-RENEW-/, '老客续期提醒没了');

  // 那两个函数要连定义一起删干净：留着一个「一调就出事」的函数就是给下个人埋雷
  assert.ok(!/const createFollowUpProjectFrom(Lead|Customer)\s*=/.test(ctx),
    '调用点删了但函数还留着 —— 下一个人会以为它能用');
});

test('线索和客户上的「跟进」不再建项目，改成排提醒', () => {
  ['pages/Leads.tsx', 'pages/Customers.tsx'].forEach((f) => {
    const src = read(f);
    assert.match(src, /scheduleRenewalFollowUp/, `${f} 没有改用排提醒`);
    assert.ok(!/createFollowUpProjectFrom/.test(src), `${f} 还在建跟进项目`);
    assert.match(src, /排跟进提醒/, `${f} 按钮文案还写着「生成跟进项目」`);
  });

  // 排不出来要说清为什么该去补什么，不能只是没反应
  assert.match(read('pages/Leads.tsx'), /排不了 —— \$\{r\.reason\}/, '排不出来时没有解释原因');
});

test('情报转出来的是「其他事务」，而且转线索的路不能断', () => {
  /*
    情报转出来的三个任务是「研判政策 / 匹配潜在客户 / 建立触达节奏」——
    这是内部要干的活，没有客户、不涉及钱，正好是其他事务，
    原来归到售前跟进是分错了。
  */
  const svc = read('server/services/convertSignal.js');
  assert.match(svc, /projectCategory: 'Public'/, '情报转出来的还是售前跟进');
  assert.match(svc, /projectMode: 'public'/, 'projectMode 没跟着改');

  /*
    改类别最容易漏的是连带：「转为线索」原来的开关是
    isIntelOrigin && isFollowUpProject，类别一改它就恒为 false，
    按钮直接消失、还不报错 —— 情报→线索这条链路会被悄悄弄断。
  */
  assert.match(read('pages/Projects.tsx'), /const isIntelFollowUpProject = projectCaps\.isIntelOrigin;/,
    '「转为线索」还挂在类别上 —— 改类别会把这条链路弄断');
});

test('下一任务排除已完成和已跳过的任务', () => {
  const ts = require('typescript');
  const src = read('pages/Projects.tsx');
  const openTask = src.match(/const isOpenTask = [^\n]+;/)[0];
  const nextTask = src.match(/const getNextTask = [\s\S]*?\n  };/)[0];
  const js = ts.transpileModule(`${openTask}\n${nextTask}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const pick = new Function(`${js}; return getNextTask;`)();
  const tasks = [
    { id: 'skip', status: 'Skipped', deadline: '2026-01-01' },
    { id: 'done', status: 'Completed', deadline: '2026-01-01' },
    { id: 'open', status: 'Pending', deadline: '2026-09-11' },
  ];
  assert.equal(pick({ tasks }).id, 'open');
  assert.equal(pick({ tasks: tasks.slice(0, 2) }), null);
  assert.equal(pick({ tasks: [] }), null);
});
