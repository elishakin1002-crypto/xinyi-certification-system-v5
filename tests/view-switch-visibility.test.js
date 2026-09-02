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
