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
  assert.match(src, /把类别改成「\$\{PROJECT_CATEGORY_META\.FollowUp\.label\}」/,
    '拒绝时没告诉人该怎么办 —— 只说不行等于把人堵死');

  // 公共事务连这一栏都不显示：摆一个填不了的必填框只会让人卡住
  assert.match(src, /\{formData\.projectCategory !== 'Public' && \(/,
    '公共事务还显示归属客户');
  assert.match(src, /required=\{formData\.projectCategory === 'Delivery'\}/,
    '跟进项目的客户还是必填');
});

test('三类都要在界面上说清楚「什么时候建」和「钱怎么算」', () => {
  /*
    2026-09-07 金恩来：「名字完全无法 get 到『什么时候建』以及『钱』
    这两者内容，我基本都看误解了。」

    「交付项目」听起来像「已经交付完的」，实际是「合同签了、接下来要去交付的」——
    时间方向正好反了。名字换成按来源命名（合同项目 / 跟进项目 / 其他事务），
    另外两条信息名字带不动，就写在选项底下。
  */
  const meta = read('src/modules/projectCategory.ts');
  assert.match(meta, /label: '合同项目'/, '交付项目没有改名');
  assert.match(meta, /label: '其他事务'/, '公共事务没有改成更笼统的名字');

  // 每一类都得回答这两个问题，缺一个就等于让人继续猜
  ['Delivery', 'FollowUp', 'Public'].forEach((cat) => {
    const block = meta.slice(meta.indexOf(`${cat}: {`), meta.indexOf(`${cat}: {`) + 400);
    assert.match(block, /when: '.+'/, `${cat} 没写「什么时候建」`);
    assert.match(block, /money: '.+'/, `${cat} 没写「钱怎么算」`);
    assert.match(block, /hint: '.{10,}'/, `${cat} 没写选中时的说明`);
  });

  // 界面上要真的把 when / money 显示出来，不能只存在常量里
  const src = read('pages/Projects.tsx');
  assert.match(src, /PROJECT_CATEGORY_ORDER\.map/, '类别选项没有从常量渲染 —— 又会各写各的');
  assert.match(src, /\{meta\.when\}/, '选项上没显示「什么时候建」');
  assert.match(src, /\{meta\.money\}/, '选项上没显示「钱怎么算」');
});

test('三个筛选默认全开，且放在一起', () => {
  /*
    金恩来：「默认应该都是全部状态，然后若是要筛选内容，
    再由登录同事自己根据条件筛选，一切设计不要画蛇添足。」

    默认值每收紧一档，就多一条「东西在库里、人却看不见」的路径，
    而人看不见的第一反应是「系统坏了」——这个月已经踩了三次。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /useState<'Active' \| 'Completed' \| 'All'>\('All'\)/, '状态默认不是「全部状态」');
  assert.match(src, /useState<ProjectModeFilter>\('all'\)/, '类别默认不是「全部类别」');

  // 三组挨在一起，共用一种控件
  const bar = src.slice(src.indexOf('data-guide-id="project-filters"'), src.indexOf('data-guide-id="project-filters"') + 1200);
  ['状态', '类别', '范围'].forEach((label) => {
    assert.ok(bar.includes(`label="${label}"`), `筛选条里没有「${label}」这一组`);
  });
  assert.ok(!/两者都看/.test(src), '「两者都看」这个看不出是什么的名字还在');
});

test('类别筛选不能把某一类藏起来', () => {
  /*
    原来只有两档，判断写成「delivery 档排掉 isFollowUp、followup 档排掉非 isFollowUp」。
    加了第三类之后它的 projectMode 是 'public'、isFollowUp 为 false，于是
      选「交付项目」不排它 → 混进来；选「跟进项目」排掉它 → 找不到。
    而立项后代码又特地切到 followup 档 —— 建完一个其他事务，
    界面正好跳到唯一看不见它的那一档。

    一个筛选器能让某类数据谁都找不到，比多一个选项危险得多。
  */
  const src = read('pages/Projects.tsx');
  assert.match(src, /resolveProjectCapabilities\(p\)\.projectMode === modeScope/,
    '类别筛选没有按 projectMode 逐一比对，第三类还可能被藏起来');
  assert.ok(!/modeScope === 'delivery' && isFollowUp/.test(src), '旧的两档判断还在');

  // 三类都要有自己的档位，不能合并成「跟进与其他」
  const meta = read('src/modules/projectCategory.ts');
  assert.match(meta, /CATEGORY_FILTERS/, '没有集中定义类别档位');
  assert.match(meta, /PROJECT_CATEGORY_ORDER\.map/, '档位不是从三类派生的 —— 以后加类别又会漏');
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
    ['setModeScope', '合同项目 / 跟进项目 / 其他事务 / 全部类别'],
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
