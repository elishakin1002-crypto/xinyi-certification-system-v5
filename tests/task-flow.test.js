// 任务管理三件事：进行中状态、跨项目「我的任务」、前置任务。
//
// 2026-09-08 金恩来：「全部按照你的建议执行」。
//
// 这三件是对着成熟做法补的缺口：
//   ① 跨项目的「我的任务」—— 使用频率最高的一页，原来根本没有
//   ② 「进行中」—— 「没开始」和「在做」是两个信号，原来长得一样
//   ③ 前置任务 —— ISO 交付的硬顺序原来只在顾问脑子里
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

/**
 * 把 taskFlow.ts 转译出来加载。
 *
 * 用 esbuild 而不是拿正则剥类型标注 —— 第一版就是正则，
 * 遇到 `Record<...>` 和默认参数直接把代码剥坏了（Unexpected token ':'），
 * 而失败信息完全指不到真正的原因。项目里本来就有 esbuild
 * （build:metrics 就在用），没理由自己造一个半吊子的。
 */
const { execFileSync } = require('node:child_process');
const os = require('node:os');

let _taskFlow = null;
const loadTaskFlow = () => {
  if (_taskFlow) return _taskFlow;
  const out = path.join(os.tmpdir(), `taskflow-${process.pid}.cjs`);
  execFileSync(path.resolve(root, 'node_modules/.bin/esbuild'), [
    path.resolve(root, 'src/modules/taskFlow.ts'),
    '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
  ], { stdio: 'pipe' });
  _taskFlow = require(out);
  return _taskFlow;
};

test('「进行中」是独立状态，不是「未完成」的别名', () => {
  /*
    「还没开始」和「在做但没做完」对管理者是完全不同的信号：
    前者是没排上，后者是卡住了。原来这两种在系统里长得一模一样，
    总助那块「谁手上活太多」看到的其实是个混合数。
  */
  assert.match(read('types.ts'), /'Pending' \| 'InProgress' \| 'Completed' \| 'Skipped'/,
    'ProjectTask 没有「进行中」状态');
  assert.match(read('src/constants/status.ts'), /IN_PROGRESS: 'InProgress'/,
    '状态常量没跟着加');

  const { TASK_STATUS_META } = loadTaskFlow();
  ['Pending', 'InProgress', 'Completed', 'Skipped'].forEach((k) => {
    assert.ok(TASK_STATUS_META[k], `${k} 没有文案`);
    assert.ok(TASK_STATUS_META[k].hint.length > 5, `${k} 没说清它意味着什么`);
  });
});

test('加了新状态之后，「未完成」的判断不能只认 Pending', () => {
  /*
    这是加枚举值最容易漏的地方：原来写 status === 'Pending' 当「未完成」用，
    加了 InProgress 之后，**正在做的任务会从这些判断里消失** ——
    结项时不提示、AI 不接手，而且都不报错。
  */
  const src = read('pages/Projects.tsx');
  assert.ok(!/filter\(t => t\.status === 'Pending'\)/.test(src),
    '结项前的未完成清单只认 Pending，会漏掉正在做的任务');
  assert.match(src, /t\.status === 'Pending' \|\| t\.status === 'InProgress'/,
    '未完成清单没有把「进行中」算进去');
});

test('已跳过的任务不该算超期', () => {
  /*
    2026-09-08 顺带发现的老 bug：isOpenTask 只排除了 Completed，
    于是**已跳过的任务照样被算成超期** —— 而跳过是人主动交代过原因的决定。
    生产上「超期未完成任务 22」里就掺着这些。
    一个掺了水的数字，看的人很快就不再信它。
  */
  const { isOpenTask, isOverdue } = loadTaskFlow();
  const long_ago = '2020-01-01';
  assert.equal(isOpenTask({ status: 'Skipped' }), false, '跳过的还被当成未了结');
  assert.equal(isOverdue({ status: 'Skipped', deadline: long_ago }), false, '跳过的被算成超期了');
  assert.equal(isOverdue({ status: 'Pending', deadline: long_ago }), true, '真超期的没被认出来');
  assert.equal(isOverdue({ status: 'InProgress', deadline: long_ago }), true, '在做但过期的应该算超期');
  assert.equal(isOverdue({ status: 'Completed', deadline: long_ago }), false, '做完的不该算超期');

  assert.match(read('pages/Projects.tsx'), /task\.status !== 'Completed' && task\.status !== 'Skipped'/,
    '页面里的 isOpenTask 没跟着改');
});

test('前置任务：挡得住、看得见、不成环', () => {
  const { blockingPrerequisites, dependentTasks, canBePrerequisite, knockOnDelays } = loadTaskFlow();
  const a = { id: 'A', title: '体系文件定稿', status: 'Pending', deadline: '2026-09-10' };
  const b = { id: 'B', title: '内审', status: 'Pending', deadline: '2026-09-15', dependsOn: ['A'] };
  const c = { id: 'C', title: '管理评审', status: 'Pending', deadline: '2026-09-20', dependsOn: ['B'] };
  const all = [a, b, c];

  assert.deepEqual(blockingPrerequisites(b, all).map(t => t.id), ['A'], '没认出前置没做完');
  assert.deepEqual(blockingPrerequisites(a, all), [], '没有前置的被误判成有');
  assert.deepEqual(blockingPrerequisites(b, [{ ...a, status: 'Completed' }, b, c], []).map?.(t => t.id) ?? [], [],
    '前置做完了还在挡');

  assert.deepEqual(dependentTasks(a, all).map(t => t.id), ['B'], '没找出等着它的下游');

  // 不能选自己，也不能选「已经在等我的人」—— 否则互相等，谁都开不了工
  assert.equal(canBePrerequisite(a, a, all), false, '能把自己选成前置');
  assert.equal(canBePrerequisite(c, a, all), false, '能选出环：A 的前置是 C，而 C 间接依赖 A');
  assert.equal(canBePrerequisite(a, c, all), true, '正常的前置被挡住了');

  // 改期要能说出连带影响
  const hit = knockOnDelays(a, all, '2026-09-18');
  assert.equal(hit.length, 1, '没算出下游会被挤');
  assert.equal(hit[0].task.id, 'B');
  assert.equal(hit[0].daysLate, 3, '晚几天算错了');
  assert.deepEqual(knockOnDelays(a, all, '2026-09-11'), [], '没影响时不该报警');
});

test('改期时要把连带影响说出来，而不是默默改掉', () => {
  const src = read('pages/Projects.tsx');
  assert.match(src, /const changeTaskDeadline/, '改期没有走统一入口');
  assert.match(src, /下面这些等着它的任务也来不及了/, '改期不提示下游受影响');
  // 三处日期输入都要走这个入口，漏一处就是「这一页会提醒、那一页不会」
  // 只数直接绑在输入框上的（changeTaskDeadline 函数体里那一处是正常的落库）
  const direct = (src.match(/updateProjectTask\(project\.id, task\.id, \{ deadline: e\.target\.value \}\)/g) || []).length;
  assert.equal(direct, 0, `还有 ${direct} 处日期输入绕过了连带提示`);
});

test('前置没做完是提醒，不是禁止', () => {
  /*
    强制不会让人按顺序做事，只会让人绕过系统做事 ——
    和「跳过要填原因」是同一条道理。现实里确实有并行推进、
    客户先给了材料这类情况。
  */
  const src = read('components/TaskStatusControl.tsx');
  assert.match(src, /window\.confirm/, '前置没完成时直接禁止了，应该是问一句');
  assert.match(src, /通常要等它们做完再/, '提示没说清为什么');
  assert.match(src, /等 \{blockers\.length\} 项/, '点之前看不出这条有前置没做完');
});

test('「我的任务」是跨项目的一页，而且挂进了导航', () => {
  /*
    在它之前任务只存在于项目详情里，顾问想知道今天要干什么，
    得把手上每个项目挨个点开。结果是大家不看系统、看微信群和记性 ——
    那样截止日期就成了摆设，延误率也没了意义。
  */
  const src = read('pages/MyTasks.tsx');
  assert.match(src, /projects \|\| \[\]\)\.forEach/, '不是跨项目聚合');
  ['已超期', '今天到期', '本周内'].forEach(k =>
    assert.ok(src.includes(k), `没有「${k}」这一档 —— 按时间分组才知道先干哪件`));
  assert.match(src, /showLater/, '「以后」的没有收起来 —— 一次给 60 条人会关掉页面');

  // 入口必须真的挂上去，否则做了等于没做
  assert.match(read('App.tsx'), /path="\/my-tasks"/, '路由没加');
  assert.match(read('components/Sidebar.tsx'), /to="\/my-tasks"/, '侧边栏没有入口');
  assert.match(read('components/Layout.tsx'), /'\/my-tasks': '我的任务'/,
    '顶栏标题没加 —— 手机上会显示「信义系统」，人不知道自己在哪');
  assert.match(read('src/modules/help/pageGuide.ts'), /path: '\/my-tasks'/, '这一页没有本页详解');
});

test('三处任务列表共用同一个状态控件', () => {
  /*
    项目详情有两处任务列表（分组视图 / 平铺视图），加上「我的任务」共三处。
    各写一遍的话，加「进行中」就要改三个地方 ——
    漏掉一处的表现是「同一个任务在这一页能标进行中，换一页就不能」，最难查。
  */
  const proj = read('pages/Projects.tsx');
  const mine = read('pages/MyTasks.tsx');
  assert.ok((proj.match(/<TaskStatusControl/g) || []).length >= 2, '项目页没有全部换成共用控件');
  assert.match(mine, /<TaskStatusControl/, '「我的任务」没用共用控件');
  assert.ok(!/status: task\.status === 'Completed' \? 'Pending' : 'Completed'/.test(proj),
    '还有手写的勾选逻辑没换掉');
});

test('工作台和我的任务是主从关系，不是二选一', () => {
  /*
    2026-09-08 金恩来：「是不是把任务管理直接融入到工作台就好了？
    为什么要单独做一页？」

    答案是主从：工作台放三五条摘要（它是「看」的地方），
    我的任务放全量和操作（它是「做」的地方）。
    硬塞全量进工作台只有两个结局：截断（那还得有个「查看全部」，
    等于又回到单独一页），或者工作台变成长列表（它就不再是概览了）。

    在这个摘要块出现之前，两页是**断的** —— 工作台看完知道有事，
    却要自己走去侧边栏点「我的任务」。
  */
  const w = read('components/MyWorkWidget.tsx');
  assert.match(w, /MAX_ROWS = \d/, '摘要没有条数上限 —— 放多了它就不是概览了');
  assert.match(w, /navigate\('\/my-tasks'\)/, '摘要没有通往完整清单的入口');
  assert.match(w, /<TaskStatusControl/, '摘要里不能直接勾完成 —— 看到了要走两步才能处理，人就会先放着');

  /*
    **每一套工作台都要挂上。**
    第一版只加在 PersonaDashboard 上，而老板和系统管理员的工作台
    是各写一套的 —— 于是老板那边压根没有，典型的「改一处漏一处」。
    系统管理员那块故意不加：他不做交付，加上去恒为空，只是噪音。
  */
  assert.match(read('pages/dashboard/PersonaDashboard.tsx'), /<MyWorkWidget \/>/, '共用工作台没挂');
  assert.match(read('pages/dashboard/BossDashboard.tsx'), /<MyWorkWidget \/>/,
    '老板工作台没挂 —— 信义的老板同时是最大的销售，他名下有真实的活');
});

test('「全公司」之外要有「我派出去的」', () => {
  /*
    金恩来：「每个人可以看到全公司的任务和项目合适吗？
    对提高工作效率有帮助吗？」

    想清楚之后：看全公司的任务清单对绝大多数人没用 ——
    别人的任务你既改不了也不该改，翻一遍只是消耗注意力。
    但「全公司」底下藏着一个真需求：项目负责人想知道
    「我派给别人的活做了没」。原来只能切到全公司再自己一条条挑，
    那是把噪音塞给他之后再让他自己过滤。
  */
  const src = read('pages/MyTasks.tsx');
  assert.match(src, /const isAssignedByMe/, '没有「我派出去的」这一档');
  assert.match(src, /label: '我派出去的'/, '筛选里没有这个选项');
  // 默认仍然只看自己的 —— 能看 ≠ 默认看
  assert.match(src, /useState<'mine' \| 'assigned' \| 'all'>\('mine'\)/,
    '默认不该是全公司 —— 能看和默认看是两回事');
});

test('新增页面要进新手引导，而且引导不能变长', () => {
  const steps = read('src/modules/onboarding/steps.ts');
  assert.match(steps, /nav-my-tasks/, '「我的任务」没有进引导 —— 做了没人知道等于没做');

  /*
    加一步就要减一步。项目自己的规矩是不超过六步
    （「十步以上的引导，人会从第四步开始一路点下一步，等于没看」）。
    加了「我的任务」之后顾问和总助都变成 7 步，
    是把「工时记录」并进项目管理、把总助那步并进工作台才压回去的。
  */
  const roles = [...steps.matchAll(/^  ([A-Z_]+): \{/gm)];
  roles.forEach((m, i) => {
    const end = i + 1 < roles.length ? roles[i + 1].index : steps.length;
    const body = steps.slice(m.index, end);
    const n = (body.match(/^      \{/gm) || []).length
      + (body.match(/COMMON_END,/g) || []).length
      + (body.match(/FEEDBACK_END,/g) || []).length;
    assert.ok(n <= 6, `${m[1]} 的引导有 ${n} 步，超过六步就没人看完了`);
  });
});

test('新控件要有单项解释', () => {
  /*
    三层帮助的第三层按名字匹配。新加的控件如果没配规则，
    点上去只会得到通用兜底 —— 而那正是「暂无说明」的变体。
  */
  const src = read('src/modules/help/controlGuide.ts');
  ['开始做', '前置', '我派出去的', '我的任务', '我今天的活'].forEach(k =>
    assert.ok(src.includes(k), `单项解释里没有「${k}」`));
});
