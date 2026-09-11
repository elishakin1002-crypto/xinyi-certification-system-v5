const {chromium,expect}=require('@playwright/test');
(async()=>{
 const b=await chromium.launch({channel:'chrome'});
 const roles=[['boss','总经理','/dashboard'],['sales','销售','/leads'],['consultant','咨询顾问','/my-tasks'],['finance','财务','/finance'],['manager','总助','/projects'],['sysadmin','系统管理员','/dashboard']];
 for(const width of [1440,390])for(const [persona,name,route] of roles){
  const p=await b.newPage({viewport:{width,height:width===390?844:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:3101/#/dashboard?persona='+persona);
  await p.getByRole('button',{name:'帮助',exact:true}).click();
  await p.getByRole('dialog',{name:'新手引导',exact:true}).getByRole('button',{name:'认识我的工作台',exact:false}).click();
  const tour=p.getByRole('dialog',{name:'认识我的工作台',exact:true});
  await expect(tour).toContainText(name+'第一次登录会看到');
  for(let i=0;i<=6;i++){
   await p.getByLabel('选择工作台讲解内容').selectOption(String(i));await p.waitForTimeout(400);
   const rect=await tour.boundingBox();if(rect.x<0||rect.y<0||rect.x+rect.width>width+1||rect.y+rect.height>(width===390?844:900)+1)throw Error(`${name} ${width} step ${i} overflow`);
   const btn=tour.getByRole('button',{name:i===0?'开始':i===6?'开始上手':'下一步',exact:true});
   await expect(btn).toBeVisible();const br=await btn.boundingBox();if(br.y+br.height>(width===390?844:900))throw Error('footer overflow');
  }
  await expect(tour).toContainText('做到这里就算上手');
  if(['sales','consultant','finance'].includes(persona))await p.screenshot({path:`.artifacts/role-${persona}-${width}.png`});
  await tour.getByRole('button',{name:'开始上手',exact:true}).click();
  const module=p.getByRole('dialog',{name:'了解当前模块',exact:true});await expect(module).toBeVisible();
  await expect(p).toHaveURL(new RegExp('#'+route+'$'));
  await p.getByLabel('选择模块讲解内容').selectOption('1');
  console.log(width,name,'六步、岗位上手任务、模块直达通过');
  const keys=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('onboard_seen_')));if(keys.length)throw Error('preview wrote seen');
  if(errors.length)throw Error(errors.join('\n'));
  await p.close();
 }
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
