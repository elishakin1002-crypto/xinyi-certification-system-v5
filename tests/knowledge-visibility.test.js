/*
  知识库可见范围：角色清单要全，老板不许被排除。

  ══════════════════════════════════════════════════════════════
  对应的两个真问题（2026-09-20）
  ══════════════════════════════════════════════════════════════

  ① **角色清单写死，漏了销售和系统管理员**
     pages/Knowledge.tsx 里原来是
       const allRoles = ['ADMIN', 'MANAGER', 'CONSULTANT', 'FINANCE']
     后果有两层：一份文档根本没法授权给销售；更糟的是
     选满这 4 个就显示「**全员可见**」，而销售一个字都看不到 ——
     对一家销售驱动的公司，这是最要命的那个角色。

  ② **员工能把文件藏起来不让老板看见**
     金恩来：「这个在成熟的咨询系统中有这个功能吗？」——没有。
     文档管理系统的通行做法是权限由管理员设定，而且
     **公司所有者永远拥有完整可见性**，上传的人只能往下收窄。

  两条都属于「要随着别人写新代码而更新的规则」（CLAUDE.md 二点五之一），
  所以不能只靠改一次代码，要有东西盯着。
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), `kvis-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'),
  [path.join(root, 'src/modules/knowledge/visibility.ts'), '--bundle', '--platform=node',
    '--format=cjs', `--outfile=${out}`], { stdio: 'pipe' });
const V = require(out);
test.after(() => { try { fs.unlinkSync(out); } catch {} });

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ── 一、角色清单必须从单一来源取 ─────────────────────────── */

test('知识中心的可见范围不许写死角色清单', () => {
  const src = read('pages/Knowledge.tsx');
  /*
    盯的是「本意是全员、却写死成一个子集」这种写法。
    PDCA / AI生成 那两条是**有意的子集**，不在此列 ——
    判据是：这个数组是不是被当成"所有角色"用（allRoles / 默认可见范围）。
  */
  assert.equal(/allRoles[^\n]*=\s*\[\s*'[A-Z]/.test(src), false,
    'allRoles 又被写死成一串角色字面量了。'
    + '写死的清单在新增角色时不会跟着变，而界面还会显示「全员可见」—— '
    + '2026-09-20 销售就是这么被漏掉的。');

  assert.match(src, /allRoles[^\n]*SELECTABLE_AUDIENCE_ROLES/,
    'allRoles 应当来自 SELECTABLE_AUDIENCE_ROLES（受众清单的单一来源）');
});

test('系统的六个角色，可见范围里一个都不能少', () => {
  const constants = read('constants.ts');
  const ids = [...constants.matchAll(/\{\s*id:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
  const roles = new Set(ids);
  for (const must of ['ADMIN', 'SYS_ADMIN', 'MANAGER', 'SALES', 'CONSULTANT', 'FINANCE']) {
    assert.ok(roles.has(must), `SYSTEM_ROLES 里少了 ${must}`);
  }
  assert.equal(roles.size >= 6, true, `SYSTEM_ROLES 只有 ${roles.size} 个角色，预期至少 6 个`);
});

/* ── 二、老板永远可见 ─────────────────────────────────────── */

test('存盘时自动补上「始终可见」的角色', () => {
  /*
    界面上不列这两个角色，但**存进去的 accessRoles 必须包含它们** ——
    否则服务端和前端按 accessRoles 判断时会把他们挡在外面。
    界面简洁和数据正确是两件事，不能为了前者牺牲后者。
  */
  assert.deepEqual(V.enforceAlwaysVisible(['CONSULTANT']), ['CONSULTANT', 'ADMIN', 'SYS_ADMIN']);
  assert.deepEqual(V.enforceAlwaysVisible(['FINANCE', 'ADMIN']), ['FINANCE', 'ADMIN', 'SYS_ADMIN'],
    '已经有的不重复加');
});

test('空数组是「全员可见」，不能被改成「只有总经理」', () => {
  /*
    这个系统里 accessRoles 为空 = 全员可见（见 getAccessLabel）。
    如果这里硬塞一个 ADMIN 进去，「全员可见」就变成「只有老板看得见」——
    正好反了，而且没人会发现，因为界面照样显示得好好的。
  */
  assert.deepEqual(V.enforceAlwaysVisible([]), []);
  assert.deepEqual(V.enforceAlwaysVisible(null), []);
  assert.deepEqual(V.enforceAlwaysVisible(undefined), []);
});

test('总经理和系统管理员不出现在选项里 —— 受众和访问权是两件事', () => {
  /*
    第一版我把总经理做成一个**锁死的勾**，那是半成品：
    一个点不动的选项框只会让人以为界面坏了。

    金恩来 2026-09-20 的三个判断都对 ——
    受众（谁需要看）是业务概念、可选；
    访问权（谁技术上看得到）是系统属性、不该摆成选项。
  */
  assert.deepEqual([...V.SELECTABLE_AUDIENCE_ROLES], ['MANAGER', 'SALES', 'CONSULTANT', 'FINANCE']);
  for (const hidden of ['ADMIN', 'SYS_ADMIN']) {
    assert.equal(V.SELECTABLE_AUDIENCE_ROLES.includes(hidden), false,
      `${hidden} 不该出现在可选受众里 —— 它始终可见，占个点不动的位置只会让人困惑`);
  }
  assert.ok(V.LOCKED_ROLE_HINT.includes('总经理') && V.LOCKED_ROLE_HINT.includes('系统管理员'),
    '要有一句人话说明这两个角色始终可见');
});

test('默认受众 = 四个业务角色全选，也就是全员可见', () => {
  // 金恩来：「默认要全员可见」。收窄应该是例外，需要人主动判断一次。
  assert.deepEqual([...V.DEFAULT_AUDIENCE], ['MANAGER', 'SALES', 'CONSULTANT', 'FINANCE']);
});

test('服务端按可见范围过滤，不能把所有文档发给所有人', () => {
  /*
    改之前 GET /api/knowledge **把全部文档返回给所有人**，
    过滤只发生在浏览器里 —— 顾问的浏览器里装着财务和老板的文档，
    打开开发者工具就能读。那是显示过滤，不是访问控制。

    这正是联网查到的企业 RAG 通病：权限做在应用层，
    数据已经离开服务端了。
  */
  const src = read('server/routes/knowledge.js');
  assert.match(src, /const visibleTo/, '服务端缺少 visibleTo');

  const list = src.slice(src.indexOf("router.get('/api/knowledge'"), src.indexOf("router.get('/api/knowledge/:id'"));
  assert.match(list, /filter\(\(d\) => visibleTo\(d, user\)\)/, '列表接口没有按可见范围过滤');

  const one = src.slice(src.indexOf("router.get('/api/knowledge/:id'"), src.indexOf("router.post('/api/knowledge'"));
  assert.match(one, /visibleTo\(doc, req\.authUser\)/,
    '单篇接口没拦 —— 只滤列表的话，知道 id 就能绕过去，而 id 不是秘密');
});

test('AI 检索只吃当前用户有权限看的文档', () => {
  /*
    「AI 只会读取你有权限查看的文档内容」这句话写在界面上，
    必须是真的。查到的行业通病是反过来的：
    「大多数企业 RAG 把权限做在应用层，结果把机密文档泄露给了错误的人」。
  */
  const src = read('components/AIChatWidget.tsx');
  const block = src.slice(src.indexOf('const allowedDocs'), src.indexOf('const allowedDocs') + 600);
  assert.match(block, /aiVisible !== true/, 'AI 检索没过滤 aiVisible');
  assert.match(block, /accessUserIds/, 'AI 检索没看 accessUserIds');
  assert.match(block, /accessRoles/, 'AI 检索没看 accessRoles');
  assert.match(block, /currentUser/, 'AI 检索没按当前用户判断');
});

/* ── 三、服务端也要拦，只在界面锁等于没锁 ─────────────────── */

test('服务端两个写入口都过了可见范围守卫', () => {
  /*
    界面上把勾置灰是给人看的；接口、批量导入、以后别的写入路径绕得过去。
    规矩要落在**必经之路**上 —— 这条和 guardAiVisible 当初的理由一模一样。
  */
  const src = read('server/routes/knowledge.js');
  assert.match(src, /const guardVisibleRoles/, '服务端缺少 guardVisibleRoles');

  const post = src.slice(src.indexOf("router.post('/api/knowledge'"), src.indexOf("router.patch('/api/knowledge/:id'"));
  assert.match(post, /guardVisibleRoles\(/, 'POST /api/knowledge 没过可见范围守卫');

  const patch = src.slice(src.indexOf("router.patch('/api/knowledge/:id'"));
  assert.match(patch, /guardVisibleRoles\(/, 'PATCH /api/knowledge/:id 没过可见范围守卫');
});

test('前端保存文档时也走同一条规则', () => {
  const src = read('pages/Knowledge.tsx');
  const saves = (src.match(/accessRoles:\s*enforceAlwaysVisible\(/g) || []).length;
  assert.ok(saves >= 2,
    `前端有 ${saves} 处保存点走了 enforceAlwaysVisible，预期至少 2 处（新建 + 编辑）。`
    + '漏一处，那条路径存进去的文档就能把老板排除在外。');
  assert.equal(/accessRoles:\s*visibleRoles\b/.test(src), false,
    '还有保存点直接用了 visibleRoles，没过强制函数');
});

/* ── 四、谁该有「设定可见范围」这个选项 ───────────────────── */

test('顾问和销售没有可见范围选项 —— 对他们是画蛇添足', () => {
  /*
    金恩来 2026-09-20：「普通顾问有必要有这个功能吗？……我不太确定这个
      可见范围对某些角色来说是不是画蛇添足。」

    查下来是的，而且有害。两条行业结论直接对上：
      · **逐份文档设权限正是"权限失控"的来源**，通行做法是按分类继承
      · 10-20 人团队的平衡点是「默认团队透明，只对敏感分类设控制」，
        而且「权限太严的话，人会绕过系统 —— 重复上传、用过期旧副本」

    顾问上传的是体系文件范本、客户复盘、审核记录 —— 恰恰最该共享。
    给他一个收窄按钮，最可能的结果是随手收窄 → 别人找不到 → 再传一份。
  */
  for (const no of ['CONSULTANT', 'SALES', 'MANAGER']) {
    assert.equal(V.canSetAudience(no), false, `${no} 不该有可见范围选项`);
  }
  for (const yes of ['FINANCE', 'ADMIN', 'SYS_ADMIN']) {
    assert.equal(V.canSetAudience(yes), true, `${yes} 需要可见范围选项`);
  }
  assert.equal(V.canSetAudience(undefined), false, '拿不到角色时按"没有"处理，不给');
});

test('没有这个选项的人，界面要明说结果，不是什么都不显示', () => {
  /*
    藏起来会让人以为"我传的东西可能别人看不到"——
    那比给选项更糟：他会去问、去重复传，或者干脆不传。
  */
  assert.ok(V.AUDIENCE_FIXED_HINT.includes('全员可见'), '要说清这份文档谁能看到');
  assert.ok(/财务|总经理/.test(V.AUDIENCE_FIXED_HINT), '要说清真需要限定范围时该找谁');

  const src = read('pages/Knowledge.tsx');
  assert.match(src, /canSetAudience\(activeRole\)/, '界面没有按角色判断');
  assert.match(src, /AUDIENCE_FIXED_HINT/, '没有给无权限的人显示说明');
});
