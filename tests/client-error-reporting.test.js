// 前端错误自动上报 + 每日摘要。
//
// ── 要解决的事 ────────────────────────────────────────────────
// 同事踩了 bug 基本不会说。不是不配合：他不确定这算 bug 还是自己不会用，
// 说清楚要费半天口舌，而手上有活要干、绕过去比报告快。
// 结果是问题一直在，技术这边一无所知。
//
// 改之前的可观测性是**零**：前端 JS 崩了、接口 500 了，
// 全都只留在那个人的浏览器控制台里，服务端一个字都没有。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');

test('采集是全自动的，不要求同事做任何事', () => {
  // 「遇到问题请截图发我」在实践中等于没有方案
  const src = read('services/errorReporter.ts');
  assert.match(src, /addEventListener\('error'/, '没有捕获 JS 崩溃');
  assert.match(src, /addEventListener\('unhandledrejection'/,
    '没有捕获未处理的 Promise —— 这类最容易漏，它不白屏，只是操作悄悄不生效');
  const entry = read('index.tsx');
  assert.match(entry, /installErrorReporter\(\);/, '入口没有装上报器');
  assert.ok(entry.indexOf('installErrorReporter()') < entry.indexOf('root.render'),
    '装在渲染之后了 —— 首屏就崩的那类错误会漏掉，而那恰恰最该被记录');
});

test('上报失败绝不能影响用户', () => {
  /*
    这条链路的意义是「顺手记一笔」。
    因为「错误上报接口挂了」而弹一个错给用户，是最荒唐的失败方式。
  */
  const client = read('services/errorReporter.ts');
  assert.match(client, /\.catch\(\(\) => \{/, '上报请求没有吞掉失败');
  const server = read('server/routes/clientErrors.js');
  assert.match(server, /catch \(error\) \{[\s\S]{0,200}return res\.status\(204\)\.end\(\)/,
    '服务端出错时没有静默返回 204');
});

test('攒批 + 本地去重，不能一条一个请求', () => {
  /*
    错误常常是连续爆发的（渲染循环里每秒几十次）。
    一条一个请求会把浏览器和服务器一起拖垮 ——
    观察设施反过来变成故障源。
  */
  const src = read('services/errorReporter.ts');
  assert.match(src, /const pending = new Map/, '没有攒批');
  assert.match(src, /hit\.count \+= 1/, '同一个错误在一批里没有合并计数');
  assert.match(src, /keepalive: true/,
    '页面卸载时普通 fetch 会被掐掉 —— 而「让用户关页面走人」的错误最该被看见');
});

test('服务端限流，防止观察设施变成故障源', () => {
  const src = read('server/routes/clientErrors.js');
  assert.match(src, /rateLimited/, '没有限流');
  assert.match(src, /rateBuckets\.delete/, '限流桶没有清理，Map 会随 IP 数无限增长');
});

test('脱敏：错误消息里的业务数据不能原样入库', () => {
  /*
    错误消息里经常带客户名、金额、手机号 —— 因为那些值就在出错的那行附近。
    这张表将来要拿出来看，不该把客户信息复制一份进去。
  */
  const src = read('server/routes/clientErrors.js');
  for (const [label, re] of [
    ['手机号', /<手机号>/], ['身份证', /<身份证>/], ['邮箱', /<邮箱>/], ['金额', /<金额>/],
  ]) {
    assert.match(src, re, `没有对${label}脱敏`);
  }
});

test('按指纹聚合，同一个 bug 一天只占一行', () => {
  /*
    一条一行的话，一个人的一次崩溃能写进去几千行，
    既打爆数据库，也让真正重要的那条淹掉。
  */
  const sql = read('db/migrations/019_前端错误上报.sql');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_client_errors_day_fp/,
    '没有 (day, fingerprint) 唯一索引，聚合无从谈起');
  const src = read('server/routes/clientErrors.js');
  assert.match(src, /ON CONFLICT \(day, fingerprint\) DO UPDATE/, '没有做 upsert 累加');
  assert.match(src, /replace\(\/\\d\+\/g, 'N'\)/,
    '指纹里没把数字换成占位符 —— 「第 3 项未定义」和「第 7 项」会算成两个 bug');
});

test('记录影响人数，不只是次数', () => {
  /*
    一个人碰 100 次多半是他卡在那儿反复试；
    3 个人各碰 1 次说明这是所有人都会踩的坑。后者严重得多，
    而只看次数的话前者排在前面。
  */
  const sql = read('db/migrations/019_前端错误上报.sql');
  assert.match(sql, /user_ids\s+TEXT\[\]/, '没有记录受影响的人');
  const src = read('server/routes/clientErrors.js');
  assert.match(src, /user_ids @> ARRAY/, '同一个人重复上报会把数组撑爆');
});

test('每日摘要主动推送，且没事不吵', () => {
  /*
    这家公司没有专职运维，技术只有一个人而且很忙。
    任何需要「记得每天去看一眼」的方案，结局都是前两天看、第三天忘。

    但反过来，「今日无异常」发几天之后人就开始无视这个渠道，
    等真出事那天它也一起被无视了。
  */
  const src = read('server/services/errorDigest.js');
  assert.match(src, /if \(!text\) return \{ sent: false/, '没有内容时也发了消息');
  assert.match(src, /status = 'new'/, '已经处理过的错误还在重复报');
  assert.match(src, /affected DESC, count DESC/,
    '按次数而不是按影响人数排序 —— 一个人卡 100 次会盖过 3 个人各踩 1 次');

  const app = read('server/app.js');
  assert.match(app, /scheduleErrorDigest\(\);/, '摘要任务没有启动');
  assert.match(app, /ERROR_DIGEST_HOUR \|\| 18/,
    '时间应该在傍晚：一天的坑都踩完了，看到还来得及当晚处理');
});

test('接口路由挂上了并且能拿到「是谁踩的」', () => {
  const app = read('server/app.js');
  assert.match(app, /app\.use\(clientErrorsRouter\);/, '路由没挂');
  assert.match(app, /pathname\.startsWith\('\/api\/client-errors'\)/,
    '不在鉴权名单里就拿不到 req.authUser —— 收一堆匿名错误，连去问谁都不知道');
});

test('401 不当成 bug 上报', () => {
  // 登录过期是正常流程。报了只会把真正的问题淹掉
  const src = read('services/errorReporter.ts');
  assert.match(src, /if \(status === 401\) return;/, '401 被当成错误上报了');
});

test('未登录也能上报 —— 会话过期时的错误最该被看见', () => {
  /*
    2026-09-02 踩到过：把 /api/client-errors 加进 isProtectedApiPath 之后，
    上报一律 401 —— 等于给最需要观察的场景装了个
    「只在一切正常时才工作」的探头。

    它需要知道是谁踩到的（不然连去问谁都不知道），
    但绝不能因为没登录就拒收。
  */
  const app = read('server/app.js');
  assert.match(app, /const isBestEffortIdentityPath/,
    '没有「尽力识别身份但不拒绝」的通道');
  assert.match(app, /isBestEffortIdentityPath\(req\.path\)\)\s*\{[\s\S]{0,600}return next\(\);/,
    '未登录时没有放行');
});

test('系统错误只发管理员，不发工作群', () => {
  /*
    2026-09-03：配好第一个 webhook 后发现它指向的是**企业全员群**。
    13 个同事进来后会天天收到「Cannot read properties of undefined」——
    他们既看不懂也帮不上忙。

    发几次之后全公司学会一件事：这个群的消息可以不看。
    而那时候，真正要紧的「某某证书下月到期」也一起被无视了。

    两条通道收的人和该做的事完全不同：
      业务通道 → 工作群，顾问看了知道该干什么
      管理通道 → 管理员群，只有技术能处理
  */
  const digest = read('server/services/errorDigest.js');
  assert.match(digest, /notifyAdmin\(text\)/, '错误摘要还在往业务群发');
  assert.doesNotMatch(digest, /= await notify\(text\)/, '还留着发工作群的旧写法');

  const notify = read('server/services/notifyService.js');
  assert.match(notify, /ADMIN_WEBHOOK_URL/, '没有独立的管理通道');
  /*
    没配管理通道时**不发**，不能退回业务群。
    退回去发一次，全公司就学会无视这个群 —— 宁可漏发。
  */
  assert.match(notify, /const notifyAdmin[\s\S]{0,400}if \(!url\)[\s\S]{0,300}ok: false/,
    '管理通道没配时应当直接不发，而不是退回业务群');
  assert.doesNotMatch(notify, /const notifyAdmin[\s\S]{0,500}NOTIFY_WEBHOOK_URL/,
    '管理通道退回了业务通道 —— 系统报错会倒进全公司的群');
});
