// 头部的下拉面板不能被自己的头部裁掉。
//
// 2026-09-11 金恩来：「小屏幕下，点击右上角的头像，没有出现身份和退出登录等内容」
//                    「之前让你找回角色头像，找回后你怎么没有进行测试？」
//
// 我测了，而且测「过」了 —— 判据错了。详见下面第一条。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.resolve(root, 'components/Layout.tsx'), 'utf8');
// 注释里就在讲这些坑，连注释一起查会把自己带偏（坑 #26）
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('手机端头部不许有 overflow-hidden —— 它会裁掉所有下拉面板', () => {
  /*
    根因：手机端 header 上挂着 overflow-hidden（本意是防长标题撑破布局），
    而账号菜单和铃铛面板都是 `absolute top-full` ——
    定位在头部**下边缘之外**。头部高 56px 且 overflow:hidden，
    于是这两个面板 100% 不可见，一个像素都画不出来。

    受害的不止账号菜单：**铃铛面板更早就是坏的**，只是一直没人报
    （手机上点铃铛没反应，大家以为是自己没点到）。

    长标题正确的处理是 truncate（该省略号的省略号），
    不是把整行连同下面垂出来的东西一起裁掉。
  */
  const mobileHeader = code.match(/<header className="([^"]*md:hidden[^"]*)"/);
  assert.ok(mobileHeader, '找不到手机端头部，测试要跟着结构改');
  assert.ok(!/\boverflow-hidden\b/.test(mobileHeader[1]),
    '手机端头部又加上了 overflow-hidden —— 账号菜单和铃铛面板会被整个裁掉，'
    + '而且**不报任何错**，只是点了没反应');
});

test('长标题靠 truncate 收，不靠裁掉整个头部', () => {
  // 去掉 overflow-hidden 之后，长标题必须有别的兜底，否则会把右边图标挤出去
  const mobileHeaderBlock = code.slice(code.indexOf('md:hidden h-14'), code.indexOf('hidden md:flex h-16'));
  assert.match(mobileHeaderBlock, /getPageTitle\(\)/, '没截到标题，测试要跟着结构改');
  assert.match(mobileHeaderBlock, /truncate/, '标题没有 truncate —— 去掉 overflow-hidden 后长标题会把图标挤出屏幕');
  assert.match(mobileHeaderBlock, /min-w-0/, '标题容器缺 min-w-0，flex 子项不会缩到内容以下，truncate 不生效');
});

test('可见性判据：不许再用 getBoundingClientRect 的尺寸当「可见」', () => {
  /*
    这一条盯的是**我自己的验证方法**，不是产品代码。

    2026-09-11 我用 `r.width>0 && r.height>0 && r.right<=innerWidth` 判定
    「菜单可见」，它回答 true，于是我报告「实测通过」。
    而真相是菜单被 overflow 裁掉了，一个像素都看不见。

    getBoundingClientRect 报的是**布局几何**，跟祖先有没有把它裁掉无关。
    同一类错误这个项目踩过第二次了（坑 #10：offsetParent 对 fixed 恒为 null）。

    正确判据只有一个：el.contains(document.elementFromPoint(x, y))
    —— 问「那个点上实际画着的是不是它」。
    overflow 裁剪、z-index 遮挡、opacity:0、被浮层盖住，全都能如实反映。
  */
  const probe = fs.readFileSync(path.resolve(root, 'scripts/ui-visibility-check.mjs'), 'utf8');
  assert.match(probe, /elementFromPoint/, '可见性检查没有用 elementFromPoint');
  assert.match(probe, /contains\(/, '没有判「那个点画的是不是它」');
  assert.match(probe, /overflow/, '不可见时没有找出裁掉它的祖先 —— 只说"不可见"等于让人自己再查一遍');
});

test('HelpHub 判弹窗可见也不能只看尺寸', () => {
  /*
    同一个判据要在整个代码库里一致。HelpHub 的「讲当前弹窗」逻辑
    2026-09-06 已经因为 offsetParent 栽过一次，它现在用
    getBoundingClientRect + 视口相交 + z-index —— 那是对**全屏浮层**的判法，
    在那个场景够用（全屏浮层不会被祖先裁）。

    这里钉住的是：它至少不能退回 offsetParent。
  */
  const hub = fs.readFileSync(path.resolve(root, 'components/HelpHub.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/offsetParent/.test(hub), 'HelpHub 又用回 offsetParent 了');
});
