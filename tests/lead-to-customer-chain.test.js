// 线索 → 客户 这一步不许再断。
//
// ── 怎么发现的（2026-09-18）────────────────────────────────────
//
// 走「六条业务主线端到端」时发现：**销售建完线索，界面上没有任何
// 办法把它转成客户。** 只能去客户管理把公司名、联系人、电话重新录一遍，
// 而这些线索里全都有。
//
// 而服务端 `POST /api/leads/:id/convert` **一直都在**、LEAD_CONVERT 权限
// 也早分给了三个角色、实测调用完全正常（建客户 + 标记线索已转化）。
// 缺的只是前端从来没人调它。
//
// 连带后果：线索页「已转化 · 转化率」和销售工作台「销售转化率」
// **永远是 0** —— 两个卡片长期显示 0，人只会以为"销售不行"，
// 而不会想到"这条路根本走不通"。
//
// ── 为什么逐页逐钮清点发现不了它 ──────────────────────────────
//
// **每一页单独看都是好的，断的是页面之间那一步。**
// 286 次按钮点击、317 个数字对账、37 条字段口径，全都没碰到这个洞。
// 只有真的走一遍"销售的一天"才会撞上。这就是端到端这一层的价值。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('服务端的转客户接口还在，而且做了该做的两件事', () => {
  const src = read('server/routes/batch1.js');
  assert.match(src, /router\.post\(\s*'\/api\/leads\/:id\/convert'/,
    '转客户接口不见了 —— 前端那个按钮会 404');
  const seg = src.slice(src.indexOf("'/api/leads/:id/convert'"), src.indexOf("'/api/leads/:id/convert'") + 1600);
  assert.match(seg, /customerRepo\.create/, '转客户没建客户');
  assert.match(seg, /status:\s*'Converted'/, '转客户没把线索标成已转化 —— 转化率会一直是 0');
  assert.match(seg, /requireAction\('LEAD_CONVERT'/, '转客户接口没挂权限');
});

test('前端真的调了它 —— 接口在而没人调，等于没有', () => {
  /*
    这条是这个 bug 的核心：能力在后端躺了很久，前端没有入口。
    盯"有没有人调"，不盯某个按钮长什么样。
  */
  const svc = read('services/leadService.ts');
  assert.match(svc, /\/api\/leads\/\$\{encodeURIComponent\(leadId\)\}\/convert/,
    'leadService 没有调转客户接口');

  const page = read('pages/Leads.tsx');
  assert.match(page, /leadService\.convertToCustomer/,
    '线索页没有调 convertToCustomer —— 销售又没路可走了');
  assert.match(page, /LEAD_CONVERT/,
    '转客户按钮没查权限');
});

test('转完要重拉客户列表 —— 否则后端成功了界面不变', () => {
  /*
    建客户是服务端级联做的，前端手里的 customers 数组不知道多了一条。
    不重拉的话，跳到客户管理会看不到刚转的那家（直接打开能看到、
    F5 能看到，只有刚跳过去那一瞬间没有）——
    销售的第一反应是"我刚转的客户呢？"然后再转一次。
  */
  const page = read('pages/Leads.tsx');
  assert.match(page, /await refreshCustomers\(\)/,
    '转完没重拉客户列表 —— 这是"后端成功了，界面没变"的经典形状');
  const ctxSrc = read('context/AppContext.tsx');
  assert.match(ctxSrc, /refreshCustomers:\s*\(\)\s*=>\s*Promise<void>/,
    'AppContext 没有暴露 refreshCustomers');
});

test('转完要说清产生了什么、下一步去哪', () => {
  /*
    项目规矩：给用户的文案要说清后果和下一步。
    只弹「操作成功」不合格 —— 人不知道东西去哪了、接下来该干嘛。
  */
  const page = read('pages/Leads.tsx');
  const seg = page.slice(page.indexOf('handleConvertToCustomer'), page.indexOf('handleScheduleFollowUp'));
  assert.match(seg, /window\.confirm/, '这是不可撤销的动作，点之前要确认');
  assert.match(seg, /不能撤销/, '确认框没说清这一步不能撤销');
  assert.match(seg, /下一步/, '成功之后没告诉人下一步去哪');
});
