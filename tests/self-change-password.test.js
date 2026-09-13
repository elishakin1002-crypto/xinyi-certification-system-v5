// 「我想自己换个密码」必须有入口。
//
// 2026-09-13 金恩来：「我登录 admin 时没有提示要我修改密码，这还不是关键，
//                    关键是我自己要去修改密码也没有这个入口。」
//
// 改密码这一页本来就在（pages/ChangePassword.tsx），
// 但它只在 mustChangePassword=true 时挂出来 —— 首次登录被强制改完，
// 这个标记就没了，**这一页从此再也进不去**，
// 而 App.tsx 里 /change-password 还被写死成 Navigate 到工作台。
// 于是全系统 13 个人，谁都没法主动换密码。
//
// 这类「功能在，入口没了」的毛病看不出报错：页面能开、测试全绿、
// 控制台没红字，只是那件事做不到。只能靠把入口本身钉住。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
/** 扫源码先去注释 —— 上面这段注释里就写着「Navigate 到工作台」 */
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const app = read('App.tsx');
const layout = read('components/Layout.tsx');
const page = read('pages/ChangePassword.tsx');

test('/change-password 不能再是「跳回工作台」', () => {
  assert.ok(
    !/path="\/change-password" element=\{<Navigate to="\/dashboard"/.test(app),
    '这一页又被改回「一进来就跳走」了 —— 主动改密码就没有入口了'
  );
  assert.match(app, /SelfChangePassword/, '登录后的路由里没有挂主动改密码的页面');
});

test('账号菜单里要看得见「修改密码」', () => {
  /*
    入口位置：和「我的登录设备」挨着、在「退出登录」上面。
    都是"管我这个账号本身"的事，人找得到。
    桌面端和手机端共用 renderAccountMenu，所以钉一处就够两处。
  */
  assert.match(layout, /修改密码/, '账号菜单里没有「修改密码」');
  assert.match(
    layout,
    /navigate\('\/change-password'\)/,
    '「修改密码」没有真的跳到那一页'
  );
});

test('同一个表单两种用法，不许拆成两份', () => {
  /*
    首次登录强制改 和 主动改，校验逻辑、显示密码开关、错误文案完全一样。
    拆成两个页面必然有一边先过期 —— 这个项目里"同一件事有三处实现"
    已经是最高频的 bug 来源了。
  */
  assert.match(page, /variant\?: 'forced' \| 'self'/, '没有用 variant 区分两种来法');
  assert.match(page, /variant === 'self'/, 'variant 传进来了但没用上');
  const forms = (page.match(/<form /g) || []).length;
  assert.equal(forms, 1, `这一页出现了 ${forms} 个表单 —— 两种用法应该共用同一个`);
});

test('主动改完要明确说「已生效」，不能一闪就跳走', () => {
  /*
    人刚亲手输了新密码，最需要的一句是「存上了，下次用新的」。
    页面直接跳走，他只会怀疑到底改没改成，然后来问我。
  */
  assert.match(page, /新密码已生效/, '改成功后没有明确回执');
});

test('新密码和旧的一样要当场拦住', () => {
  /*
    后端可能接受（它只校验当前密码对不对），
    于是人以为换过了，实际还是那个被别人知道的密码。
  */
  assert.match(page, /newPassword === currentPassword/, '没拦「新旧密码一样」');
});

test('首次登录强制改这条路不许被改坏 —— 它本来是好的', () => {
  assert.match(
    app,
    /authUser\?\.mustChangePassword \?/,
    '首次登录强制改密码的分支没了'
  );
  assert.match(page, /首次登录修改密码/, '强制改那套标题没了');
});
