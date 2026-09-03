// 系统管理员视角，以及「老板 → 总经理」的改名。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('系统管理员有自己的看板视角，不再顶着「老板」', () => {
  /*
    原来 SYS_ADMIN 映射到 'boss'，于是这个账号的头像下面写着「老板」——
    而它是技术负责人的账号。更要紧的是他看到的是业务 KPI，
    而他真正要看的是服务健不健康、AI 花了多少钱、有没有异常登录。
  */
  assert.match(read('types.ts'), /'finance' \| 'sysadmin'/, 'DashboardPersona 里没有 sysadmin');
  assert.match(read('components/Layout.tsx'), /SYS_ADMIN: 'sysadmin'/, 'Layout 里 SYS_ADMIN 还指向别的视角');
  assert.match(read('context/AppContext.tsx'), /SYS_ADMIN: 'sysadmin'/, 'AppContext 里 SYS_ADMIN 还指向别的视角');
});

test('两份 ROLE_TO_PERSONA 保持一致', () => {
  /*
    这张表在 Layout 和 AppContext 里各有一份。
    2026-09-02 改 SYS_ADMIN 时只改了一份，是 TypeScript 把另一份揪出来的 ——
    靠类型检查兜住是运气，不是设计。
  */
  const pick = (src) => {
    const m = src.match(/ROLE_TO_PERSONA[^=]*=\s*\{([\s\S]*?)\n\};/) || src.match(/roleToPersona[^=]*=\s*\{([\s\S]*?)\n  \};/);
    assert.ok(m, '没找到角色→视角映射表');
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^\s*([A-Z_]+):\s*'([a-z]+)'/);
      if (kv) out[kv[1]] = kv[2];
    }
    return out;
  };
  const a = pick(read('components/Layout.tsx'));
  const b = pick(read('context/AppContext.tsx'));
  for (const role of Object.keys(a)) {
    if (b[role] === undefined) continue;
    assert.equal(a[role], b[role],
      `${role} 在 Layout 里映射成 ${a[role]}，在 AppContext 里是 ${b[role]} —— 两份必须一致`);
  }
});

test('persona 归一化认识 sysadmin', () => {
  /*
    漏掉的后果是「切过去没反应」：URL 上写着 persona=sysadmin，
    归一化认不出就返回 null，页面悄悄退回默认视角，看起来像点击失效。
  */
  const src = read('context/AppContext.tsx');
  assert.match(src, /\['boss', 'sales', 'consultant', 'finance', 'sysadmin'\]\.includes\(normalized\)/,
    'normalizePersona 不认 sysadmin');
});

test('界面上不再出现「老板」', () => {
  // 公司里这个角色的正式称呼是总经理。代码注释里的不算，那是给开发看的。
  const files = ['constants.ts', 'components/Layout.tsx', 'pages/Dashboard.tsx',
                 'src/modules/ai_center/identityContext.ts'];
  for (const f of files) {
    const src = read(f);
    const hits = [...src.matchAll(/['"`][^'"`\n]*老板[^'"`\n]*['"`]/g)]
      .map((m) => m[0])
      // 注释行里的引号不算
      .filter((t) => !t.includes('//'));
    assert.deepEqual(hits, [], `${f} 里还有会显示给用户的「老板」：${hits.join(', ')}`);
  }
  assert.match(read('constants.ts'), /\{ id: 'ADMIN', name: '总经理'/, 'ADMIN 角色名没改成总经理');
  assert.match(read('components/Layout.tsx'), /boss: '总经理'/, '视角显示名没改');
  assert.match(read('pages/Dashboard.tsx'), /boss: '总经理视角'/, '工作台标签没改');
});

test('系统管理员看板是独立的一块，不是业务工作台', () => {
  const dash = read('pages/Dashboard.tsx');
  assert.match(dash, /if \(persona === 'sysadmin'\) return <SysAdminBoard \/>;/,
    '没有切到系统管理员看板');
  /*
    分支必须在所有 hook 之后。React 不允许条件性跳过 hook，
    提前 return 会让两次渲染的 hook 数量不一致 ——
    表现是切换视角时整页崩溃，而报错完全指不到这里。
  */
  assert.ok(dash.indexOf("if (persona === 'sysadmin')") > dash.lastIndexOf('React.useMemo('),
    'sysadmin 分支放在了 hook 中间，切视角会整页崩溃');
});

test('看板按「要不要立刻处理」编排，不按模块', () => {
  const src = read('pages/dashboard/SysAdminBoard.tsx');
  // 今天有没有事 → 成本趋势 → 静态信息
  // 按 JSX 的 title 判断，不能用原始文本 —— 文件头的设计说明里也提到了这些词
  const order = ['今日错误', '同事踩到但没说的问题', 'AI 用量与成本', '数据规模'];
  let last = -1;
  for (const label of order) {
    const at = src.indexOf(`title="${label}"`);
    assert.ok(at > last, `「${label}」的位置不对 —— 先看今天有没有事，最后才是平时不用看的`);
    last = at;
  }
  assert.match(src, /AI 配置中心 →/, 'AI 配置中心的入口没保留');
});

test('运维总览接口只给总经理和系统管理员', () => {
  /*
    这块数据里有在线会话、来源 IP、AI 花费，不该给普通同事看。
  */
  const src = read('server/routes/sysadminOverview.js');
  assert.match(src, /requireOpsRole/, '没有角色守卫');
  assert.match(src, /r === 'ADMIN' \|\| r === 'SYS_ADMIN'/, '守卫放行的角色不对');
  assert.match(src, /router\.get\('\/api\/admin\/sysadmin-overview', requireOpsRole/,
    '守卫没有接到路由上');

  /*
    守卫必须写在路由内部，不能 app.use(中间件, 路由) ——
    那样中间件会作用在所有走到这一层的请求上，等于全站 403。
  */
  const app = read('server/app.js');
  assert.doesNotMatch(app, /app\.use\(requireSessionRoles\(\[[^\]]*\], 'SYSADMIN_OVERVIEW'\), sysadminOverviewRouter\)/,
    '守卫挂成了全局中间件，会把整站锁死');
  assert.match(app, /app\.use\(sysadminOverviewRouter\);/, '路由没挂上');
});

test('单块取数失败不能让整块看板空白', () => {
  /*
    一张表出问题时，最需要的恰恰是看到「哪一块坏了」。
    整个接口抛异常的话，看板一片空白，反而什么都判断不了。
  */
  const src = read('server/routes/sysadminOverview.js');
  assert.match(src, /const safe = async \(fn, label\)/, '没有分块容错');
  assert.match(src, /catch \(e\) \{[\s\S]{0,120}return null; \}/, '失败时没有降级为 null');
});
