// 移除附件：点了要真没，刷新也不回来（原来就是"刷新又回来"才被下线的）
const { chromium } = require('@playwright/test');
const { execSync } = require('child_process');
const c = require('../.runtime/走查账号密码.json').账号['总经理 曾云俊'];
let bad = 0;
const check = (ok,l,e='') => { if(!ok) bad++; console.log(`${ok?'✅':'❌'} ${l}${e?' —— '+e:''}`); };
const count = () => Number(execSync(`docker exec xinyi-dev-db psql -U xinyi -d xinyi -t -c "select jsonb_array_length(coalesce(attachments::jsonb,'[]'::jsonb)) from contracts where id='CT-1786688154452';"`,{encoding:'utf8'}).trim());
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:3000/#/');
  await p.getByPlaceholder(/邮箱|用户名|账号/).first().fill(c.登录名);
  await p.locator('input[type="password"]').first().fill(c.密码);
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForSelector('text=工作台', { timeout: 20000 });
  await p.waitForTimeout(1800);
  for (let i=0;i<3;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }
  await p.goto('http://localhost:3000/#/contracts');
  await p.waitForTimeout(1600);
  for (let i=0;i<2;i++){const s=p.getByText('跳过',{exact:true}); if(await s.count()){await s.first().click().catch(()=>{});await p.waitForTimeout(400);} }

  const before = count();
  console.log('   删之前库里附件数：', before);
  await p.locator('tr', { hasText: '优福包装' }).first().click();
  await p.waitForTimeout(1500);
  const del = p.locator('button[title="移除这条附件记录"]');
  check(await del.count() > 0, '「移除」按钮回来了', `找到 ${await del.count()} 个`);
  if (await del.count()) {
    await del.first().click();
    await p.waitForTimeout(2500);
  }
  const after = count();
  console.log('   删之后库里附件数：', after);
  check(after === before - 1, '库里真的少了一条（不是只在界面上消失）', `${before} → ${after}`);

  // 刷新看会不会回来 —— 这正是当初下线的原因
  await p.reload();
  await p.waitForTimeout(2500);
  const afterReload = count();
  check(afterReload === after, '刷新之后没有"又回来"', `${after} → ${afterReload}`);
  await b.close();
  console.log(bad===0?'\n全部通过':`\n${bad} 项不通过`);
  process.exit(bad===0?0:1);
})().catch(e => { console.error(e.message); process.exit(1); });
