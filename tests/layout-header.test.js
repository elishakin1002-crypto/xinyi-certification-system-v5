// 头部在窄屏下不能把功能弄丢。
//
// 2026-09-10 金恩来：「在平板尺寸下，我的角色头像都找不到了。」
//
// 查下来是**两个独立的原因**，各自都能单独让头像消失：
//
//   ① 低于 768px 走的是手机端头部（flex md:hidden），
//      而那份头部里压根没有账号入口 —— 切换视角、我的登录设备、
//      AI 用量、**连退出登录都没有**。共用电脑上换个人用都做不到。
//
//   ② 768px 那一档走的是桌面端头部，但侧边栏占掉 256px 后
//      头部只剩 512px，却要塞下 标题 + 288px 搜索框 + 283px 图标组 = 646px。
//      溢出的部分被 justify-between 推到右边裁掉，
//      **头像正好是最右边那个**，于是整个不见了。
//
// 这两条都属于「不报错，但一直是错的」：页面能打开、控制台没红字，
// 只是某个入口悄悄没了，而没人会为「我找不到退出按钮」提 bug。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'components/Layout.tsx'), 'utf8');

// 注释里就在讲这些坑，连注释一起查会把自己带偏（坑 #26 的教训）
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('账号入口在手机端和桌面端都要有，而且是同一份实现', () => {
  assert.match(code, /const renderAccountMenu\s*=/, '账号菜单没有抽成可复用的一份');

  /*
    两个头部各调一次。**并排写两份长得像的 JSX 迟早只改其中一份** ——
    这个文件里已经栽过一次：铃铛写了两份，2026-09-02 改桌面端时差点漏掉手机端，
    结果会是「电脑上点有反应、手机上没反应」，而同事多半在手机上看提醒。
  */
  // 只数**调用**：定义写成 `renderAccountMenu = (`，中间有个 =，不会被这条匹配到
  const calls = code.match(/\{\s*renderAccountMenu\s*\(/g) || [];
  assert.equal(calls.length, 2,
    `renderAccountMenu 被调用 ${calls.length} 次，应该是 2 次（手机端头部 + 桌面端头部）—— 有一端漏了账号入口`);

  // 手机端那次要传 compact：完整版的姓名+视角+箭头在 56px 高的窄头部里放不下
  assert.match(code, /renderAccountMenu\(true\)/, '手机端没有用紧凑版');
});

test('退出登录不能只存在于桌面端', () => {
  /*
    退出登录是全系统最不该消失的按钮。
    2026-08-24 之前全应用根本没有退出入口，同事登进去就出不来；
    现在它藏在账号菜单里，所以「账号菜单在不在」等于「退不退得出去」。
  */
  const menu = code.slice(code.indexOf('const renderAccountMenu'));
  assert.match(menu, /handleLogout/, '账号菜单里没有退出登录');
  assert.match(menu, /我的登录设备/, '账号菜单里没有「我的登录设备」');
});

test('头部右侧那一组不许被搜索框挤掉', () => {
  /*
    这一条是 ② 的根因。判据不是「宽度是多少」，是**谁该让位**：
    空间不够时让位的必须是搜索框，不能是账号入口。
  */
  assert.ok(!/w-72[^"]*"[^>]*placeholder="搜索全局数据/.test(code)
    && !/placeholder="搜索全局数据[\s\S]{0,200}?\bw-72\b/.test(code),
    '全局搜索框又写死成 w-72 了 —— 窄屏下它会把右边的头像挤出屏幕');

  const rightGroup = code.match(/<div className="flex items-center space-x-5[^"]*"/);
  assert.ok(rightGroup, '找不到头部右侧图标组，测试要跟着结构改');
  assert.match(rightGroup[0], /shrink-0/,
    '右侧图标组（反馈/帮助/铃铛/头像）没有 shrink-0，空间不够时会被挤掉');
});
