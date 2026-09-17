/**
 * 让 AI 像人一样用前端 —— 真浏览器、真点击、真截图。
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-09-16）
 * ══════════════════════════════════════════════════════════════
 *
 * 金恩来：「若是我要他能真的像人一样，通过前端页面去检查，
 *           而不仅仅是检查代码。」
 *
 * 在这之前我告诉他"命令行的 Codex 做不到"，因为它自带的浏览器插件
 * 在无头模式下拿不到策略（实测报
 * `Unable to load browser request-header policy`）。
 *
 * **那个结论下早了。** 插件用不了 ≠ 开不了浏览器。
 * 这个仓库本来就装着 Playwright（`npm run e2e` 跑的就是它），
 * 而 Playwright 只是一条命令行程序 —— 它驱动一个**真的 Chromium**：
 * 真点击、真读渲染出来的文字、真截图。
 * 命令行 AI 完全用得了，只是得有人先把脚手架搭好。
 *
 * 这个文件就是那个脚手架。它把每次都要踩的几个坑一次性解决掉：
 *
 *   1. **新手引导会挡住整个界面。** 新账号第一次登录会弹一个全屏引导，
 *      Playwright 点任何东西都会超时。必须在页面脚本跑之前就把
 *      localStorage 的 xinyi_disable_onboarding 置上（addInitScript，
 *      不是登录完再置 —— 那时弹窗已经出来了）。
 *   2. **登录表单的选择器**：账号框没有稳定的 name，用 placeholder 认。
 *   3. **HashRouter**：所有页面都是 `/#/xxx`，换页要等 SPA 渲染，
 *      不能只等 networkidle（它早就 idle 了）。
 *   4. **点了之后要给它时间**：这个系统很多写入是防抖的，
 *      点完立刻断言会抓到旧值。
 *
 * ── 怎么用 ────────────────────────────────────────────────────
 *
 *   import { open, login, goto, cards, clickText, snap, close } from './scripts/ui-agent.mjs';
 *
 *   const ctx = await open();                    // 起浏览器
 *   await login(ctx, 'uat-manager-xxx', '密码');  // 登录
 *   await goto(ctx, '/projects');                // 换页
 *   console.log(await cards(ctx));               // 读顶部卡片（名字+数字）
 *   await clickText(ctx, '看全公司');             // 按文字点按钮
 *   console.log(await rows(ctx));                // 数列表行数
 *   await snap(ctx, '项目管理');                  // 截图存证
 *   await close(ctx);
 *
 * 看得见地跑（会真弹出浏览器窗口，适合人在旁边看）：
 *   HEADED=1 node 你的脚本.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { credentials } from './ui-accounts.mjs';

const BASE = process.env.UI_BASE || 'http://localhost:3000';
const SHOT_DIR = process.env.UI_SHOT_DIR || '.runtime/ui-shots';
const WS_FILE = process.env.UI_WS_FILE || '.runtime/ui-browser-ws';

/**
 * 有没有一个已经起好的浏览器可以连？
 *
 * 沙箱里的 AI（`codex exec -s workspace-write`）**起不了 Chromium** ——
 * macOS seatbelt 拒绝 Mach 端口注册，进程在渲染第一个页面前就被杀掉，
 * 报的错是「Target page, context or browser has been closed」，
 * 看起来像代码问题，其实是权限问题，害得第一轮交叉复核整轮作废。
 *
 * 所以：浏览器由沙箱外的人起一次（`scripts/ui-browser-server.mjs`），
 * 这里优先连它。连不上再自己起 —— 在不受限的环境里直接起是正常路径。
 */
const wsEndpoint = () => {
  if (process.env.UI_WS_ENDPOINT) return process.env.UI_WS_ENDPOINT;
  try {
    return fs.readFileSync(WS_FILE, 'utf8').trim() || null;
  } catch {
    return null;                                   // 没这个文件 = 没人起过，自己起
  }
};

/** 起一个浏览器。HEADED=1 时会真弹窗口，默认无头（只是没窗口，浏览器是真的） */
export const open = async () => {
  const endpoint = wsEndpoint();
  /*
    连不上/起不来时，**要说清是哪一种**。
    2026-09-17 有一轮就废在这上面：端点文件被误删，于是这里静悄悄回退去
    沙箱里自己起 Chromium，报的是「Target page, context or browser has been closed」——
    看起来像代码坏了，实际是"那台常驻浏览器没了"。
    错误信息指错方向，比没有错误信息更费时间。
  */
  const browser = await (endpoint
    ? chromium.connect(endpoint).catch((error) => {
        throw new Error(
          `连不上常驻浏览器（${endpoint}）：${String(error).slice(0, 120)}\n`
          + '多半是那个服务已经退出了。重起：node scripts/ui-browser-server.mjs &'
        );
      })
    : chromium.launch({ headless: !process.env.HEADED }).catch((error) => {
        throw new Error(
          `没有常驻浏览器可连，自己起也失败了：${String(error).slice(0, 160)}\n`
          + '如果你在沙箱里（比如 codex exec），自己是起不了 Chromium 的（macOS Mach 端口被拒）。\n'
          + '让沙箱外的人先跑：node scripts/ui-browser-server.mjs &'
        );
      }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  /*
    必须用 addInitScript：它在**每个页面的脚本跑之前**执行。
    等页面加载完再 setItem 就晚了 —— 新手引导那时已经渲染出来，
    Playwright 点什么都会被那层全屏遮罩挡住并超时。
  */
  await context.addInitScript(() => {
    try { window.localStorage.setItem('xinyi_disable_onboarding', '1'); } catch { /* 隐私模式，忽略 */ }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('未捕获异常: ' + String(e).slice(0, 200)));

  /*
    原生对话框（alert / confirm）要记下来。

    2026-09-17 按钮清点把线索页的「筛出重点线索（90天内到期）」
    判成哑巴。其实它是好的 —— 它弹了一句
    「当前没有满足"90天内到期"的重点线索。」
    但那是 window.alert：**不进 document.body.innerText**，
    而且 Playwright 默认会自动关掉它，于是脚本什么都没看见。

    这是这轮清点第 5 个假阴性来源（前四个：只读 main、
    算上了隐藏的手机端按钮、上一个弹窗没关干净、等待时间不够）。
    每一个都会把好按钮报成坏按钮 —— 而一份"已清点"却判错的报告，
    比没清点更害人。

    confirm 一律 dismiss（选"取消"）：这一轮只看"点了有没有反应"，
    不该顺手替人确认删除。
  */
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push(`${d.type()}: ${d.message().slice(0, 160)}`);
    await d.dismiss().catch(() => {});
  });

  return { browser, context, page, errors, dialogs };
};

/**
 * 收工。
 * 连的是常驻服务时，这里只是断开自己这条连接并清掉自己开的页面，
 * 服务本身还活着给下一个人用 —— 这是 Playwright 对 connect() 的定义，
 * 不用担心把别人的浏览器关了。
 */
export const close = async (ctx) => { await ctx.browser.close(); };

/** 登录。失败会抛，不会静悄悄继续 —— 后面所有结论都建立在登录成功上 */
export const login = async (ctx, account, password) => {
  const { page } = ctx;
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder*="账号"]', account);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForTimeout(5000);
  const stillLogin = await page.locator('text=员工登录').count();
  if (stillLogin > 0) {
    const msg = await page.locator('[role=alert], .text-red-600, .text-red-700').first().innerText().catch(() => '');
    throw new Error(`登录失败（${account}）：${msg || '页面仍停在登录页'}`);
  }
  /*
    清掉登录前的控制台噪音。
    应用在未登录状态下也会先发一轮接口请求，全部 401 —— 那是预期行为，
    不是缺陷。留着的话，清点几百个按钮时每一页都顶着十几条 401，
    人会开始整片忽略控制台，真的报错反而看不见了。
    （和「一个永远消不掉的红色数字」是同一个道理。）
  */
  ctx.errors.length = 0;
};

/**
 * 按角色登录，不用知道密码。
 *
 * 项目规矩第二条：密码不进对话、不进仓库、不进报告。
 * 所以密码本由 `scripts/ui-accounts.mjs` 生成并留在 .runtime/，
 * 这里读出来直接往输入框填 —— **调用方全程拿不到那个字符串**，
 * 也就不可能不小心写进清点报告里。
 *
 *   await loginAs(ctx, 'CONSULTANT');   // ADMIN/SYS_ADMIN/MANAGER/SALES/CONSULTANT/FINANCE
 */
export const loginAs = async (ctx, role) => {
  const book = credentials();
  if (!book) throw new Error('没有验收账号密码本 —— 先跑一次 `node scripts/ui-accounts.mjs`');
  const entry = book[role];
  if (!entry) throw new Error(`密码本里没有角色 ${role}，跑 \`node scripts/ui-accounts.mjs --reset\` 重建`);
  await login(ctx, entry.username, entry.password);
  return entry.username;                              // 用户名可以记进报告，密码不行
};

/** 换页。HashRouter，等 SPA 渲染，不能只等 networkidle */
export const goto = async (ctx, hashPath, waitMs = 1600) => {
  await ctx.page.evaluate(p => { location.hash = '#' + p; }, hashPath);
  await ctx.page.waitForTimeout(waitMs);
};

/** 顶部统计卡：返回 [{名字, 数字}]。抓的是渲染后的文字，不是代码里的常量 */
export const cards = async (ctx) => ctx.page.evaluate(() => {
  const out = [];
  document.querySelectorAll('main [class*="rounded-2xl"], main [class*="rounded-xl"]').forEach(box => {
    const lines = (box.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length !== 2) return;                       // 统计卡就是「数字 + 名字」两行
    const [a, b] = lines;
    if (/^[¥￥]?[\d,.\s%*]+$/.test(a) && a.length < 20) out.push({ 名字: b, 数字: a });
  });
  return out;
});

/** 主区域的纯文字，用来做"这一页到底显示了什么"的证据 */
export const text = async (ctx, max = 1200) =>
  ctx.page.evaluate(n => (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, n), max);

/**
 * **整屏**的文字（含弹窗、抽屉、浮层）。
 *
 * ── 为什么非有不可（2026-09-17）──────────────────────────────
 *
 * 按钮清点那一轮用 text()（只读 <main>）判断"点了有没有反应"，
 * 报出 165 条「界面无变化」。金恩来问「所有按钮都试过了吗」，
 * 我回头抽查第一条 —— 线索页的「新增线索」——
 * **它是好的**：点下去弹出了「客户名称 / 联系人 / 手机号 / 保存线索」。
 * 只是弹窗渲染在 <main> 之外，text() 看不见。
 *
 * 于是那一轮的结论是**系统性偏向假阴性**：
 * 凡是开弹窗、开抽屉、弹 toast 的按钮，一律被判成"没反应"。
 * 165 条里有多少是真哑巴，当时根本不知道。
 *
 * 这比漏掉一个 bug 更糟 —— 它让一份"已清点"的报告变得不能用。
 */
export const screenText = async (ctx, max = 4000) =>
  ctx.page.evaluate(n => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, n), max);

/**
 * 当前屏上的浮层（弹窗/抽屉/确认框）文字摘要。
 * 用来回答"点完到底弹出了什么"，而不是只回答"变没变"。
 */
export const overlays = async (ctx) => ctx.page.evaluate(() =>
  [...document.querySelectorAll('[role=dialog], [data-dismiss-layer], .fixed')]
    .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim())
    .filter(t => t && t.length > 2)
    .slice(0, 5));

/** 列表行数 */
export const rows = async (ctx) => ctx.page.locator('tbody tr').count();

/**
 * 按可见文字点按钮。找不到返回 false，**不抛异常** ——
 * 清点几百个按钮时，"这个按钮在这个角色下不存在"是正常结果，不是错误。
 */
export const clickText = async (ctx, label, waitMs = 1400) => {
  const btn = ctx.page.locator('button', { hasText: label });
  if (await btn.count() === 0) return false;
  await btn.first().click({ timeout: 4000 }).catch(() => false);
  await ctx.page.waitForTimeout(waitMs);
  return true;
};

/** 截图存证。文件名带时间，不会互相覆盖 */
export const snap = async (ctx, name) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name.replace(/[/\\:*?"<>|]/g, '_')}-${Date.now()}.png`);
  await ctx.page.screenshot({ path: file });
  return file;
};

/** 这一页有没有横向溢出（手机端最常见的毛病） */
export const overflowsX = async (ctx) =>
  ctx.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

/** 切到手机宽度，测完记得切回来 */
export const setMobile = async (ctx, on = true) =>
  ctx.page.setViewportSize(on ? { width: 375, height: 812 } : { width: 1440, height: 900 });
