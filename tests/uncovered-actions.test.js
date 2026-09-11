// 覆盖矩阵点名的 6 个「从没测过」的动作。
//
// 2026-09-11：`node scripts/test-coverage-matrix.mjs` 第一次跑就指出
// 这 6 个动作码在 tests/ 里一次都没出现过：
//
//   LEAD_CONVERT / TASK_CREATE / KNOWLEDGE_WRITE
//   REMINDER_WRITE / PROJECT_PAUSE / SETTLEMENT_VIEW
//
// 「出现过」不代表测得对，但**没出现过一定没测**。
// 补的时候查出两件事（见下面第 1、6 条），都不是走过场。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const authorize = require(path.join(root, 'server/authz/authorize.js'));

test('1. PROJECT_PAUSE 是个死权限 —— 授了但没有任何地方检查它', () => {
  /*
    查出来的第一件事：`PROJECT_PAUSE` 在 types.ts 里声明、在 constants.ts 里
    授给了三个角色、ACTION_META 里有标签「暂停项目」、policy.js 里定了 L3 ——
    **但全代码库没有任何一处 requireAction / checkActionPermission 检查它，
    也没有任何「暂停项目」的界面。**

    为什么这是个真问题而不是无害的冗余：
    员工页的「单项权限微调」会把它列成一个可勾选项。
    管理员勾了「暂停项目」，以为给了谁一项能力，**实际什么也没发生**。
    权限清单在对人撒谎，比少一项权限更糟。

    这条测试**故意是允许失败的形式**：它不强求马上删掉，
    而是钉住「要么实现它、要么从权限表里去掉」这个二选一，
    不允许它继续以「看起来有」的状态留着。
  */
  const enforced = ['pages', 'components', 'context', 'src', 'server']
    .flatMap((dir) => {
      const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name))
          : /\.(ts|tsx|js)$/.test(e.name) ? [path.join(d, e.name)] : []));
      return walk(dir);
    })
    .filter((f) => {
      const src = read(f);
      return /requireAction\(\s*'PROJECT_PAUSE'|checkActionPermission\(\s*'PROJECT_PAUSE'/.test(src);
    });

  const declaredInRoles = /'PROJECT_PAUSE'/.test(read('constants.ts'));

  assert.ok(
    !declaredInRoles || enforced.length > 0,
    'PROJECT_PAUSE 授给了角色，却没有任何一处检查它 —— '
    + '员工页会把「暂停项目」列成可勾选项，勾了不产生任何效果。'
    + '要么实现暂停功能，要么从 ROLE_CAPABILITIES 里去掉这个动作码。'
  );
});

test('2. TASK_CREATE 故意不在「新建类」白名单里 —— 归属必须管住', () => {
  /*
    判断标准是「这个动作的目标资源此刻存不存在」，**不是名字里有没有 CREATE**。

    TASK_CREATE 是在一个**已经存在**的项目里加任务，
    那个项目的归属必须管 —— 否则顾问能往别人的项目里塞任务。
  */
  const src = strip(read('server/authz/authorize.js'));
  const block = src.slice(src.indexOf('const CREATE_ACTIONS'), src.indexOf('const CREATE_ACTIONS') + 400);
  assert.ok(!/'TASK_CREATE'/.test(block),
    'TASK_CREATE 被放进 CREATE_ACTIONS 了 —— 归属判定会被跳过，顾问能往别人项目里塞任务');

  ['LEAD_CREATE', 'CUSTOMER_CREATE', 'CONTRACT_CREATE', 'PROJECT_CREATE'].forEach((a) => {
    assert.match(block, new RegExp(`'${a}'`), `${a} 该在新建类白名单里 —— 目标资源还不存在，没有归属可判`);
  });
});

test('3. KNOWLEDGE_WRITE / REMINDER_WRITE 属于新建类，不判归属', () => {
  const src = strip(read('server/authz/authorize.js'));
  const block = src.slice(src.indexOf('const CREATE_ACTIONS'), src.indexOf('const CREATE_ACTIONS') + 400);
  ['KNOWLEDGE_WRITE', 'REMINDER_WRITE'].forEach((a) => {
    assert.match(block, new RegExp(`'${a}'`),
      `${a} 不在新建类白名单里 —— 写一条新知识/新提醒时目标还不存在，判归属会把所有人都拦掉`);
  });
});

test('4. SETTLEMENT_VIEW 是只读动作，走读路径', () => {
  /*
    READ_ACTIONS 是**白名单**，方向判断故障安全：
    新加动作码忘了登记 → 当成写操作（更严，顶多拦错），
    而不是当成读操作（更松，直接漏权）。
  */
  const src = strip(read('server/authz/authorize.js'));
  const block = src.slice(src.indexOf('const READ_ACTIONS'), src.indexOf('const isWriteAction'));
  assert.match(block, /'SETTLEMENT_VIEW'/, 'SETTLEMENT_VIEW 不在只读白名单里，会被当成写操作');
  assert.ok(!/'PAYMENT_CONFIRM'|'SETTLEMENT_MANAGE'/.test(block),
    '把确认到账/结算管理这类写操作放进只读白名单了 —— 那是最危险的漏权方向');
});

test('5. LEAD_CONVERT 两条入口都要挡', () => {
  /*
    线索转客户有两条路：线索列表转、情报雷达转。
    只挡一条等于没挡 —— 这个项目在「同一件事有两处实现」上栽过很多次
    （铃铛两份、权限三份、级联两套）。
  */
  const b1 = read('server/routes/batch1.js');
  const b4 = read('server/routes/batch4.js');
  assert.match(b1, /requireAction\('LEAD_CONVERT'/, '线索侧的转化没有鉴权');
  assert.match(b4, /requireAction\('LEAD_CONVERT'/, '情报侧的转化没有鉴权');

  // 两条都要带 resource，否则归属判不了
  assert.match(b1, /requireAction\('LEAD_CONVERT',\s*\{\s*resource/, '线索侧转化没带 resource');
  assert.match(b4, /requireAction\('LEAD_CONVERT',\s*\{\s*resource/, '情报侧转化没带 resource');
});

test('6. 传 {} 和不传，结果必须一致 —— 坑 #2 的守卫不能被「简化」掉', () => {
  /*
    查出来的第二件事：`pages/Projects.tsx` 里有
        checkActionPermission('SETTLEMENT_VIEW', {})
    而坑 #2 说的正是「传 {} 和不传结果相反」—— 因为 {} 是 truthy，
    会触发「这条数据是不是我的」判断，而空对象谁都不属于。

    现在是安全的，因为 actionPermissions.ts 里加了 hasOwnershipInfo 守卫：
    只有真的带了 manager / owner / tasks 才走 OWN 分支。

    **这条测试钉的就是那个守卫。** 有人把它「简化」回 `if (context)`，
    坑 #2 立刻复活，而症状是「某些按钮莫名其妙消失」—— 极难联想到这里。
  */
  const src = strip(read('src/utils/actionPermissions.ts'));
  assert.match(src, /hasOwnershipInfo/, 'hasOwnershipInfo 守卫没了 —— 传 {} 会重新触发归属判定');
  assert.match(src, /context\.manager !== undefined/, '守卫没有按「有没有归属字段」判断');
  assert.match(src, /dataScope === 'OWN' && hasOwnershipInfo/,
    'OWN 分支没有和 hasOwnershipInfo 一起判 —— 空对象会被当成「不属于我」');

  // 顺带确认调用方那一处还在，别哪天改成传 null 又绕开测试
  assert.match(read('pages/Projects.tsx'), /checkActionPermission\('SETTLEMENT_VIEW', \{\}\)/,
    '调用点变了，这条测试要跟着改 —— 别让它变成一条永远通过的空测试');
});

test('7. 白名单式映射不许静默丢字段 —— 几天内踩过两次', () => {
  /*
    这一条不针对某个动作，针对**一类 bug**：

    代码里有好几处「挑字段」的映射，只把列出来的字段带过去。
    没列到的字段，**表单填了也进不了库，而且不报任何错**。

    几天内踩过两次：
      2026-09-10  userProfiles 映射漏了 accountExpiresAt
                  → 账号到期提醒的判断条件恒为假，一条也发不出来
      2026-09-11  buildProjectFromInput 漏了 vendorName
                  → 外包项目的合作方填了存不进去，
                    而「这活谁做的」这条链就断在那里

    共同特征：**后端有、类型定义有、前端在某一层白名单里被丢掉**。
    读代码读不出来，只能靠实测或这种测试钉住。
  */
  const ctx = read('context/AppContext.tsx');
  const build = ctx.slice(ctx.indexOf('const buildProjectFromInput'), ctx.indexOf('const addProject ='));
  assert.ok(build.length > 400, '没截到 buildProjectFromInput，测试要跟着结构改');
  ['projectType', 'vendorName', 'manager', 'deadline'].forEach((f) => {
    assert.match(build, new RegExp(`${f}:`), `buildProjectFromInput 漏了 ${f} —— 表单填了也进不了库，且不报错`);
  });

  const profiles = ctx.slice(ctx.indexOf('const hydrateProfilesFromAuth'), ctx.indexOf('hydrateProfilesFromAuth();'));
  ['accountExpiresAt', 'status', 'positionTags'].forEach((f) => {
    assert.match(profiles, new RegExp(`${f}:`), `userProfiles 映射漏了 ${f}`);
  });
});

test('8. 在制项目口径三处必须一致，且排除已停用的旧类别', () => {
  /*
    2026-09-11：FollowUp 类别 9/8 就退出项目管理了（legacy，新建不出来），
    但**指标口径一直没跟着改** —— 库里 8 个 Active 的
    「XX 认证到期挖角跟进」照旧被算进在制项目数、人均在制、
    日志覆盖率分母、延误率分母。

    这是坑 #23「改分类字段时最容易漏的是连带」的又一次：
    类别改了、界面改了、**统计口径忘了改**，
    于是每个数字都偏一点，而没人看得出偏在哪。

    三处（老板/总助/个人）必须用同一个判据 ——
    否则会出现「老板和总助看到的在制项目数不一样」，
    而那是这个项目最高频的 bug 形态（同一件事多处实现）。
  */
  const src = read('services/dashboardMetrics.ts');
  assert.match(src, /const isLiveProject/, '没有统一的「在制项目」判据');
  assert.match(src, /projectCategory !== 'FollowUp'/, '在制项目没有排除已停用的售前跟进类别');

  const code = strip(src);
  const direct = (code.match(/filter\(p => p\.status === Status\.Active\)/g) || []).length;
  assert.equal(direct, 0,
    `还有 ${direct} 处直接按 status===Active 过滤在制项目 —— 口径会和另外几处对不上`);

  const uses = (code.match(/filter\(isLiveProject\)/g) || []).length;
  assert.ok(uses >= 3, `只有 ${uses} 处用了统一判据，应该至少 3 处（老板/总助/个人）`);
});

test('9. 未完成任务只数在制项目里的，且排除已跳过', () => {
  /*
    2026-09-11：改完在制项目口径后，工作台上出现
    **「在制项目总数 0，未完成任务 70 条」** —— 人完全看不懂那 70 条在哪。

    查出来两处口径错：
      ① openTasks 从**全部项目**里数，包括已结项的。
         项目结项了，里面没勾完的任务是历史，不是欠账。
      ② 没排除 Skipped。跳过是主动决定（客户自行处理、标准变更），
         算进「未完成」会让人对着一个永远清不掉的数字发愁，
         延误率的分母也跟着虚高。

    这是同一个「连带」问题的第三次：改了分类/口径，**关联的统计忘了跟着改**。
  */
  const code = strip(read('services/dashboardMetrics.ts'));
  assert.match(code, /const openTasksOf/, '没有统一的「未完成任务」判据');
  assert.match(code, /projects\.filter\(isLiveProject\)/, '未完成任务没有限定在在制项目里');
  assert.match(code, /filter\(isOpenTask\)/, '没有复用 taskFlow 的 isOpenTask');

  // 不许再出现自己写一套「!== Completed」的判断 —— 那样会漏掉 Skipped
  const adhoc = (code.match(/status !== 'Completed'\)/g) || []).length;
  assert.equal(adhoc, 0,
    `还有 ${adhoc} 处自己判「!== Completed」—— 会把已跳过的任务算成未完成`);
});
