// 同一浏览器先后登两个账号，界面和服务端会不会对不上。
const { chromium } = require('@playwright/test');
const book = require('../.runtime/走查账号密码.json').账号;
let bad = 0;
const check = (ok,l,e='') => { if(!ok) bad++; console.log(`${ok?'✅':'❌'} ${l}${e?' —— '+e:''}`); };
const login = async (p, who) => {
  const c = book[who];
  await p.goto('http://localhost:3000/#/');
  await p.waitForTimeout(700);
  const acc = p.getByPlaceholder(/邮箱|用户名|账号/).first();
  if (await acc.count()) {
    await acc.fill(c.登录名);
    await p.locator('input[type="password"]').first().fill(c.密码);
    await p.getByRole('button', { name: /登录/ }).first().click();
    await p.waitForSelector('text=工作台', { timeout: 20000 });
  }
  await p.waitForTimeout(1500);
};
const uiName = (p) => p.evaluate(`(() => {
  // 名字在顶栏，但不一定在 <header> 里 —— 直接扫整页第一个出现的人名
  const m = (document.body.innerText||'').match(/(黄佳佳|金恩来|曾云俊|李智薇|金小雁)/);
  return m ? m[1] : '(没读到)';
})()`);
const serverName = (p) => p.evaluate(`fetch('/api/auth/me',{credentials:'include'}).then(r=>r.json()).then(j=>j?.data?.user?.name||j?.data?.name||'(接口没返回)').catch(e=>'(出错 '+e.message+')')`);

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage();

  await login(p, '咨询顾问 黄佳佳');
  console.log(`第一次登录后：界面=${await uiName(p)} / 服务端=${await serverName(p)}`);

  // 同一个浏览器再开一个标签页登另一个账号（cookie 共享）
  const p2 = await ctx.newPage();
  /*
    直接打登录接口换掉 cookie —— 等价于"他在另一个标签页登了 admin"。
    上一版调 login()，而 cookie 已经在了、页面直接进工作台，
    根本没换人，测了个寂寞。
  */
  await p2.goto('http://localhost:3000/#/');
  await p2.waitForTimeout(1200);
  const adm = book['系统管理员 金恩来'];
  const sw = await p2.evaluate(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({account:${JSON.stringify(adm.登录名)},password:${JSON.stringify(adm.密码)}})}).then(r=>r.json()).then(j=>j.code)`);
  console.log('   换成 admin 的登录返回码：', sw);
  await p2.reload();
  await p2.waitForTimeout(2500);
  console.log(`第二个标签登 admin 后：界面=${await uiName(p2)} / 服务端=${await serverName(p2)}`);

  // 回到第一个标签刷新 —— 他说这时会变成系统管理员
  await p.reload();
  await p.waitForTimeout(2500);
  const u = await uiName(p); const s = await serverName(p);
  console.log(`第一个标签刷新后：界面=${u} / 服务端=${s}`);
  check(u === s, '界面显示的人和服务端认的人一致（不许一个名字配另一个人的数据）', `界面 ${u} / 服务端 ${s}`);

  await b.close();
  console.log(bad===0?'\n全部通过':`\n${bad} 项不通过`);
  process.exit(bad===0?0:1);
})().catch(e => { console.error(e.message); process.exit(1); });
