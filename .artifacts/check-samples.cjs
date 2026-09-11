const {chromium,expect}=require('@playwright/test');
(async()=>{
const b=await chromium.launch({channel:'chrome'});
const roles={ADMIN:['/customers','/contracts','/projects','/strategy'],SALES:['/leads','/customers','/projects','/intel'],CONSULTANT:['/my-tasks','/projects','/knowledge','/audit'],FINANCE:['/finance','/contracts','/finance/settlements'],MANAGER:['/my-tasks','/projects','/leads'],SYS_ADMIN:['/employees','/auth-audit','/knowledge']};
for(const width of [1440,390])for(const [role,routes] of Object.entries(roles)){
 const p=await b.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(role=>{localStorage.setItem('user_profiles_v1',JSON.stringify([{id:'SAMPLE-QA',name:'页面检查',roles:[role],activeRole:role}]));localStorage.setItem('current_user_id',JSON.stringify('SAMPLE-QA'));localStorage.setItem('onboard_seen_SAMPLE-QA_'+role,'99');},role);
 for(const route of routes){
  await p.goto('http://127.0.0.1:3101/#'+route);await p.reload();
  await p.getByRole('button',{name:'帮助',exact:true}).click();
  await p.getByRole('dialog',{name:'新手引导',exact:true}).getByRole('button',{name:'了解当前模块',exact:false}).click();
  await p.waitForTimeout(300);
  const select=p.getByLabel('选择模块讲解内容');
  const options=await select.locator('option').allTextContents();
  const sampleIndex=options.findIndex(s=>s.includes('对照样例'));
  if(sampleIndex<0){if(!['/strategy'].includes(route))throw Error(width+' '+role+' '+route+' missing sample lesson');console.log(width,role,route,'当前板块无样例步骤');await p.getByRole('button',{name:'关闭帮助',exact:true}).click();continue;}
  await select.selectOption(String(sampleIndex));await p.waitForTimeout(180);
  const sample=p.locator('[data-sample="1"]').filter({visible:true}).first();await expect(sample).toBeVisible();
  const cols=await sample.evaluate(el=>el.tagName==='TR'?{actual:[...el.children].reduce((n,c)=>n+(c.colSpan||1),0),expected:el.closest('table').querySelector('thead tr').children.length}:null);
  if(cols&&cols.actual!==cols.expected)throw Error(`${route}: columns ${JSON.stringify(cols)}`);
  if(['/my-tasks','/customers','/knowledge','/employees'].includes(route))await p.screenshot({path:`.artifacts/sample-${role}-${route.slice(1)}-${width}.png`});
  await p.getByRole('button',{name:'关闭帮助',exact:true}).click();
  // 有真记录时样例关闭引导即消失；空列表样例仍在，点击不能打开业务弹窗。
  await p.waitForTimeout(200);
  const storedSample = await p.evaluate(() => Object.values(localStorage).some(value => /sample-(customer|contract|project|lead|doc|audit-log|strategy)/.test(value)));
  if(storedSample) throw Error('sample persisted');
  const visible=p.locator('[data-sample="1"]').filter({visible:true});
  if(await visible.count()){
   const before=p.url();const dialogs=await p.locator('main .fixed.inset-0').count();
   await visible.first().click();if(p.url()!==before)throw Error('sample navigated');
   if(await p.locator('main .fixed.inset-0').count()!==dialogs)throw Error('sample opened business dialog');
  }
  console.log(width,role,route,'样例、分列、引导与只读检查通过');
 }
 if(errors.length)throw Error(errors.join('\n'));await p.close();
}
await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
