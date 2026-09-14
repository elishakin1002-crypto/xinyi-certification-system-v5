// 「删了刷新又回来」+「提醒越挂越多」—— 两个老毛病的根治。
//
// 2026-09-14 金恩来：
//   「我希望合同删了又回来了是真的解决了，更希望你踩过的每一个坑，
//     都能吃一堑长三智。」
//   「提醒直接按你的建议 1-6 顺序直接做掉。」
//
// ── 「删了又回来」的病根 ────────────────────────────────────
//
// 两套存储：关系表（服务端写、SQL 统计读）和状态库（前端整份读、整份写回）。
// 后端删一条，状态库那份数组里还在，前端下次整份写回 —— 它就回来了。
// **全程没有任何报错**：删除接口 200，列表上也确实没了，刷新才发现它又在。
//
// 我自己栽过一次：他下令删的 6 篇死链文档，我只删了关系表那一半，
// 还报告「已删除」—— 那 6 条一直躺在状态库里等着被写回来。
//
// 解法是墓碑（tombstone）：删除时留一条「这个 id 已被删」，
// 之后任何整份写回都先过一遍墓碑。前端写回什么都无所谓 ——
// **删掉的东西在架构上回不来**，而不是"发现了再修"。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const strip = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
const code = (rel) => strip(fs.readFileSync(path.join(root, rel), 'utf8'));

const { DATASET_ENTITY, filterDeleted } = require(path.join(root, 'server/services/tombstones.js'));

// ══════════════ 删除墓碑 ══════════════

test('整份写回之前必须过一遍墓碑 —— 这是「删了又回来」的唯一根治点', () => {
  const store = code('server/stateStore.js');
  assert.match(store, /filterDeleted/, '写回路径没有按墓碑过滤');
  assert.match(
    store,
    /const filtered = await filterDeleted\([\s\S]{0,120}datasetKey, datasetValue\)/,
    '墓碑过滤没有真的作用在写回的那份数据上'
  );
  /*
    剔掉了要记日志。悄悄剔除和悄悄写回一样糟 ——
    真出问题时至少要能在日志里看见"这里剔了几条、哪几条"。
  */
  assert.match(store, /写回时剔掉 \$\{filtered\.removed\.length\} 条已删除记录/, '剔除没有留下日志');
});

test('墓碑要和删除在同一个事务里', () => {
  /*
    分开写的话，删成功而墓碑没记上，这条记录下次整份写回就又回来了 ——
    比不删还糟，因为人已经以为删掉了。
  */
  const repo = code('server/repos/knowledgeRepo.js');
  assert.match(repo, /withTransaction\(async \(client\)/, '删除没有放进事务');
  assert.match(repo, /recordDeletion\(/, '删除时没有记墓碑');
  assert.ok(
    !/await query\('DELETE FROM knowledge_docs/.test(repo),
    '又退回到「光删行、不记墓碑」了'
  );
});

test('墓碑要记下是谁删的 —— 删除原本是全系统唯一没留痕的动作', () => {
  const route = code('server/routes/knowledge.js');
  assert.match(route, /knowledgeRepo\.remove\(req\.params\.id, \{/, '删除没有把操作人带下去');
  assert.match(route, /userName: req\.authUser\?\.name/, '没有记录操作人姓名');
});

test('过滤只认识有删除路径的数据集，别的原样放行', async () => {
  /*
    过滤器是**删数据的代码**，默认必须是"不动"。
    一个不在名单里的数据集，宁可让它原样写回（最多是老 bug 没覆盖到），
    也不能因为"我不认识"就把内容剔掉 —— 那是凭空吞掉别人的数据。
  */
  const runner = async () => { throw new Error('不该查库'); };
  const rows = [{ id: 'A' }, { id: 'B' }];
  const r = await filterDeleted(runner, '不存在的数据集_v9', rows);
  assert.deepEqual(r.value, rows, '不认识的数据集被动了');
  assert.deepEqual(r.removed, [], '不认识的数据集不该有剔除记录');
});

test('被删过的 id 会被剔掉，其余原样留下', async () => {
  const runner = async () => ({ rows: [{ entity_id: 'DOC-2' }] });
  const r = await filterDeleted(runner, 'knowledge_docs_v8', [
    { id: 'DOC-1' }, { id: 'DOC-2' }, { id: 'DOC-3' }
  ]);
  assert.deepEqual(r.value.map((x) => x.id), ['DOC-1', 'DOC-3'], '该剔的没剔或者剔多了');
  assert.deepEqual(r.removed, ['DOC-2']);
});

test('重新建同一个 id 时墓碑要能撤销', () => {
  /*
    真实场景：删错了，重新录一遍，沿用原来的编号。
    不撤墓碑的话，新建的那条会被过滤器当成"已删的"剔掉，
    人只会看到「录进去了、刷新就没」—— 和原 bug 一模一样，方向相反。
  */
  const src = code('server/services/tombstones.js');
  assert.match(src, /const clearTombstone = /, '没有撤销墓碑的办法');
  assert.match(src, /DELETE FROM deleted_records WHERE entity_type = \$1 AND entity_id = \$2/, '撤销没有真的删墓碑');
});

test('有删除接口的资源都要在墓碑名单里', () => {
  /*
    新增了删除接口却忘了登记，症状就是老 bug 在那个资源上复发 ——
    而且照样不报错。所以这条对着真实的删除路由清点名单。
  */
  const routeDir = path.join(root, 'server/routes');
  const deleted = new Set();
  for (const f of fs.readdirSync(routeDir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(routeDir, f), 'utf8');
    for (const m of src.matchAll(/router\.delete\(\s*'\/api\/([a-z-]+)/g)) deleted.add(m[1]);
  }
  const covered = new Set(Object.values(DATASET_ENTITY));
  const alias = { knowledge: 'knowledge', contracts: 'contract', customers: 'customer', leads: 'lead', projects: 'project', reminders: 'reminder', settlements: 'settlement' };
  for (const res of deleted) {
    const entity = alias[res];
    if (!entity) continue;   // uploads 之类不是业务实体
    assert.ok(covered.has(entity), `${res} 有删除接口，但墓碑名单里没有它 —— 删了会再回来`);
  }
});

// ══════════════ 提醒生命周期 ══════════════

test('列提醒默认只给待办，不许把过期的一起端出来', () => {
  /*
    生产实测：228 条提醒、**0 条被读过**、205 条已过期、最早七个月前。
    不是"提醒有点多"，是提醒栏彻底失效 ——
    人看一眼全是过期的就再也不看了，真正要紧的那条跟着被埋。
  */
  const repo = code('server/repos/reminderRepo.js');
  assert.match(repo, /status = 'open'/, 'list 没有默认只给待办');
  const route = code('server/routes/reminders.js');
  assert.match(route, /status: req\.query\.status \|\| 'open'/, '接口层没有默认只给待办');
});

test('「办完了」和「已读」必须是两件事', () => {
  /*
    已读 = 我看见了；办完 = 事情处理完了。
    原来只有已读，而标已读既不代表做了、也不让它消失 ——
    所以 228 条一条都没人标。那不是同事偷懒，是设计没给出口。
  */
  const repo = code('server/repos/reminderRepo.js');
  assert.match(repo, /resolve: async \(id\)/, 'repo 没有「办完」这个动作');
  assert.match(repo, /status='done', resolved_at=NOW\(\)/, '办完没有落到 status 上');

  const route = code('server/routes/reminders.js');
  assert.match(route, /'\/api\/reminders\/:id\/resolve'/, '没有「办完」接口');

  const svc = code('services/reminderService.ts');
  assert.match(svc, /resolveReminder: async/, '前端服务没有「办完」');

  const layout = code('components/Layout.tsx');
  assert.match(layout, /办完了/, '提醒面板上没有「办完了」按钮 —— 有接口没入口等于没做');
});

test('重复生成同一条系统提醒要幂等，不能 500', () => {
  /*
    加了 dedupe_key 唯一索引之后，第一版实跑直接 500 ——
    唯一约束冲突原样抛了出去。
    但系统提醒**本来就会反复生成**（每次跑生成逻辑都来一遍），
    这不是错误。500 会让前端以为写失败，弹一个根本不存在的错误给同事看。
  */
  const repo = code('server/repos/reminderRepo.js');
  assert.match(repo, /e\?\.code === '23505'/, '没有处理唯一约束冲突');
  assert.match(repo, /SELECT \* FROM reminders WHERE dedupe_key = \$1 OR id = \$2/, '冲突时没有返回已存在的那条');
});

test('过期归档、孤儿清理、去重要自己每天跑，不是「有个脚本可以跑」', () => {
  /*
    这个项目已经栽过一次：npm run checkup 也是"有但没人跑"，
    于是页面达标情况没人看，做成了头重脚轻。
    状态历史 146MB 同理 —— 清理脚本一直都在，从来没人跑过。
  */
  const svc = code('server/services/reminderLifecycle.js');
  assert.match(svc, /const scheduleReminderLifecycle = /, '没有定时任务');
  assert.match(svc, /setInterval\(runOnce, DAY_MS\)/, '不是每天自动跑');

  const app = code('server/app.js');
  assert.match(app, /scheduleReminderLifecycle\(dbPool\)/, '定时任务写了但没挂上去');
});

test('孤儿清理只碰认识的类型 —— 猜错了是把别人的待办弄没', () => {
  const svc = code('server/services/reminderLifecycle.js');
  assert.match(svc, /const LINK_TABLES = Object\.freeze\(\{/, '没有显式的类型→表映射');
  assert.match(
    svc,
    /for \(const \[linkType, table\] of Object\.entries\(LINK_TABLES\)\)/,
    '清理没有按白名单来 —— 会误删不认识类型的提醒'
  );
});

test('业务记录删掉时，它的提醒要当场跟着走', () => {
  /*
    每日任务是兜底，但那是明天的事。
    人删完文档不该还要等到明天才看不见它的提醒。
  */
  const repo = code('server/repos/knowledgeRepo.js');
  assert.match(repo, /cascadeOnDelete\(pool, 'knowledge', id\)/, '删文档时没有带走它的提醒');
});

test('提醒面板要分「今天要做」和「之后」，截断了要说出来', () => {
  const layout = code('components/Layout.tsx');
  assert.match(layout, /今天要做/, '没有分级 —— 全挤一起等于没分');
  assert.match(layout, /还有 \{bellBuckets\.hidden\} 项没显示/, '截断了没说出来，人不知道后面还有多少');
  assert.match(layout, /const BELL_LIMIT = /, '没有上限，会变成无限滚动');
});

// ══════════════ 状态历史去重 ══════════════

test('内容没变就不写历史 —— 4002 版里 88% 是逐字节相同的副本', () => {
  /*
    金恩来：「数据库的备份怎么会有 4002 份这么多？这完全不合理啊！」
    他是对的。实测：
      leads_v8          382 版 → 去重后 43 种，191 MB
      market_signals_v1 313 版 → 去重后 **2** 种，94 MB
  */
  const store = code('server/stateStore.js');
  assert.match(store, /const contentHash = crypto\.createHash\('md5'\)/, '没有算内容哈希');
  assert.match(
    store,
    /if \(prev\?\.content_hash !== contentHash\) \{/,
    '算了哈希但没拿它做判断 —— 等于没去重'
  );
  assert.match(
    store,
    /ORDER BY id DESC LIMIT 1/,
    '比的不是同一个数据集的上一版 —— 全表去重会把 A→B→A 的中间那次回退吃掉'
  );
});

test('清理要每天自己跑；普通 VACUUM 不还磁盘这件事要写明白', () => {
  const svc = code('server/services/stateHistoryRetention.js');
  assert.match(svc, /const scheduleStateHistoryPrune = /, '没有定时任务');
  /*
    我第一版写的是 VACUUM (ANALYZE)，注释里还特意写着「不然人看着以为没生效」，
    然后实跑：4235 条删到 1593 条，**磁盘 167.7MB → 167.7MB，一个字节没降**。
    普通 VACUUM 只把空间标成可复用，要还给系统得 VACUUM FULL（会锁表）。
  */
  assert.match(svc, /reclaimDisk \? 'VACUUM FULL ANALYZE/, '没有区分两种 VACUUM');
  assert.match(svc, /diskNote/, '返回值没有说清"磁盘到底降没降" —— 会把行数变少报成省了空间');
});
