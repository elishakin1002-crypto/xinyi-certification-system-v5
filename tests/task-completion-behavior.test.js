const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
test('last task can complete without closing an unpriced project or inventing work hours',()=>{
 const src=fs.readFileSync('context/AppContext.tsx','utf8');const a=src.indexOf('  const updateProjectTask =');const b=src.indexOf('\n  const ',a+10);
 const project={id:'p',status:'Active',tasks:[{id:'t',status:'Pending',category:'Core'}],serviceItems:[]};
 let saved,transaction;
 const ctx=vm.createContext({projects:[project],projectWorkLogs:[],calculateProjectProgress:()=>100,setProjects:p=>saved=p,commitProjectTransaction:p=>transaction=p,completeProject:()=>assert.fail('must not automatically close project'),setProjectWorkLogs:()=>assert.fail('must not fabricate hours')});
 vm.runInContext(ts.transpileModule(src.slice(a,b)+'\nglobalThis.update=updateProjectTask;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
 ctx.update('p','t',{status:'Completed'});
 assert.equal(saved[0].tasks[0].status,'Completed');assert.equal(saved[0].status,'Active');assert.equal(transaction.nextProjects[0].tasks[0].status,'Completed');assert.equal(transaction.nextProjectWorkLogs,undefined);
});
