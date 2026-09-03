// 系统管理员的 AI 要能诊断系统，而不是给一套人人都一样的话。
//
// ── 起因 ──────────────────────────────────────────────────────
// 2026-09-03 业务方反馈：以系统管理员登录，问 AI「你有哪些权限和功能」，
// 回答和其他角色没有区别。
//
// 两个原因，第二个是根本：
//   ① identityContext 里没有 SYS_ADMIN 的口径 —— AI 只知道他权限大，
//      不知道他是来管系统的
//   ② **它手上一个系统数据都没有**，只能拿常识作答，
//      说的全是「建议定期检查备份」这类放之四海皆准的废话
//
// 没有数据的诊断不叫诊断，叫算命。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('系统管理员有自己的说话口径', () => {
  const src = read('src/modules/ai_center/identityContext.ts');
  assert.match(src, /SYS_ADMIN:\s*\n?\s*'这个人负责系统的运行维护/,
    'SYS_ADMIN 没有专属口径，回答会和其他角色一样');
  assert.match(src, /他不是开发/,
    '没有说清他不是开发 —— 给他甩英文堆栈没有意义');
  assert.match(src, /先恢复服务、再查原因/,
    '没有给出处理顺序 —— 出事时最容易做反的就是这个');
});

test('把系统真实状态注入 AI 上下文', () => {
  const src = read('src/modules/ai_center/sysadminContext.ts');
  for (const [label, re] of [
    ['今日错误', /今日错误/],
    ['AI 用量', /AI 用量/],
    ['账号', /账号：共/],
    ['在线登录', /当前在线/],
  ]) {
    assert.match(src, re, `上下文里没有${label}`);
  }
  assert.match(src, /必须引用上面的具体数字/,
    '没有要求引用真实数字，模型会退回泛泛而谈');
  assert.match(src, /不要编/, '没有禁止编造 —— 缺数据时模型会自己补一个');
});

test('给判断依据，不给现成结论', () => {
  /*
    把结论写死，模型就只会照念，问什么都是同一段。
    写判断依据，它才能结合用户当下的问题回答。
  */
  const src = read('src/modules/ai_center/sysadminContext.ts');
  assert.match(src, /影响人数.*优先于次数/s,
    '没有告诉模型怎么排轻重 —— 它会按次数排，而那正好是错的');
  assert.match(src, /同一个人有多个登录是正常的/,
    '没说清多设备登录是正常的 —— 误报一次，下次真有异常他也不会信');
});

test('只有系统管理员能拿到这段', () => {
  /*
    这份数据里有 IP、登录时间、各人 AI 用量。
    顾问的 AI 不该知道谁几点从哪登录的。
  */
  const w = read('components/AIChatWidget.tsx');
  assert.match(w, /const isSysAdmin = [\s\S]{0,160}includes\('SYS_ADMIN'/,
    '没有按角色判断，可能所有人都拿到了系统状态');
  assert.match(w, /if \(isSysAdmin\) \{/, '没有用这个判断把取数圈起来');
});

test('取不到系统状态时不影响对话', () => {
  // 观察设施故障不该让 AI 用不了 —— 那是用小问题制造大问题
  const w = read('components/AIChatWidget.tsx');
  assert.match(w, /catch \{ \/\* 取不到就不注入，不影响对话 \*\/ \}/,
    '取数失败没有兜住');
});

test('系统状态有缓存，不是每句话查一次库', () => {
  const w = read('components/AIChatWidget.tsx');
  assert.match(w, /sysSnapshotAtRef/, '没有缓存时间戳');
  assert.match(w, /< 60_000/, '缓存窗口不是 60 秒');
});
