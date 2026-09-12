// 手机/中屏的项目卡片：展开的详情不许长在「点一下就折叠」的容器里。
//
// 2026-09-12 金恩来：「在中等屏幕大小尺寸下点击好多问题，比如点击刚刚
// 已经创建的测试3任务，要在添加服务项目或者服务流水，都会自动弹出到上一级界面」
//
// 原因：卡片外层 div 挂着 onClick 折叠，而详情就渲染在这个 div 里面。
// 点详情里任何东西，事件冒泡上去把它自己折叠掉 ——
// **这一档宽度下项目详情里什么都点不了**：加服务项、记日志、改任务，
// 点一下就退回列表。
//
// 桌面表格版一直是对的（详情是独立的 <tr>，兄弟节点）。
// 同一个功能两套结构，只有一套对 —— 这是这个项目的老毛病。
//
// 真实交互由 .artifacts/check-mobile-expand.cjs 开浏览器点（那才是权威，
// 而且做过证伪：把详情塞回去，3 条立刻变红）。
// 这里守的是结构，防止以后有人为了"少一层 div"又合回去。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const raw = fs.readFileSync(path.resolve(__dirname, '../pages/Projects.tsx'), 'utf8');

/*
  **扫源码的断言一律先去注释。**

  2026-09-12 同一天第三次栽在这上面：注释里写着「不再用 confirm」
  「没有用 stopPropagation」，断言一扫就命中自己写的那段说明，
  测试红得莫名其妙。而更危险的是反过来 —— 注释里恰好有那串字，
  代码里其实没有，断言照样绿。
*/
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 取出从某个位置起的完整 JSX 标签（数花括号，别被 `=>` 的箭头截断） */
const tagAt = (text, start) => {
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(start, j + 1);
  }
  return '';
};

test('折叠开关挂在摘要块上，不是整张卡片上', () => {
  /*
    判据：带 setExpandedProject 的那个可点击元素，**自己不能是卡片最外层**。
    最外层要是个纯容器（没有 onClick），详情才能当兄弟节点摆在它下面。
  */
  const i = src.indexOf('<div className="block md:hidden">');
  assert.ok(i > 0, '找不到手机卡片视图，选择器过时了？');
  const section = src.slice(i, i + 4000);

  const cardStart = section.indexOf('<div key={project.id}');
  assert.ok(cardStart > 0, '找不到卡片最外层');
  const cardTag = tagAt(section, cardStart);
  assert.ok(!/onClick/.test(cardTag),
    '卡片最外层又挂上 onClick 了 —— 详情在它里面，点什么都会折叠：\n  ' + cardTag.slice(0, 140));
});

test('详情块是兄弟节点，排在可点击块后面', () => {
  const i = src.indexOf('<div className="block md:hidden">');
  const section = src.slice(i, i + 4000);
  const clickIdx = section.indexOf('setExpandedProject(expandedProject === project.id ? null : project.id)');
  const detailIdx = section.indexOf('{renderProjectDetail(project)}');
  assert.ok(clickIdx > 0 && detailIdx > clickIdx, '详情和折叠开关的相对位置不对');

  // 可点击块必须在详情之前闭合：两者之间要有 `</div>`
  const between = section.slice(clickIdx, detailIdx);
  assert.match(between, /<\/div>/,
    '可点击块没有在详情之前闭合 —— 详情还在它肚子里');
});

test('不许用 stopPropagation 糊过去', () => {
  /*
    stopPropagation 只是把冒泡按住：详情里以后每加一个控件
    都得记得别漏，漏一个就又冒出这个 bug。结构摆对才是真修好。
  */
  const i = src.indexOf('<div className="block md:hidden">');
  const section = src.slice(i, i + 4000);
  assert.ok(!/stopPropagation/.test(section),
    '又用 stopPropagation 压冒泡了 —— 这是按住症状，不是修结构');
});

test('桌面表格那边的详情本来就是独立一行，别改坏了', () => {
  /*
    桌面版一直是对的。改手机版时很容易顺手"统一"成一样的写法，
    把对的那一边也弄坏。这条钉住它。
  */
  assert.match(src, /<tr>\s*<td colSpan=\{6\}[^>]*>\s*\{renderProjectDetail\(project\)\}/,
    '桌面表格的详情不再是独立的 <tr> 了');
});
