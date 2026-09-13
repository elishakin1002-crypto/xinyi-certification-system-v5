// AI 智能摘要只给 系统管理员/总经理/总助。2026-09-13 金恩来指定。
const { chromium } = require('@playwright/test');
const book = require('../.runtime/走查账号密码.json').账号;
let bad = 0;
const check = (ok, l, e='') => { if(!ok) bad++; console.log(`${ok?'✅':'❌'} ${l}${e?' —— '+e:''}`); };
const run = async (b, who, shouldSee) => {
  const c = book[who];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1800);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.goto('http://localhost:3000/#/knowledge');
  await p.waitForTimeout(1800);
  for (let i=0;i<2;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  const listHas = await p.getByText('暂无智能摘要').count();
  // 打开一篇看侧栏
  /*
    卡片是 `rounded-2xl ... cursor-pointer group` 的 div，onClick 打开预览。
    上一版用 `div[class*=cursor-pointer]` 这种泛选择器，点到了别的东西，
    三个角色全报 0 —— 又是探针骗我，不是产品问题。
  */
  const card = p.locator('div.cursor-pointer.group.relative').first();
  const opened = await card.count();
  if (opened) await card.click();
  await p.waitForTimeout(1500);
  if (!opened) console.log('   ⚠️ 没找到可点的文档卡片');
  const sideHas = await p.getByText('AI 智能摘要').count();
  check((sideHas > 0) === shouldSee, `${who}｜${shouldSee ? '看得到' : '看不到'}「AI 智能摘要」侧栏`, `侧栏 ${sideHas} 个`);
  check((listHas > 0) === shouldSee, `${who}｜列表卡片上的摘要块${shouldSee ? '在' : '不在'}`, `卡片摘要块 ${listHas} 个`);
  await ctx.close();
};
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  await run(b, '系统管理员 金恩来', true);
  await run(b, '总经理 曾云俊', true);
  await run(b, '总助 李智薇', true);
  await run(b, '咨询顾问 黄佳佳', false);
  await run(b, '财务 金小雁', false);
  await b.close();
  console.log(bad===0?'\n全部通过':`\n${bad} 项不通过`);
  process.exit(bad===0?0:1);
})().catch(e => { console.error(e.message); process.exit(1); });
