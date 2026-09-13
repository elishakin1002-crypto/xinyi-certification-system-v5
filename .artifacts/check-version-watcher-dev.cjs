// 开发模式：和 Vite 断开时要看得见提示。
// 2026-09-13 金恩来：「之前那个更新了就提醒刷新的功能挺好的，怎么不见了」
//   —— 它没不见，是在 localhost 上从来没生效过（比的是打包文件名，dev 没有）。
//
// 测试要点：必须制造**非干净断开**。Vite 客户端里写着 `if (wasClean) return;`，
// 用 ws.close() 是干净关闭，事件根本不发 —— 我第一版就是这么白测的。
// 所以这里真的去杀 dev 服务进程（用 PID，不用宽泛匹配）。
const { chromium } = require('@playwright/test');
const { execSync } = require('child_process');
let bad = 0;
const check = (ok, l, e = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${l}${e ? ' —— ' + e : ''}`); };

const pidOn3000 = () => {
  try {
    return execSync("lsof -nP -iTCP:3000 -sTCP:LISTEN -t", { encoding: 'utf8' }).trim().split('\n')[0];
  } catch { return ''; }
};

(async () => {
  const pid = pidOn3000();
  if (!pid) { console.error('3000 没在跑'); process.exit(2); }
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const logs = [];
  p.on('console', m => logs.push(m.text()));
  /*
    必须先登录。VersionWatcher 挂在 Layout 里，而登录页没有 Layout ——
    不登录的话组件压根没挂载，测什么都是 0。上一版就是这么白测的。
  */
  const creds = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(creds.登录名);
  await p.locator('input[type="password"]').first().fill(creds.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(2000);
  for (let i=0;i<3;i++){const sk=p.getByText('跳过',{exact:true}); if(await sk.count()){await sk.first().click().catch(()=>{});await p.waitForTimeout(400);} }

  const banner = () => p.getByText(/和开发服务器断开了|系统已更新/).count();
  check(await banner() === 0, '连着的时候不提示');

  console.log(`   杀掉 3000 上的进程 PID=${pid}（制造非干净断开）`);
  execSync(`kill ${pid}`);
  await p.waitForTimeout(4000);

  const during = await banner();
  check(during > 0, '断开期间会提示「现在收不到改动」', `实测 ${during} 个`);
  if (during > 0) {
    const t = await p.getByText(/和开发服务器断开了/).first().innerText().catch(() => '');
    console.log('   提示文案：', t.replace(/\s+/g, ' '));
  }
  check(logs.some(l => /server connection lost/.test(l)),
    'Vite 自己也确认连接断了（对照证据，排除是我们误报）');

  await p.screenshot({ path: '.artifacts/version-watcher-dev.png' });
  await b.close();
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项不通过`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
