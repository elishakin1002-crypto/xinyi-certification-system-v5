const {chromium,expect}=require('@playwright/test');
(async()=>{const b=await chromium.launch({channel:'chrome'});const p=await b.newPage({viewport:{width:1440,height:1000}});let fail=true,created;
await p.route('**/api/**',async r=>{const u=new URL(r.request().url());if(u.pathname==='/api/projects'&&r.request().method()==='POST'){created=r.request().postDataJSON().project;return r.fulfill({status:fail?500:200,json:fail?{ok:false,message:'测试保存失败'}:{ok:true,data:{project:created}}})}if(u.pathname.startsWith('/api/projects/')&&created)return r.fulfill({json:{ok:true,data:{project:created}}});return r.fulfill({json:{ok:true,code:0,data:{users:[],logs:[],datasets:{}}}})});
await p.addInitScript(()=>{const user={id:'QA',name:'页面检查',roles:['ADMIN'],activeRole:'ADMIN'};localStorage.setItem('user_profiles_v1',JSON.stringify([user]));localStorage.setItem('current_user_id',JSON.stringify('QA'));localStorage.setItem('onboard_seen_QA_ADMIN','99');const task=(id,status,deadline)=>({id,title:'任务'+id,status,deadline,owner:'页面检查',priority:'Medium',category:'Core'});localStorage.setItem('projects_v8',JSON.stringify([{id:'QA1',name:'卡住的项目',status:'Active',manager:'页面检查',ownerUserId:'QA',projectCategory:'Public',billable:false,tasks:[task('1','Pending','2020-01-01'),task('2','Pending','2020-01-01'),task('3','Completed','2020-01-01')]},{id:'QA2',name:'正常项目',status:'Active',manager:'页面检查',ownerUserId:'QA',projectCategory:'Public',billable:false,tasks:[task('4','Pending','2099-01-01')]},{id:'QA3',name:'已完成项目记录',status:'Completed',manager:'页面检查',ownerUserId:'QA',projectCategory:'Public',billable:false,tasks:[task('5','Pending','2020-01-01')]}]));});
await p.goto('http://127.0.0.1:3101/#/projects');
for(const [label,total]of [['进行中项目',2],['已完成项目',1],['有任务卡住的项目',1],['超期未完成任务',2]]){const card=p.getByRole('button',{name:new RegExp(label)}).first();await card.click();await expect(card).toHaveAttribute('aria-pressed','true');await expect(card).toContainText('已选中');if(label==='超期未完成任务'){await expect(p.getByTestId('overdue-task-results').getByRole('button')).toHaveCount(total);await expect(p.getByTestId('overdue-task-results')).not.toContainText('任务3');}else{await expect(p.locator('main')).toContainText(`共 ${total} 个项目`);}console.log(label,'选中与数量通过');}
await p.screenshot({path:'.artifacts/project-overdue-fixed.png'});
await p.getByRole('button',{name:'新建项目',exact:true}).click();await p.getByPlaceholder('例如：某某工厂ISO认证咨询').fill('保存回归项目');await p.getByRole('radio',{name:/不涉及客户/}).check();
await p.getByRole('button',{name:'确认立项',exact:true}).click();
await expect(p.getByPlaceholder('例如：某某工厂ISO认证咨询')).toHaveValue('保存回归项目');
await expect(p.locator('main')).not.toContainText('已立项');
await expect(p.getByText('测试保存失败',{exact:false}).first()).toBeVisible();
fail=false;
await p.getByRole('button',{name:'确认立项',exact:true}).click();
await expect(p.getByPlaceholder('例如：某某工厂ISO认证咨询')).toHaveCount(0);
await expect(p.locator('main')).toContainText('已立项');
console.log('失败保留表单、不报成功；重试成功后显示记录与成功提示，通过');
await b.close();})().catch(e=>{console.error(e);process.exit(1)});
