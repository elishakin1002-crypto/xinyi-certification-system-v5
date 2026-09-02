// 整份状态同步只推送「从服务端加载过的」数据集。
//
// ── 这条规则解决什么 ──────────────────────────────────────────
// 以前是无差别推送 18 个数据集：不管这个浏览器手里那份是从服务端拿的、
// 从 localStorage 翻出来的、还是代码里的 MOCK 假数据，一律整份写回。
//
// 2026-09-02 线上现场：
//   project_work_logs_v1   推上来 0 条    而表里有 47 行
// 浏览器根本没加载过工作日志（那时还没有读接口），
// 却用一个空数组去覆盖了别人的数据。只因为「空数组不删表」才没酿成事故。
//
// 问题从来不是「两份都是真数据，该听谁的」，
// 而是「一份是真的，另一份根本不知道自己在说什么」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('只推送已加载的数据集', () => {
  const src = read('context/AppContext.tsx');
  assert.match(src, /const hydratedDatasetsRef = React\.useRef<Set<string>>/,
    '没有记录哪些数据集是真从服务端加载过的');
  assert.match(src, /Object\.entries\(datasets\)\.filter\(\(\[key\]\) => hydrated\.has\(key\)\)/,
    '推送前没有按「加载过」过滤');
  assert.match(src, /if \(Object\.keys\(syncable\)\.length === 0\) return;/,
    '一个都没加载过时应该整批不推，而不是推一批空数组上去');
});

test('八个业务数据集在加载成功后打标', () => {
  const src = read('context/AppContext.tsx');
  for (const key of [
    'leads_v8', 'customers_v8', 'contracts_v8', 'projects_v8',
    'market_signals_v1', 'knowledge_docs_v8', 'settlements_v8', 'reminders_v8',
  ]) {
    assert.match(src, new RegExp(`markHydrated\\('${key}'\\)`), `${key} 加载后没有打标，会被漏推`);
  }
});

test('本机状态不推给全公司', () => {
  /*
    current_user_id / current_role 是「我现在以谁的身份在看」，
    推上去等于把自己的 UI 状态写给所有人。
    user_profiles_v1 的真相源是 auth_users —— 2026-08-28 的 11 个账号
    就是被某个浏览器的内存副本覆盖没的。

    这些键没有对应的 markHydrated 调用，所以过滤那一步会自然把它们挡在外面。
    这条测试守的是「不要哪天顺手给它们补上打标」。
  */
  const src = read('context/AppContext.tsx');
  for (const key of ['current_user_id', 'current_role', 'user_profiles_v1', 'ai_decision_logs_v1']) {
    assert.doesNotMatch(src, new RegExp(`markHydrated\\('${key}'\\)`),
      `${key} 被标成了「可推送」—— 它不该覆盖服务端`);
  }
});

test('工作日志、任务模板、不符合项有了服务端读', () => {
  /*
    补这三个读接口是上面那条规则能生效的前提：
    不给它们读路径就永远「没加载过」，那三个模块等于只剩本地副本。
  */
  const routes = read('server/routes/batch5.js');
  assert.match(routes, /mount\('work-logs'/, '工作日志没有服务端路由');
  assert.match(routes, /mount\('task-templates'/, '任务模板没有服务端路由');

  const app = read('server/app.js');
  assert.match(app, /app\.use\(batch5Router\);/, 'batch5 路由没有挂进 app');
  assert.match(app, /pathname\.startsWith\('\/api\/work-logs'\)/,
    '/api/work-logs 不在鉴权名单里，会拿不到 req.authUser');
  assert.match(app, /pathname\.startsWith\('\/api\/task-templates'\)/,
    '/api/task-templates 不在鉴权名单里');

  const ctx = read('context/AppContext.tsx');
  for (const [svc, key] of [
    ['workLogService', 'project_work_logs_v1'],
    ['taskTemplateService', 'task_templates_v1'],
    ['auditIssueService', 'audit_issues_v1'],
  ]) {
    assert.match(ctx, new RegExp(`${svc}\\.isReadEnabled\\(\\)`), `${svc} 没有接进加载流程`);
    assert.match(ctx, new RegExp(`markHydrated\\('${key}'\\)`), `${key} 加载后没打标`);
  }
});

test('生产配置默认打开这三个开关', () => {
  // 关掉就退回本地副本模式，多人同时用会互相覆盖
  const env = read('deploy/make-prod-env.mjs');
  for (const k of [
    'VITE_BATCH5_API_ENABLED', 'VITE_BATCH5_API_READ_ENABLED',
    'VITE_AUDIT_API_ENABLED', 'VITE_AUDIT_API_READ_ENABLED',
  ]) {
    assert.match(env, new RegExp(`${k}: '1'`), `${k} 没有在生产配置里打开`);
  }
});
