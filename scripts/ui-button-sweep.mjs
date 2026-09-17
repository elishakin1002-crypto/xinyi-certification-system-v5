/**
 * 按钮清点 —— 每个角色、每一页，把「安全的」按钮逐个点一遍。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么重写（2026-09-17）
 * ══════════════════════════════════════════════════════════════
 *
 * 上一版（.runtime/pw/button-sweep.mjs）用 `text()` 判断"点了有没有反应"，
 * 而 text() 只读 `<main>`。**弹窗、抽屉、toast 都渲染在 main 之外。**
 *
 * 结果是系统性假阴性：报了 165 条「界面无变化」，
 * 金恩来问「所有按钮都试过了吗」，我回头抽查第一条 ——
 * 线索页的「新增线索」—— 它是好的，点下去弹出了完整表单。
 *
 * 一份"已清点"但判据错了的报告，比没清点更糟：它会让人以为这块过了。
 *
 * 这一版的判据：
 *   · 看**整屏**文字（含浮层），不是只看 main
 *   · 单独记录"弹出了什么浮层"，而不是只记"变没变"
 *   · 记录 URL 变化（有些按钮是跳转，不改当前屏文字）
 *   · 控制台新报错单独记
 *
 * 仍然只点安全的：删除/归档/停用/提交/确认这类会改数据的跳过 ——
 * 这一轮回答的是"点了有没有反应"，不是"功能对不对"。
 *
 * 用法：
 *   node scripts/ui-button-sweep.mjs                 # 六个角色全跑
 *   node scripts/ui-button-sweep.mjs MANAGER SALES   # 只跑指定角色
 */
import fs from 'node:fs';
import path from 'node:path';
import { open, loginAs, goto, screenText, overlays, close } from './ui-agent.mjs';

/*
  会改数据的词一律跳过。
  「新增/新建」也在里面 —— 它们多半只是开表单（安全），
  但个别页面是"直接建一条"，分不清就不点。宁可漏测，不可误建。
*/
const 危险词 = /删除|移除|归档|停用|禁用|确认|提交|保存|新建|新增|录入|导入|导出|发起|转为|转化|标记|指派|结项|完成|驳回|撤销|重置密码|清空|生成|分析|抓取|让 ?AI|识别|发送|通知/;

const PAGES = [
  '/dashboard', '/my-tasks', '/intel', '/leads', '/customers', '/contracts',
  '/projects', '/finance', '/finance/settlements', '/audit', '/knowledge',
  '/strategy', '/ai-center', '/employees', '/auth-audit', '/my-devices'
];
const ALL_ROLES = ['ADMIN', 'SYS_ADMIN', 'MANAGER', 'SALES', 'CONSULTANT', 'FINANCE'];
const roles = process.argv.slice(2).length ? process.argv.slice(2) : ALL_ROLES;

const OUT = '.runtime/按钮清点.md';
const 行 = [];
const say = (s) => { console.log(s); 行.push(s); };

let 总点击 = 0;
const 可疑 = [];
const 报错 = [];

for (const role of roles) {
  const ctx = await open();
  let n = 0;
  try {
    await loginAs(ctx, role);
    say(`\n## ${role}`);
    for (const p of PAGES) {
      await goto(ctx, p, 1800);
      const 进得去 = await screenText(ctx, 600);
      if (/没有对你开放|需要额外的权限|打不开「/.test(进得去)) continue;

      /*
        **只收当前视口下看得见的按钮。**
        这一页同时渲染桌面表格和手机列表（md:hidden / hidden md:block），
        1440px 下手机那套是隐藏的。第一版没过滤，`/employees 「编辑」`
        匹配到 78 个，点击全部超时，然后被静悄悄记成「没反应」——
        又是一批冤枉的假阳性。
      */
      const labels = await ctx.page.$$eval('main button', bs =>
        [...new Set(bs
          .filter(b => {
            const r = b.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const st = getComputedStyle(b);
            return st.visibility !== 'hidden' && st.display !== 'none' && !b.disabled;
          })
          .map(b => (b.innerText || b.title || b.getAttribute('aria-label') || '').trim())
          .filter(t => t && t.length <= 16))]);

      for (const label of labels) {
        if (危险词.test(label)) continue;
        const btn = ctx.page.locator('main button:visible', { hasText: label });
        if (await btn.count() === 0) continue;

        /*
          每个按钮之前先把屏幕清干净。
          第一版按顺序点，上一个开的弹窗盖着下一个按钮，
          于是 `/audit 「登记不符合项」` 这种本来好用的被判成可疑
          （单独点它是有反应的）。
        */
        await ctx.page.keyboard.press('Escape').catch(() => {});
        await ctx.page.waitForTimeout(350);

        const 前屏 = await screenText(ctx);
        const 前URL = ctx.page.url();
        const 前浮层 = (await overlays(ctx)).join('|');
        const 前错 = ctx.errors.length;
        const 前弹 = ctx.dialogs.length;   // 原生 alert/confirm 也算有反应
        /*
          第四路信号：按钮自己的状态。

          筛选标签（情报的地区/行业、知识中心的分类）在空数据下点一下，
          列表文字一个字都不会变 —— 变的只是"我被选中了"这个高亮，
          那是 class，不是文字。只看文字的话，每一个筛选标签都会被
          冤枉成哑巴，而这个系统里筛选标签占了可点元素的一大半。
        */
        const 前自身 = await btn.first().evaluate(
          e => `${e.className}|${e.getAttribute('aria-pressed') ?? ''}|${e.getAttribute('aria-selected') ?? ''}|${e.getAttribute('data-state') ?? ''}`
        ).catch(() => '');

        await btn.first().click({ timeout: 4000 }).catch(() => {});
        await ctx.page.waitForTimeout(2000);   // 1200 太短，开弹窗的按钮会被冤枉
        n += 1; 总点击 += 1;

        const 后屏 = await screenText(ctx);
        const 后URL = ctx.page.url();
        const 后浮层 = (await overlays(ctx)).join('|');
        const 后自身 = await btn.first().evaluate(
          e => `${e.className}|${e.getAttribute('aria-pressed') ?? ''}|${e.getAttribute('aria-selected') ?? ''}|${e.getAttribute('data-state') ?? ''}`
        ).catch(() => '');
        const 新错 = ctx.errors.slice(前错);
        const 新弹 = ctx.dialogs.slice(前弹);

        if (新错.length) 报错.push(`${role} ${p} 「${label}」→ ${新错[0].slice(0, 110)}`);

        /*
          「有反应」的四种：屏幕文字变了、地址变了、浮层变了、按钮自身状态变了。
          三样都没变才算可疑 —— 上一版只看第一样，于是所有开弹窗的
          按钮都被冤枉成哑巴。
        */
        if (前屏 === 后屏 && 前URL === 后URL && 前浮层 === 后浮层 && 前自身 === 后自身 && !新弹.length) {
          可疑.push(`${role} ${p} 「${label}」`);
        }

        // 点开的浮层要关掉，否则挡住后面的按钮
        if (后浮层 !== 前浮层) {
          await ctx.page.keyboard.press('Escape').catch(() => {});
          await ctx.page.waitForTimeout(500);
        }
      }
    }
    say(`点了 ${n} 个`);
  } catch (e) {
    say(`❌ ${role} 中断：${String(e).slice(0, 160)}`);
  } finally {
    await close(ctx);
  }
}

say(`\n# 汇总\n\n- 共点击 **${总点击}** 次`);
say(`- 五样都没变（屏幕文字/地址/浮层/按钮自身状态/原生弹框）的「可疑」**${可疑.length}** 个`);
可疑.forEach(x => say(`  - ${x}`));
say(`- 点出新报错的 **${报错.length}** 个`);
报错.forEach(x => say(`  - ${x}`));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `# 按钮清点（${new Date().toISOString().slice(0, 16).replace('T', ' ')}）\n${行.join('\n')}\n`, 'utf8');
console.log(`\n报告：${OUT}`);
