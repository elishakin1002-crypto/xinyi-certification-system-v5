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
  assert.match(read('constants.ts'), /SYS_ADMIN: 'sysadmin'/, 'SYS_ADMIN 还指向别的视角');
});

test('角色→视角这张表全项目只有一份', () => {
  /*
    这张表曾经在 Layout、AppContext、Sidebar 里各存一份，被咬过三次：

    ① 2026-08-24 改了 Layout 漏了 AppContext —— 总助看到的一直是
       「我的线索 / 个人转化率」，而她不拥有线索，数字永远是 0。
    ② 2026-09-02 改 SYS_ADMIN 时又只改一份，是 TypeScript 撞出来的 ——
       靠类型检查兜住是运气，不是设计。
    ③ 2026-09-04 反向表还停在 sales: 'MANAGER'，于是「销售视角」
       展示的其实是总助的菜单，员工账号和审计日志就那么冒出来了。

    第三次之后不再靠人同步：只在 constants.ts 写一份，别处一律引用。
  */
  const c = read('constants.ts');
  assert.match(c, /export const ROLE_TO_PERSONA/, 'constants 里没有这张表');

  for (const f of ['components/Layout.tsx', 'context/AppContext.tsx', 'components/Sidebar.tsx']) {
    assert.doesNotMatch(read(f), /const (roleToPersona|ROLE_TO_PERSONA|PERSONA_TO_ROLE)[^=]*=\s*\{/,
      `${f} 又自己抄了一份角色↔视角映射`);
  }
});
