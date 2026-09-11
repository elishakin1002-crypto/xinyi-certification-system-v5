#!/usr/bin/env node
/**
 * 全页面 UI 可见性巡检 —— 输出一段注入浏览器就能跑的脚本。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个
 * ══════════════════════════════════════════════════════════════
 *
 * 2026-09-11 金恩来：「上线检查要全面要按照成熟的公司的做法，
 * 不要再让我重复说了，尤其是之前你自己修改的都没有检查明白！」
 *
 * 那次的具体事故：手机端头像点了没反应，而我"测过"并报告通过 ——
 * 因为用了 getBoundingClientRect 当可见性判据，而它**不知道祖先把它裁掉了**
 * （详见 docs/踩过的坑.md 10b）。
 *
 * 手敲的临时检查有两个问题：
 *   ① 判据可能是错的，而且错了不会有人发现
 *   ② 下次还得重敲，于是下次就不查了
 *
 * 所以把它固化：**判据只有一个、页面全覆盖、结果可对比。**
 *
 * ── 判据 ──────────────────────────────────────────────────────
 *
 *     el.contains(document.elementFromPoint(x, y))
 *
 * 问「那个坐标上实际画着的是不是它」。overflow 裁剪、z-index 遮挡、
 * opacity:0、被浮层盖住 —— 全都会如实反映。
 *
 * ── 我自己的巡检脚本也骗过我一次，值得记 ──────────────────────
 *
 * 第一版用「点击 div.fixed.inset-0.z-40」来关闭弹出的菜单，
 * 而那个元素是**侧边栏容器** —— 点它反而把侧边栏打开了，
 * 于是下一个页面的头像被侧边栏盖住，结果呈现 **OK / ✗ 交替**。
 * 差点当成 6 个产品故障报上去。
 *
 * 所以下面关菜单一律用「再点一次触发器」切换，不去点任何遮罩。
 * **规律性交替的失败，通常是巡检脚本的问题，不是产品的问题。**
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *   node scripts/ui-sweep.mjs            # 打印注入脚本（手机宽度）
 *   node scripts/ui-sweep.mjs --desktop  # 桌面宽度版本
 *
 * 把输出贴进浏览器控制台（或通过浏览器 MCP 注入），登录后运行。
 */

const ROUTES = [
  '/dashboard', '/leads', '/customers', '/contracts', '/my-tasks', '/projects',
  '/audit', '/knowledge', '/intel', '/strategy', '/employees', '/auth-audit', '/my-devices',
];

const SWEEP = (routes) => `
(async () => {
  /** 真·可见性：问「那个点上实际画着的是不是它」，不看 rect 尺寸 */
  const tv = (el) => {
    if (!el) return { visible: false, why: '不存在' };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { visible: false, why: '尺寸 0' };
    const pts = [[r.left + r.width / 2, r.top + 12], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.top + 8]];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const h = document.elementFromPoint(x, y);
      if (h && el.contains(h)) return { visible: true };
    }
    let n = el.parentElement, c = null;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (s.overflow !== 'visible' && s.overflow !== '') {
        const nr = n.getBoundingClientRect();
        if (r.bottom > nr.bottom + 1 || r.top < nr.top - 1) { c = n.tagName + '[overflow:' + s.overflow + ']'; break; }
      }
      n = n.parentElement;
    }
    if (c) return { visible: false, why: '被裁：' + c };
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return { visible: false, why: h ? '被盖：' + h.tagName + '.' + String(h.className).slice(0, 40) : '视口外' };
  };

  /*
    **所有选择器都必须挑「当前可见的那一个」**，不能用 querySelector 取第一个。

    手机端头部和桌面端头部是两套 DOM，同时存在于文档里，靠 md:hidden /
    hidden md: 决定哪一套显示。于是：
      document.querySelector('[role="menu"]')  → 永远取到**手机端那份**
    在桌面宽度下它是隐藏的（尺寸 0），于是巡检报「菜单不可见」——
    而人在屏幕上明明看得见桌面那份。

    2026-09-11 这是我第四次被自己的巡检脚本骗（前三次见坑 10c）。
    前三次是**状态残留**，这次是**选择器取错了那一份**。
    共同点仍然是：脚本的假设只在某一种情况下成立，换个宽度就失真。
  */
  const visible = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const pickVisible = (sel) => [...document.querySelectorAll(sel)].find(visible);
  const pickAvatar = () => pickVisible('[data-onboard="view-switch"]');
  const pickBell = () => [...document.querySelectorAll('button')]
    .filter(b => (b.getAttribute('aria-label') || '').startsWith('提醒')).find(visible);
  const pickMenu = () => pickVisible('[role="menu"]');

  /*
    每页检查前把界面复位 —— **这一步是这个脚本最重要的一行**。

    2026-09-11 我被自己的巡检骗了两次，两次都是状态残留：
      第一次：用「点击 div.fixed.inset-0.z-40」关菜单，而那是**侧边栏容器**，
              点它反而把侧边栏打开了 → 下一页头像被盖 → OK/✗ 交替
      第二次：侧边栏被上一轮留在打开状态 → 13 个页面**全红**，
              差点当成"我刚部署的东西把生产搞挂了"

    两次的共同点：**巡检脚本自己改变了被测对象的状态，还带到了下一个用例。**
    这是自动化测试最经典的坑之一，而它伪装成产品故障。

    判断窍门：**规律性的失败（交替、全红）通常是测试的问题，
    零散的失败才更可能是产品的问题。**

    复位用 Esc + 关侧边栏遮罩，不依赖任何具体 DOM 结构。
  */
  const reset = async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const sb = document.querySelector('div.fixed.inset-0.z-40');
    if (sb) {
      const openMask = sb.querySelector('div.fixed.inset-0.bg-black\\\\/50:not(.opacity-0)');
      if (openMask) openMask.click();
    }
    await new Promise(r => setTimeout(r, 400));
  };

  const rows = [];
  for (const route of ${JSON.stringify(routes)}) {
    location.hash = '#' + route;
    await new Promise(r => setTimeout(r, 1200));
    await reset();
    const row = { 页: route };

    // 复位没生效就直说，别把「侧边栏还开着」算成产品故障
    /*
      复位自检**只在手机宽度下有意义**：桌面（≥768px）侧边栏是常驻的
      md:relative，left 本来就是 0，按手机的判据会全部误报。
    */
    const sbNow = document.querySelector('div.fixed.inset-0.z-40');
    if (innerWidth < 768 && sbNow && sbNow.getBoundingClientRect().left > -10) {
      row.巡检自身异常 = '侧边栏没复位 —— 这一行结果不可信';
    }

    row.横向溢出 = document.documentElement.scrollWidth > innerWidth + 1;

    const av = pickAvatar();
    const vAv = tv(av);
    row.头像 = vAv.visible ? 'OK' : '✗ ' + vAv.why;

    if (vAv.visible) {
      av.click();
      await new Promise(r => setTimeout(r, 450));
      const m = pickMenu();
      const vM = tv(m);
      row.账号菜单 = vM.visible ? 'OK' : '✗ ' + vM.why;
      row.有退出登录 = m ? [...m.querySelectorAll('button')].some(b => /退出登录/.test(b.textContent)) : false;
      // 关菜单用「再点一次触发器」—— 千万别去点遮罩，那会打开侧边栏
      const again = pickAvatar();
      if (again) again.click();
      await new Promise(r => setTimeout(r, 300));
    }

    const bell = pickBell();
    row.铃铛 = tv(bell).visible ? 'OK' : '✗ ' + tv(bell).why;

    // 空页面也得说人话：一条数据都没有时，不能是一片空白
    const txt = document.body.innerText;
    row.有内容或空状态 = txt.length > 200;

    rows.push(row);
  }

  const bad = rows.filter(r => r.横向溢出 || /✗/.test(r.头像 + r.账号菜单 + r.铃铛) || r.有退出登录 === false || !r.有内容或空状态);
  console.table(rows);
  console.log(bad.length ? '❌ ' + bad.length + ' 个页面有问题' : '✅ ' + rows.length + ' 个页面全部通过');
  return { 视口: innerWidth + 'x' + innerHeight, 总数: rows.length, 有问题: bad.length, 明细: bad };
})()
`;

const desktop = process.argv.includes('--desktop');
console.log(`
全页面 UI 可见性巡检${desktop ? '（桌面宽度）' : '（手机宽度：先把视口设成 390x844）'}

判据只有一个：el.contains(document.elementFromPoint(x, y))
**不要用 getBoundingClientRect 的尺寸当可见性判据** —— 它不知道祖先把它裁掉了。

把下面整段贴进浏览器控制台（需先登录）：
`);
console.log(SWEEP(ROUTES));

export { ROUTES, SWEEP };
