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
  const hardcodedAll = /allRoles\s*:\s*RoleID\[\]\s*=\s*\[/.test(src);
  assert.equal(hardcodedAll, false,
    'allRoles 又被写死了。必须从 SYSTEM_ROLES 派生 —— '
    + '写死的清单在新增角色时不会跟着变，而界面还会显示「全员可见」。');

  assert.match(src, /allRoles[^\n]*SYSTEM_ROLES/, 'allRoles 应当从 SYSTEM_ROLES 派生');
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

test('可见范围里没有总经理时，自动补上', () => {
  assert.deepEqual(V.enforceAlwaysVisible(['CONSULTANT']), ['CONSULTANT', 'ADMIN']);
  assert.deepEqual(V.enforceAlwaysVisible(['FINANCE', 'ADMIN']), ['FINANCE', 'ADMIN'], '已经有就不重复加');
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

test('总经理那个勾在界面上是锁死的', () => {
  assert.equal(V.isLockedRole('ADMIN'), true);
  assert.equal(V.isLockedRole('CONSULTANT'), false);
  assert.ok(V.LOCKED_ROLE_HINT.includes('总经理'), '要有一句人话解释为什么取消不了');
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
