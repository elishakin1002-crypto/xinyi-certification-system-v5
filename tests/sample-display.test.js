const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {transformSync} = require('esbuild');
let active = false;
const result = {exports: {}};
const source = fs.readFileSync(path.join(__dirname, '../components/SampleRow.tsx'), 'utf8');
const code = transformSync(source, {loader: 'tsx', format: 'cjs'}).code;
new Function('require','module','exports',code)(name => name === '../context/AppContext' ? {useApp:()=>({isTourActive:active})} : require(name),result,result.exports);
const {SampleList}=result.exports;
const item={id:'real-record',name:'真实记录'};
const sample={id:'sample-record',name:'演示记录'};
const render=(record)=>React.createElement('div',{className:'business-card'},record.name);
function html(items){return renderToStaticMarkup(React.createElement(SampleList,{items,sample,render}));}
test('非引导且有真实数据时不出现样例；引导结束即恢复',()=>{
 active=false;assert.doesNotMatch(html([item]),/data-sample/);
 active=true;assert.match(html([item]),/data-sample="1"/);
 active=false;assert.doesNotMatch(html([item]),/演示记录/);
});
test('空列表提供样例，复用真实渲染且不修改业务数组',()=>{
 active=false;const items=[];const value=html(items);
 assert.match(value,/business-card/);assert.match(value,/样例 · 不是真实数据/);assert.deepEqual(items,[]);
 const records=[item];active=true;const full=html(records);assert.match(full,/真实记录/);assert.match(full,/演示记录/);assert.deepEqual(records,[item]);
});
test('桌面表格和 Fragment 保留真实列与内容，标签不挤占业务列',()=>{
 active=true;
 const row=record=>React.createElement(React.Fragment,{key:record.id},React.createElement('tr',{className:'real-row'},React.createElement('td',null,'›'),React.createElement('td',null,record.name),React.createElement('td',null,'2/5')));
 const value=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(SampleList,{items:[item],sample,render:row}))));
 assert.match(value,/<td>›<\/td><td>演示记录<\/td><td>2\/5<\/td>/);
 assert.match(value,/<td colSpan="3"/);
 assert.match(value,/<td>›<\/td><td>真实记录<\/td><td>2\/5<\/td>/);
});
