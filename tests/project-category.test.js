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

test('客户必填与否，由类别决定', () => {
  /*
    原来一律必填，逻辑上是倒的：变成「必须先建客户，才能建项目」，
    而现实里往往是先有事、后有客户。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /if \(formData\.projectCategory === 'Delivery' && !customerId\)/,
    '还是一律必填');
  assert.match(src, /把类别改成「跟进项目」/,
    '拒绝时没告诉人该怎么办 —— 只说不行等于把人堵死');

  // 公共事务连这一栏都不显示：摆一个填不了的必填框只会让人卡住
  assert.match(src, /\{formData\.projectCategory !== 'Public' && \(/,
    '公共事务还显示归属客户');
  assert.match(src, /required=\{formData\.projectCategory === 'Delivery'\}/,
    '跟进项目的客户还是必填');
});

test('三类都要在界面上说清楚各自什么时候用', () => {
  /*
    多一个选项就多一次「我该选哪个」的犹豫。
    分类的名字解决不了这个问题，得直说什么时候用哪个。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /公共事务/, '界面上没有第三个选项');
  assert.match(src, /政府交办、行业活动、内部建设这类不属于任何客户的活/,
    '没说清公共事务什么时候用');
  assert.match(src, /客户还没谈成时用这个/, '没说清跟进项目什么时候用');
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
    ['setModeScope', '交付项目 / 跟进项目 / 两者都看'],
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
