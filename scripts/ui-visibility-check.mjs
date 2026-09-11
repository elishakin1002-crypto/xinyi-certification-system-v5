#!/usr/bin/env node
/**
 * 真·可见性检查 —— 判「这个东西人能不能真的看见并点到」。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个脚本
 * ══════════════════════════════════════════════════════════════
 *
 * 2026-09-11 金恩来：「之前让你找回角色头像，找回后你怎么没有进行测试？」
 *
 * 我测了，而且测「过」了 —— 问题出在**判据错了**。
 *
 * 当时我用的是：
 *     const r = el.getBoundingClientRect();
 *     r.width > 0 && r.height > 0 && r.right <= innerWidth   → 判定可见 ✅
 *
 * 而真相是：手机端头部挂着 overflow-hidden，账号菜单是 absolute top-full
 * （定位在头部下边缘之外），**被整个裁掉，一个像素都看不见**。
 *
 * **getBoundingClientRect 报的是布局几何，跟祖先有没有把它裁掉无关。**
 * 被裁掉的元素，rect 照样是原来那个位置、原来那个尺寸。
 *
 * 同一个坑这个项目踩过第二次了 —— 坑 #10 是
 * 「position:fixed 元素的 offsetParent 恒为 null」。
 * 共同点：**用了一个不表示自己以为的含义的 DOM 测量，然后拿它当验证通过。**
 *
 * ── 正确的判据只有一个 ────────────────────────────────────────
 *
 *     el.contains(document.elementFromPoint(x, y))
 *
 * 它问的是「那个坐标上**实际画着的**是不是它」，
 * 于是 overflow 裁剪、z-index 遮挡、opacity:0、display:none、
 * 被别的浮层盖住 —— 全都会如实反映出来，不用一条条去想。
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *   node scripts/ui-visibility-check.mjs            # 打印给浏览器用的检查代码
 *
 * 这个脚本本身不启动浏览器（本机没装 Playwright），
 * 它输出一段可以直接贴进浏览器控制台 / 通过 MCP 注入的检查函数。
 * 目的是让「我验过了」这句话有统一、可复现的含义。
 */

export const VISIBILITY_PROBE = `
(() => {
  /**
   * 判一个元素是不是**真的**能被看见并点到。
   * 不用 getBoundingClientRect 的尺寸当判据 —— 那只说明它在布局里有位置，
   * 不说明它没被裁掉/没被盖住。
   */
  const trulyVisible = (el) => {
    if (!el) return { visible: false, why: '元素不存在' };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { visible: false, why: '尺寸为 0' };

    // 取几个采样点，只要有一个点上画的是它（或它的后代），就算可见
    const pts = [
      [r.left + r.width / 2, r.top + Math.min(12, r.height / 2)],
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 8, r.top + 8],
    ];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return { visible: true };
    }

    // 不可见 —— 把原因找出来，否则修的人还得自己查一遍
    let n = el.parentElement, clipper = null;
    while (n && n !== document.body) {
      const st = getComputedStyle(n);
      if (st.overflow !== 'visible' && st.overflow !== '') {
        const nr = n.getBoundingClientRect();
        if (r.bottom > nr.bottom + 1 || r.top < nr.top - 1 || r.right > nr.right + 1 || r.left < nr.left - 1) {
          clipper = n.tagName + '.' + String(n.className).slice(0, 60) + ' [overflow:' + st.overflow + ']';
          break;
        }
      }
      n = n.parentElement;
    }
    if (clipper) return { visible: false, why: '被祖先裁掉了：' + clipper };

    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    if (hit) return { visible: false, why: '被盖住了：' + hit.tagName + '.' + String(hit.className).slice(0, 60) };
    if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) {
      return { visible: false, why: '在视口外' };
    }
    return { visible: false, why: '说不清 —— 手动看一眼' };
  };

  window.__trulyVisible = trulyVisible;
  return 'ready';
})()
`;

if (process.argv[1] && process.argv[1].endsWith('ui-visibility-check.mjs')) {
  console.log(`
真·可见性检查 —— 把下面这段注入页面后，用 __trulyVisible(el) 判定

要点：**不要用 getBoundingClientRect 当可见性判据。**
它报的是布局几何，被 overflow 裁掉、被浮层盖住，它照样报原来的位置。
2026-09-11 就是这么漏掉「手机端头像点了没反应」的。

正确判据：el.contains(document.elementFromPoint(x, y))
`);
  console.log(VISIBILITY_PROBE);
}
