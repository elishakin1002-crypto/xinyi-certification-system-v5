const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {startServerProcess,stopServerProcess}=require('./helpers/serverProcess');
test('consultant can resolve real colleagues without employee-management access or private account fields',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'directory-test-'));
 const password='Directory-Test-2026!';
 const {child,baseUrl}=await startServerProcess({AUTH_STORE_PATH:path.join(dir,'auth.json'),STATE_STORE_PATH:path.join(dir,'state.json'),XINYI_AUTH_REQUIRE_POSTGRES:'false',XINYI_AUTH_SEED_ADMIN_EMAIL:'admin@directory.test',XINYI_AUTH_SEED_ADMIN_PASSWORD:password,XINYI_SESSION_AUTH_REQUIRED:'true',XINYI_AUTHZ_MODE:'enforce'});
 const login=async(account)=>{const r=await fetch(baseUrl+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 try {
  assert.equal((await fetch(baseUrl+'/api/auth/directory')).status,401);
  const admin=await login('admin@directory.test');
  for(const [email,name,status] of [['worker@directory.test','真实顾问','active'],['disabled@directory.test','停用人员','disabled']]){
   const r=await fetch(baseUrl+'/api/auth/users',{method:'POST',headers:{'Content-Type':'application/json',Cookie:admin},body:JSON.stringify({email,name,password,roles:['CONSULTANT'],status,mustChangePassword:false})});assert.equal(r.status,201,await r.text());
  }
  const cookie=await login('worker@directory.test');
  assert.equal((await fetch(baseUrl+'/api/auth/users',{headers:{Cookie:cookie}})).status,403);
  const response=await fetch(baseUrl+'/api/auth/directory',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  const {data}=await response.json();
  assert.ok(data.users.some(u=>u.name==='真实顾问'));
  assert.ok(!data.users.some(u=>u.name==='停用人员'));
  const allowed=new Set(['id','name','roles','activeRole','positionTags','reportsToUserId','status']);
  for(const user of data.users) for(const key of Object.keys(user)) assert.ok(allowed.has(key),key+' must not be exposed');
 }finally{await stopServerProcess(child);fs.rmSync(dir,{recursive:true,force:true});}
});
