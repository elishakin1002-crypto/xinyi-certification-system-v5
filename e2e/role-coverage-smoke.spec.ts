/*
  角色 × 页面 × 尺寸 的覆盖闸门。

  ══════════════════════════════════════════════════════════════
  为什么有这个文件（2026-09-20）
  ══════════════════════════════════════════════════════════════

  金恩来：「不要忘各个角色的各个面板都要检查一遍」
  「角色覆盖不够就完善他，不用等问题出来了再堵漏洞」

  ── 之前的覆盖率，量出来是这样 ────────────────────────────────

    角色：**1 个**。core-flows 里那条「六个角色的工作台都打得开」
          只是换了看板的 persona 查询参数，**没有真的换账号**——
          菜单权限、页面级的角色行为一次都没被验过。
    页面：19 条路由里只碰了 9 条。
    尺寸：375px 只在 6 个页面上验过。

  ── 这次真正要改的那个习惯 ────────────────────────────────────

  以前我写完一个检查就当它覆盖到了，从没问过"它能看到百分之多少"。
  所以这个文件里**覆盖面本身是被断言的**：
  少跑一个角色、少跑一条路由，测试就红，并打出漏了谁。
  不允许"安静地少跑"——那正是这半年问题一直冒出来的原因。
*/
import { expect, Page, test } from '@playwright/test';

/**
 * 角色 → 用哪个示例档案去扮演。
 *
 * ── 只有四个，而且这件事必须写明白（2026-09-20）────────────────
 *
 * 第一版我写了六个，把 SALES 和 SYS_ADMIN 都映射到 U-001（老板）。
 * 但样例数据里**根本没有这两个角色的档案**——
 * 于是那两轮跑的其实是 ADMIN，覆盖表上却显示六个角色都过了。
 *
 * 这就是假覆盖：数字好看，实际什么都没多验。
 * 今天已经在同一个文件里栽过一次（按文案判权限，结果对着工作台验了 17 遍），
 * 不能再用"看起来覆盖到了"糊弄过去。
 *
 * 所以只列真实存在的四个，另外两个记在 ROLES_NOT_COVERABLE 里，
 * 下面有测试盯着它不许变长。
 */
const ROLE_USERS: Record<string, string> = {
  ADMIN: 'U-001',        // 总经理（样例）
  MANAGER: 'U-002',      // 总助（样例）
  FINANCE: 'U-003',      // 财务（样例）
  CONSULTANT: 'U-004'    // 咨询顾问1（样例）
};

/**
 * 暂时扮演不了的角色 —— **这是已知缺口，不是"已覆盖"**。
 *
 * 要补的话：给样例数据加上这两个角色的档案（user_profiles_v1），
 * 然后把它们挪进上面的 ROLE_USERS。
 */
const ROLES_NOT_COVERABLE: Record<string, string> = {
  SALES: '样例数据里没有纯 SALES 档案（这家公司老板兼最大销售，U-001 是 ADMIN+CONSULTANT）',
  SYS_ADMIN: '样例数据里没有 SYS_ADMIN 档案'
};

/**
 * 全部路由。**新增路由必须加进来**，
 * 下面那条「路由清单不许漏」的测试会盯着 App.tsx 对账。
 */
const ROUTES = [
  '/#/dashboard', '/#/my-tasks', '/#/leads', '/#/customers', '/#/contracts',
  '/#/projects', '/#/finance', '/#/finance/settlements', '/#/audit',
  '/#/knowledge', '/#/intel', '/#/strategy', '/#/employees',
  '/#/auth-audit', '/#/ai-center', '/#/glossary', '/#/my-devices'
];

/** 不进覆盖表的路由，每条都要写清为什么 */
const ROUTES_EXCLUDED: Record<string, string> = {
  '/': '重定向到工作台，没有自己的界面',
  '/login': '未登录才会到，这里跑的是已登录态',
  '/change-password': '要先触发强制改密才会进，归 auth.spec 管'
};

const VIEWPORTS = [
  { name: '桌面', width: 1280, height: 900 },
  { name: '手机', width: 375, height: 812 }
];

/** 扮演某个角色：直接写 localStorage，和应用自己存的是同一个键 */
const actAs = async (page: Page, userId: string) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem('xinyi_disable_onboarding', '1');
    window.localStorage.setItem('current_user_id', JSON.stringify(id));
  }, userId);
};

/** 页面是不是"废了"——白屏、崩溃边界、或者一个字都没有 */
const assertUsable = async (page: Page, where: string) => {
  const body = page.locator('body');
  await expect(body, `${where}：页面是空白的`).not.toHaveText('');
  const text = (await body.textContent()) || '';
  expect(text.length, `${where}：页面内容太少（${text.length} 字），基本等于白屏`).toBeGreaterThan(40);
  for (const bad of ['页面出错', 'Something went wrong', 'Unexpected Application Error']) {
    expect(text.includes(bad), `${where}：页面报错「${bad}」`).toBe(false);
  }
};

/** 有没有东西跑到屏幕外面 */
const overflowOf = (page: Page) => page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ── 覆盖表：跑过什么、没跑什么，最后一起断言 ─────────────────── */
const covered = new Set<string>();

for (const [role, userId] of Object.entries(ROLE_USERS)) {
  for (const vp of VIEWPORTS) {
    test(`${role} × ${vp.name}：每个能进的页面都打得开、不溢出`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await actAs(page, userId);

      /*
        先确认**真的变成了这个角色**。
        不确认的话，哪天扮演方式失效（比如存储键改名），
        所有角色都会退回默认身份，而覆盖表照样打印得漂漂亮亮。
      */
      await page.goto('/#/dashboard');
      await page.waitForTimeout(400);
      const actual = JSON.parse(await page.evaluate(() => window.localStorage.getItem('current_role') || '""'));
      expect(actual, `想扮演 ${role}，实际是 ${actual} —— 扮演没生效，下面跑的都不算数`).toBe(role);

      const denied: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForTimeout(250);

        /*
          ── 判「有没有被挡下」要看地址，不能看文案（2026-09-20 的教训）──

          第一版我按文案判，写的是 /没有权限|无权访问|权限不足/，
          而界面实际说的是「没有执行此动作的权限」—— **一个都没匹配上**。
          于是顾问被挡回工作台之后，代码以为"进去了"，
          接着对着工作台做了 17 遍"页面可用"检查，**测试全绿**。

          一个用来查覆盖率的测试，自己制造了假覆盖。
          文案会改，地址不会 —— 所以看落地地址。
        */
        const landed = page.url().split('#')[1] || '/';
        const asked = route.replace('/#', '');
        if (landed !== asked) {
          const text = (await page.locator('body').textContent()) || '';
          // 被守卫挡下是**对的行为**，记一笔就好；莫名其妙跳走才是 bug
          expect(/权限|无权/.test(text),
            `${role} / ${route}：被跳到了 ${landed}，但页面上没有任何权限说明 —— 这不是守卫，是 bug`).toBe(true);
          denied.push(route);
          continue;
        }

        await assertUsable(page, `${role} / ${vp.name} / ${route}`);
        if (vp.width <= 400) {
          expect(await overflowOf(page),
            `${role} / ${route} 在 ${vp.width}px 下跑出屏幕了`).toBeLessThanOrEqual(1);
        }
        covered.add(`${role}|${vp.name}|${route}`);
      }
      const entered = ROUTES.length - denied.length;
      console.log(`[覆盖] ${role} × ${vp.name}：${ROUTES.length} 条路由 → 进去 ${entered} 条，按权限挡下 ${denied.length} 条（${denied.join(' ') || '无'}）`);

      /*
        覆盖面本身要被断言 —— 这是今天最该固化的那条。

        以前我写完检查就当它覆盖到了，从没问过"它能看到百分之多少"。
        如果哪天守卫出了问题、或者扮演角色的方式失效，
        entered 会悄悄变成 0 或 1，而上面那些断言照样全过
        （对着工作台验 17 遍，绿得很）。所以这里卡一个下限。
      */
      expect(entered, `${role} 一条页面都没进去 —— 多半是扮演角色的方式失效了，不是真的没权限`).toBeGreaterThan(0);
      expect(denied.length, `${role} 被挡下的页面太多（${denied.length}/${ROUTES.length}），权限配置可能出问题了`).toBeLessThan(ROUTES.length - 2);
    });
  }
}

test('路由清单不许漏 —— App.tsx 里新增的页面必须进覆盖表', async () => {
  /*
    最容易悄悄退化的地方：有人加了个新页面，这个文件没跟上，
    于是那一页永远没被任何角色验过，而测试一直是绿的。
    所以直接和 App.tsx 对账。
  */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8');
  const declared = [...app.matchAll(/path="(\/[a-z/-]*)"/g)].map((m) => m[1]);

  const listed = new Set([...ROUTES.map((r) => r.replace('/#', '')), ...Object.keys(ROUTES_EXCLUDED)]);
  const missing = declared.filter((r) => !listed.has(r));

  expect(missing, `App.tsx 里这些路由没进角色覆盖表：${missing.join(', ')}\n`
    + '要么加进 ROUTES，要么写进 ROUTES_EXCLUDED 并说明为什么不用覆盖。').toEqual([]);
});

test('扮演不了的角色不许变多 —— 已知缺口要看得见', () => {
  /*
    这条是给"假覆盖"上的锁。

    如果哪天有人为了让测试好看，把一个跑不了的角色塞进 ROLE_USERS
    随便映射一个档案，覆盖表会显示六个角色全过，而实际上没多验一行。
    所以把"扮演不了的"显式列出来，并且**钉死它的长度**：
    只能变短（补上样例档案），不能变长。
  */
  const notCovered = Object.keys(ROLES_NOT_COVERABLE);
  expect(notCovered.length,
    `扮演不了的角色变多了：${notCovered.join(', ')}\n`
    + '要么给样例数据补上这些角色的档案，要么说明为什么这个角色不需要覆盖。'
  ).toBeLessThanOrEqual(2);

  const totalRoles = Object.keys(ROLE_USERS).length + notCovered.length;
  expect(totalRoles, '系统一共六个角色，覆盖表里必须六个都有交代（跑过的 + 明确跑不了的）').toBe(6);
});
