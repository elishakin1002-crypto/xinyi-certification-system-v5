// 三层帮助：① 岗位上手 ② 本页详解 ③ 单项解释。
//
// 2026-09-07 金恩来：「然后三层帮助直接做啊！」
//
// 这一套的价值全在**内容对不对**和**入口点不点得到**上，
// 所以测试盯的也是这两件事，而不是渲染细节。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('一个入口，三层都能进得去', () => {
  /*
    三层如果摆成三个按钮，人得先判断「我这个问题属于第几层」——
    那是让他先学一遍我的分类法。所以只有一个问号。
  */
  const hub = read('components/HelpHub.tsx');
  ['认识我的工作台', '了解当前模块', '解释这一项'].forEach((label) => {
    assert.ok(hub.includes(label), `帮助菜单里少了「${label}」这一层`);
  });

  const layout = read('components/Layout.tsx');
  assert.match(layout, /<HelpHub[\s\S]{0,200}onReplayTour=/, '帮助中心没有挂到布局上');
  assert.match(layout, /aria-label="帮助"/, '头部没有帮助入口');
  // 手机端和桌面端是两个独立的头部，漏一个就是「电脑上有、手机上没有」
  assert.ok(layout.split('aria-label="帮助"').length - 1 >= 2,
    '只有一个头部有帮助按钮 —— 手机端和桌面端的头部是分开写的，两边都要有');
});

test('弹窗开着时也够得到帮助', () => {
  /*
    最需要解释的时刻恰恰是弹窗开着、面前一堆必填项的时候，
    而弹窗的遮罩把头部整个盖住了 ——
    做了「先讲当前弹窗」的逻辑却点不到入口，等于白做。
  */
  const hub = read('components/HelpHub.tsx');
  assert.match(hub, /这个弹窗要我填什么/, '弹窗开着时没有可点的帮助入口');
  assert.match(hub, /if \(!modalOpen\) return null;/, '那个入口平时也常驻 —— 两个入口是画蛇添足');
});

test('认弹窗不能用 offsetParent', () => {
  /*
    规范里 position:fixed 的元素 offsetParent 就是 null，而弹窗全是 fixed ——
    用它判断可见，等于把每个弹窗都当成不存在，而且**不报错**：
    帮助照样弹出来，只是永远在讲整页。这种「静默地一直不对」最难发现。
  */
  const hub = read('components/HelpHub.tsx');
  /*
    先把注释剥掉再查 —— 那段注释本身就在讲这个坑，
    连注释一起查的话，写清楚为什么反而会让测试失败。
    （这一招上次栽过一次：能力矩阵的解析器被我自己写的注释带偏了。）
  */
  const code = hub.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/offsetParent/.test(code),
    'offsetParent 对 fixed 元素恒为 null，不能用来判断弹窗可见');
  assert.match(hub, /getBoundingClientRect/, '没有按实际位置判断可见性');
  // 「文档里最后一个」不等于「盖在最上面那个」——AI 面板类名里也有 fixed inset-0
  assert.match(hub, /zIndex/, '没有按 z-index 取最上面那个弹窗');
});

test('每一页都有本页详解，而且都回答同样几个问题', () => {
  const src = read('src/modules/help/pageGuide.ts');
  const { PAGE_GUIDES, MODAL_GUIDES, findPageGuide, findModalGuide } = requireTs(src);

  // 有导航的页面都要有，缺一页就是「点了帮助说没写」
  ['/dashboard', '/leads', '/customers', '/contracts', '/projects', '/finance',
    '/audit', '/knowledge', '/intel', '/strategy', '/ai-center', '/employees', '/auth-audit']
    .forEach((p) => assert.ok(findPageGuide(p), `${p} 没有本页详解`));

  // 子路由要能落到父页面，否则 /finance/settlements 点帮助是空的
  assert.ok(findPageGuide('/finance/settlements'), '子路由找不到详解');

  PAGE_GUIDES.concat(MODAL_GUIDES).forEach((entry) => {
    const g = entry.guide;
    assert.ok(g.what && g.what.length > 10, `${g.title}：没说清这一块负责什么`);
    assert.ok(Array.isArray(g.order) && g.order.length >= 2, `${g.title}：没写使用顺序`);
    assert.ok(Array.isArray(g.areas) && g.areas.length >= 1, `${g.title}：没写各块各管什么`);
  });

  // 弹窗按标题认 —— 各页面不用为了帮助改结构
  assert.ok(findModalGuide('极速立项'), '新建项目弹窗认不出来');
  assert.ok(!findModalGuide('某个没写过的弹窗'), '没写过的弹窗应该退回讲整页');
});

test('单项解释：常用动作都要说到，而且要纠正一个具体误解', () => {
  const src = read('src/modules/help/controlGuide.ts');
  const { explainControl } = requireTs(src);

  // 后果重的动作必须有专门说明，不能落到通用兜底
  [
    ['确认到账', 'button'], ['停用', 'button'], ['删除账号', 'button'],
    ['重置密码', 'button'], ['与我相关', 'button'], ['导出', 'button'],
    ['工作日志', 'button'], ['生成摘要', 'button'], ['其他事务', 'button'],
    ['合同项目', 'button'], ['跟进项目', 'button'],
  ].forEach(([name, kind]) => {
    const help = explainControl(name, kind);
    assert.ok(help.matched, `「${name}」没有专门的说明，会落到通用兜底`);
  });

  // 有后果的要写清后果
  assert.ok(explainControl('确认到账').warn, '「确认到账」没写后果');
  assert.ok(explainControl('删除账号').warn, '「删除账号」没说清为什么删不掉');

  // 认不出来的也要给一句像样的话，不能是「暂无说明」
  const unknown = explainControl('某个没见过的东西', 'select');
  assert.equal(unknown.matched, false);
  assert.ok(unknown.what.length > 5 && !/暂无/.test(unknown.what),
    '认不出来时给的是「暂无说明」——比没有这个功能更让人失望');

  // 具体的要排在笼统的前面：「确认到账」不能被「确认」抢走
  assert.notEqual(explainControl('确认到账').what, explainControl('确认').what,
    '「确认到账」被笼统的「确认」规则抢走了');
});

/** 把这两个纯数据 TS 模块转成能 require 的 JS —— 它们只有类型标注，没有运行时依赖 */
function requireTs(source) {
  const js = source
    .replace(/^import[\s\S]*?;$/gm, '')
    .replace(/^export interface[\s\S]*?^}/gm, '')
    .replace(/^export type .*?;$/gm, '')
    .replace(/^interface [\s\S]*?^}/gm, '')
    .replace(/: readonly \{[\s\S]*?\}\[\]/g, '')
    .replace(/: Record<[^=]*?>/g, '')
    .replace(/: \{ path: string; guide: GuideEntry \}\[\]/g, '')
    .replace(/: \{ match: RegExp; guide: GuideEntry \}\[\]/g, '')
    .replace(/: Rule\[\]/g, '')
    .replace(/: ProjectCategory\[\]/g, '')
    .replace(/\(([a-zA-Z]+): [A-Za-z<>|'\s]+?(=\s*'[a-z]+')?\)\s*=>/g, '($1) =>')
    .replace(/: (GuideEntry|ControlHelp|ControlKind|HTMLElement|string|number|boolean)(\s*\|\s*null)?(\s*&\s*\{[^}]*\})?(?=[\s),=])/g, '')
    .replace(/export const/g, 'const')
    .replace(/export /g, '');
  const names = [...source.matchAll(/export const (\w+)/g)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn {${names.join(',')}};`)();
}
