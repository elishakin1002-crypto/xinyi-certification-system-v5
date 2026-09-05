// 视角切换只给老板和系统管理员，以及密码框的显示/隐藏开关。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('视角切换按角色收紧，不再按"选项够不够两个"判断', () => {
  /*
    原来的条件是 viewOptions.length > 1。
    只有「咨询顾问」角色的同事也会看到这个菜单——因为系统给他补了
    一项「销售（仅看板）」，正好凑够两项。

    他点进去改不了任何权限，但菜单叫「切换视角」、图标是眼睛、
    选完顶部写「当前视角：销售」，看起来就是能换身份。
    发现点了没用之后，第一反应是「系统坏了」。
  */
  const src = read('components/Layout.tsx');
  assert.match(src, /const VIEW_SWITCH_ROLES\s*=\s*\[[^\]]*'ADMIN'/,
    '没有按角色限制视角切换');
  assert.match(src, /VIEW_SWITCH_ROLES\s*=\s*\[[^\]]*'SYS_ADMIN'/,
    '系统管理员要能切视角 —— 巡检各角色看到什么靠这个');
  assert.match(src, /\{canSwitchView && viewOptions\.length > 1 &&/,
    '渲染处没有用 canSwitchView 把关');
  assert.doesNotMatch(src, /\{viewOptions\.length > 1 && \(/,
    '还留着只看选项数量的旧条件');
});

test('巡检账号能看到全部四个工作台，不只是自己拥有的角色', () => {
  /*
    2026-09-02：第一版只按 availableRoles 生成选项，
    结果系统管理员账号（只有 SYS_ADMIN 一个角色）只生成一项，
    菜单直接不显示 —— 而这个账号恰恰最需要
    「顾问看到的是什么样、财务看到的是什么样」。

    修法是给巡检账号补上没覆盖到的 persona，标注「仅看板」：
    只换工作台，权限一点不动。
  */
  const src = read('components/Layout.tsx');
  assert.match(src, /if \(canSwitchView\) \{/,
    'viewOptions 里没有针对巡检账号的分支');
  assert.match(src, /Object\.keys\(personaDisplayName\)/,
    '没有遍历全部 persona —— 只有自己角色对应的那个工作台能看，等于没法巡检');
  assert.match(src, /仅看板/,
    '没有标注「仅看板」，会被误解成「以该角色身份预览」');
});

test('顾问、财务、总助都不在视角切换名单里', () => {
  const src = read('components/Layout.tsx');
  const line = src.match(/const VIEW_SWITCH_ROLES\s*=\s*\[([^\]]*)\]/)?.[1] || '';
  for (const role of ['CONSULTANT', 'FINANCE', 'MANAGER', 'SALES']) {
    assert.ok(!line.includes(role), `${role} 不该有视角切换`);
  }
});

test('登录页密码框有显示/隐藏开关', () => {
  /*
    初始密码是随机 12 位，同事照着纸条敲。
    敲错了只看到一排圆点，只能整行删掉重来，
    连着两次就会怀疑是密码本身错了，然后来问人。
  */
  const src = read('pages/Login.tsx');
  assert.match(src, /showPassword/, '登录页没有显示密码的开关');
  assert.match(src, /type=\{showPassword \? 'text' : 'password'\}/,
    '开关没有真的接到输入框的 type 上');
  assert.match(src, /type="button"/,
    'form 里的 button 默认是 submit —— 不写 type="button" 点眼睛会直接提交登录');
});

test('改密页三个框由同一个开关控制', () => {
  /*
    这一页更需要：上面照抄初始密码，下面自己想一个再确认一遍。
    最常见的失败是「两次新密码不一致」，而屏幕上看不出差在哪。
    一个开关同时控制三个框——要比对的正是两个框对不对得上，
    分开切换反而不好比。
  */
  const src = read('pages/ChangePassword.tsx');
  assert.match(src, /showPasswords/, '改密页没有显示密码的开关');
  assert.equal(
    (src.match(/type=\{showPasswords \? 'text' : 'password'\}/g) || []).length, 3,
    '三个密码框应该都接到同一个开关上'
  );
  assert.doesNotMatch(src, /type="password"/, '还有没接上开关的密码框');
});

test('切视角时侧边栏也跟着变，不只是工作台', () => {
  /*
    2026-09-04 业务方发现：巡检账号切到「咨询顾问（仅看板）」，
    **只有工作台变了，左边导航一动不动** ——
    财务回款、战略管理、AI 配置中心照样列在那里。

    于是这个巡检功能废了一半：它本来就是用来确认
    「顾问打开系统到底看到什么」的，而看到的却不是顾问那一套。

    原因：切「仅看板」只写了 URL 上的 ?persona=，没动 activeRole，
    而侧边栏按 activeRole 过滤。
  */
  const src = read('components/Sidebar.tsx');
  // 2026-09-04：预览视角从 URL 改到 Context（URL 参数跨页面会丢），
  // 所以这里断言的是「读到了预览视角」，不再限定它从哪来。
  assert.match(src, /previewPersona/,
    '侧边栏没有读预览视角');
  assert.match(src, /ROLE_PERMISSIONS\[viewRole\]/,
    '侧边栏还在按 activeRole 过滤，切视角不会变');
  assert.doesNotMatch(src, /ROLE_PERMISSIONS\[activeRole\]\?\.includes/,
    '还留着旧的按 activeRole 过滤');
});

test('预览只会让菜单变少，不会变多', () => {
  /*
    这是安全上的关键：预览是「换一副眼镜」，不是「换一个身份」。
    每一项都必须 hasPermission(真实权限) && inView(视角) 双重判断 ——
    只有前者会漏（顾问切到总经理视角就看到财务），
    只有后者会假（看到菜单点进去却是空的）。
  */
  const src = read('components/Sidebar.tsx');
  for (const nav of ['NAV_FINANCE', 'NAV_STRATEGY', 'NAV_AUDIT']) {
    assert.match(src, new RegExp(`hasPermission\\('${nav}'\\) && inView\\('${nav}'\\)`),
      `${nav} 没有做双重判断 —— 预览可能放大或伪造权限`);
  }
});

test('预览视角跨页面不丢', () => {
  /*
    2026-09-04 第一版把预览视角放在 URL 的 ?persona= 上。
    工作台是对的，但**点进任何别的页面就丢了** —— 导航链接不带这个参数。
    切到「咨询顾问」看两眼、一点「合同管理」，左边菜单又变回全量，
    巡检等于白做。

    改成放 Context：单页应用内导航不会丢。
  */
  const ctx = read('context/AppContext.tsx');
  assert.match(ctx, /const \[previewPersona, setPreviewPersona\] = useState/,
    '预览视角没有放进 Context');

  /*
    2026-09-04 又踩一次：Context 初始值写死 null，而 URL 上还留着 ?persona=sales。
    一刷新页面就分裂 —— 工作台按 URL 显示销售视角，侧边栏按 Context 回到
    系统管理员，于是「销售视角」里赫然挂着员工账号和审计日志。

    同一件事有两个来源，就一定会有对不上的那一刻。
  */
  assert.match(ctx, /useState<DashboardPersona \| null>\(\(\) => \{/,
    '开页时没有从 URL 认领视角 —— 刷新后工作台和侧边栏会各说各话');
  assert.match(ctx, /window\.location\.hash/,
    'HashRouter 的查询串在 # 里，不从 hash 读就永远读不到');
  assert.match(ctx, /const parsed = previewPersona \|\| normalizePersona\(queryPersona\)/,
    '工作台没有以 Context 为准 —— 内部导航丢掉参数后它会悄悄退回本人视角');
  assert.doesNotMatch(ctx, /localStorage[\s\S]{0,80}previewPersona/,
    '预览视角不该跨会话粘住 —— 下次登录看到别人的菜单还找不到怎么切回来');

  const sidebar = read('components/Sidebar.tsx');
  assert.match(sidebar, /previewPersona[,\s][^=]*= useApp\(\)/,
    '侧边栏还在从 URL 读视角');
  assert.doesNotMatch(sidebar, /URLSearchParams\(location\.search\)\.get\('persona'\)/,
    '还留着从 URL 读的旧写法');

  const layout = read('components/Layout.tsx');
  assert.match(layout, /setPreviewPersona\(option\.persona\)/, '切视角时没有写进 Context');
  assert.match(layout, /setPreviewPersona\(null\);\s*\/\/ 切回真实角色/,
    '切回真实角色时没有清掉预览');
});

test('系统管理员能管员工账号', () => {
  /*
    2026-09-04：系统管理员打开员工账号页看到
    「当前账号没有员工账号管理权限」——**而管账号正是他的本职工作**。
    服务端一直放行（SYS_ADMIN 有 EMPLOYEE_* 全套，实测 200），只有前端在拦。
    「后端给了权限、前端不让点」这种不一致最难查，因为看日志一切正常。

    修法不是把 SYS_ADMIN 补进那行角色判断 —— 那样下次给总助加权限
    还得再回来改一遍。改成按动作判断，角色名单只留权限矩阵那一份。
  */
  const emp = read('pages/Employees.tsx');
  assert.match(emp, /checkActionPermission\('EMPLOYEE_VIEW'\)\.allowed/,
    '员工账号页没按动作判断');
  assert.doesNotMatch(emp, /const isAdmin = currentUser\.roles\./,
    '还留着按角色名单判断的旧写法');

  const audit = read('pages/AuthAuditLogs.tsx');
  assert.match(audit, /checkActionPermission\('AUTH_AUDIT_VIEW'\)\.allowed/,
    '审计日志页没按动作判断');

  const { loadCapabilities } = require('../server/authz/authorize');
  const caps = loadCapabilities();
  const owned = new Set(Array.from(caps.SYS_ADMIN?.actions || []));
  assert.ok(owned.has('EMPLOYEE_VIEW') && owned.has('AUTH_AUDIT_VIEW'),
    '权限矩阵里系统管理员没有这两项');
});

test('角色↔视角的映射只有一份，而且反向表是推导出来的', () => {
  /*
    2026-09-04：切「销售视角」，侧边栏里赫然挂着员工账号和审计日志。

    原因不是权限漏了 —— 是 **「销售视角」根本不是销售**。
    反向表里写的是 sales: 'MANAGER'，那是总助改名前的遗留
    （总助曾经被显示成「销售」）。正向表 2026-08-24 修过，
    反向表没跟着改，Sidebar 还抄了第三份。

    于是「销售视角」实际展示的是总助的菜单 ——
    而我当天刚给总助开了账号管理权限，两件事撞在一起。

    同一张表被咬第三次了，所以现在只写正向表，反向表推导。
  */
  const c = read('constants.ts');
  assert.match(c, /export const ROLE_TO_PERSONA/, '正向表没放进 constants');
  assert.match(c, /export const PERSONA_TO_ROLE[^=]*= \(\(\) => \{/,
    '反向表还是手写的 —— 手写就一定会和正向表对不上');
  assert.match(c, /SALES: 'sales'/, '销售角色没对上销售视角');

  // 另外两处不许再自己定义一份
  for (const f of ['context/AppContext.tsx', 'components/Sidebar.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /const (ROLE_TO_PERSONA|PERSONA_TO_ROLE)[^=]*=\s*\{/,
      `${f} 又自己抄了一份映射表`);
    assert.match(src, /PERSONA_TO_ROLE/, `${f} 应该从 constants 引用`);
  }
});

test('销售视角看到的必须是销售的菜单', () => {
  /*
    直接算一遍：预览成销售时，侧边栏该显示哪些项。
    这条测试盯的是「视角名和实际角色对得上」，
    而不只是「代码长得像对的」。
  */
  const ts = require('typescript');
  // constants.ts 里有 import.meta（Vite 的环境变量），new Function 认不了，先换掉
  const src = read('constants.ts').replace(/import\.meta\.env/g, '({})');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const mod = { exports: {} };
  // constants.ts 会 import 枚举（Status.Active 之类），给个万能替身顶上
  const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
  new Function('exports', 'module', 'require', js)(mod.exports, mod, () => stub);
  const { PERSONA_TO_ROLE, ROLE_PERMISSIONS, ROLE_CAPABILITIES } = mod.exports;

  assert.equal(PERSONA_TO_ROLE.sales, 'SALES', '「销售视角」映射到的不是销售角色');
  assert.equal(PERSONA_TO_ROLE.boss, 'ADMIN', '「总经理视角」应该映射到总经理');

  const salesRole = PERSONA_TO_ROLE.sales;
  const acts = ROLE_CAPABILITIES[salesRole].actions;
  assert.ok(!acts.includes('EMPLOYEE_VIEW'), '销售视角不该看到员工账号');
  assert.ok(!acts.includes('AUTH_AUDIT_VIEW'), '销售视角不该看到审计日志');
  assert.ok(!ROLE_PERMISSIONS[salesRole].includes('NAV_AI_CENTER'), '销售视角不该看到 AI 配置中心');
  assert.ok(!ROLE_PERMISSIONS[salesRole].includes('NAV_FINANCE'), '销售视角不该看到财务');
});

test('每一项导航都要做视角判断，不能漏', () => {
  /*
    漏一项的表现是：切成财务视角，项目交付还挂在那儿 ——
    人会以为财务能看项目，而实际上不能。
    比起权限漏洞，这种「预览说谎」更难发现，因为它不报错。
  */
  const src = read('components/Sidebar.tsx');
  const gates = src.match(/hasPermission\('NAV_[A-Z_]+'\)(\s*&&\s*inView\('NAV_[A-Z_]+'\))?/g) || [];
  const missing = gates.filter((g) => !g.includes('inView'));
  assert.deepEqual(missing, [], `这些导航项没做视角判断：${missing.join('、')}`);
});

test('合法视角名单从映射表推导，不再手抄', () => {
  /*
    2026-09-05 加「总助」视角时漏的就是这一处：
    类型、映射表、显示名、看板组件全加了，唯独 normalizePersona 的
    白名单没加 —— `?persona=manager` 被判成非法，静默退回本人视角，
    表现是「点了总助视角完全没反应」。

    而那一行上面原本就写着「漏一个值的后果是切过去没反应」。
    写了注释提醒自己还是漏了 —— 靠记性不行，得让它推导。
  */
  const ctx = read('context/AppContext.tsx');
  assert.doesNotMatch(ctx, /\['boss', 'sales', 'consultant', 'finance', 'sysadmin'\]/,
    'normalizePersona 又手抄了一份视角名单');
  assert.match(ctx, /hasOwnProperty\.call\(PERSONA_TO_ROLE, normalized\)/,
    '合法视角没有从映射表推导');

  // 类型里有几个视角，映射表里就该有几个
  const t = read('types.ts');
  const typed = (t.match(/export type DashboardPersona = ([^;]+);/)[1].match(/'([a-z]+)'/g) || [])
    .map((x) => x.replace(/'/g, ''));
  const c = read('constants.ts');
  const mapped = new Set((c.slice(c.indexOf('export const ROLE_TO_PERSONA'), c.indexOf('export const PERSONA_TO_ROLE'))
    .match(/: '([a-z]+)'/g) || []).map((x) => x.replace(/: '|'/g, '')));
  const missing = typed.filter((p) => !mapped.has(p));
  assert.deepEqual(missing, [], `这些视角没有角色映射到它，切过去会没反应：${missing.join('、')}`);
});
