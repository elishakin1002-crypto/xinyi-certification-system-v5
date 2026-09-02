// 数据集「缩水」检测。
//
// ── 防的是什么 ────────────────────────────────────────────────
// state store 是**整份数组写入**：前端把一整个数据集写回去。
// 只要有两个地方各持一份副本，后写的就会盖掉先写的——
// 2026-08-28 就这么丢过 11 个员工账号，**没有任何报错**。
//
// app_state_history 每次写都留完整快照，所以理论上都能翻回去。
// 但真正的问题是**没人会发现**：页面上就是「少了几条」，
// 等三个月后有人问「那个客户怎么没了」，备份早轮转掉了。
//
// 所以这批用例守的是「报警」，不是「拦截」——见下面第 4 条为什么。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const load = () => {
  const js = ts.transpileModule(read('src/modules/state_guard/shrinkage.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
};

test('整个清空永远算可疑，哪怕只有 1 条', () => {
  /*
    空数组最常见的来源**不是**「真的全删了」，
    而是「前端还没加载完就触发了一次写」。
    这两种在数据上一模一样，分不出来，所以一律报。
  */
  const { checkShrinkage } = load();
  assert.equal(checkShrinkage('customers_v8', 11, 0).suspicious, true);
  assert.equal(checkShrinkage('leads_v8', 1, 0).suspicious, true);
  assert.match(checkShrinkage('customers_v8', 11, 0).reason, /被清空/);
});

test('掉三成以上且至少 5 条才报', () => {
  /*
    两个条件都要满足：
    · 只看比例会误报小数据集（3 条变 2 条也是 33%，那多半就是删了一条）
    · 只看条数会漏掉小数据集的整批清空（所以上面单独判「清空」）
  */
  const { checkShrinkage } = load();
  assert.equal(checkShrinkage('leads_v8', 455, 300).suspicious, true, '掉了 155 条没报');
  assert.equal(checkShrinkage('leads_v8', 455, 450).suspicious, false, '只掉 5 条不该报（比例才 1%）');
  assert.equal(checkShrinkage('customers_v8', 11, 8).suspicious, false, '掉 3 条不该报（没到 5 条）');
  assert.equal(checkShrinkage('customers_v8', 30, 10).suspicious, true, '掉了 20 条、67% 没报');
});

test('正常增加和不变都不报', () => {
  // 误报多了，提示就会被当噪音忽略——那时它一点用都没有
  const { checkShrinkage } = load();
  assert.equal(checkShrinkage('leads_v8', 455, 460).suspicious, false);
  assert.equal(checkShrinkage('leads_v8', 455, 455).suspicious, false);
  assert.equal(checkShrinkage('leads_v8', 0, 10).suspicious, false, '从空开始不该报');
});

test('报警文案要说清「可能是旧数据覆盖了新数据」', () => {
  /*
    只说「少了 155 条」，人会以为是自己删的；
    点破「可能是旧副本覆盖」，才会想到去翻历史。
  */
  const { checkShrinkage } = load();
  const r = checkShrinkage('leads_v8', 455, 300);
  assert.match(r.reason, /155/, '没说清少了多少');
  assert.match(r.reason, /覆盖/, '没点破可能是覆盖导致的');
});

test('非数组的数据集不参与判定', () => {
  // current_user_id 这类是标量，比条数没有意义
  const { countOf } = load();
  assert.equal(countOf(['a', 'b']), 2);
  assert.equal(countOf('U-1'), -1);
  assert.equal(countOf({ a: 1 }), -1);
  assert.equal(countOf(null), -1);
});

test('检测只报警不拦截 —— 这是刻意的', () => {
  /*
    拦了就会误伤真实的批量删除（清理演示数据、退掉一批无效线索）。
    **一个会误伤的保护，最后一定会被要求关掉**——那时它一点用都没有。

    报警 + 完整历史 = 出事能查、能回滚；
    拦截 = 有时候不能干活。
  */
  const src = stripComments(read('server/stateStore.js'));
  const fn = src.slice(src.indexOf('const warnOnShrinkage'), src.indexOf('const upsertStateBatchPostgres'));
  assert.ok(fn.length > 0, '找不到检测函数');
  assert.ok(!/throw/.test(fn), '检测里有 throw —— 观察设施不该让保存失败');
  assert.match(fn, /catch/, '没有兜住异常，检测出错会连累保存');
});

test('可疑写入要记进账本，不能只打一行 console', () => {
  /*
    console 会被日志轮转冲掉，而这条记录是
    「某次保存吃掉了数据」的唯一长期证据，
    也是事后顺着时间点去 app_state_history 翻回去的线索。
  */
  const src = stripComments(read('server/stateStore.js'));
  const fn = src.slice(src.indexOf('const warnOnShrinkage'), src.indexOf('const upsertStateBatchPostgres'));
  assert.match(fn, /businessEventRepo/, '没有记进业务事件账本');
  assert.match(fn, /STATE_SHRINK_WARNING/, '没有可识别的事件类型，事后查不出来');
});

test('检测挂在写入路径上，而且在写之前', () => {
  // 写完再比就晚了——那时旧值已经被覆盖，比不出来
  const src = stripComments(read('server/stateStore.js'));
  const at = src.indexOf('await warnOnShrinkage(entries, meta)');
  const insertAt = src.indexOf('INSERT INTO app_state_latest');
  assert.ok(at > 0, '检测没有被调用');
  assert.ok(at < insertAt, '检测排在写入之后，那时旧值已经没了');
});

test('回溯工具存在，而且回滚前会强制备份', () => {
  /*
    「理论上能恢复」和「实际上恢复得了」是两回事。
    2026-09-01 之前 app_state_history 里躺着 1339 个版本，
    但**没有任何工具在用它**——真出事只能手写 SQL。
    保护措施不能只存在于「懂数据库的人在场」的时候。
  */
  const src = read('scripts/state-history.mjs');
  assert.match(src, /app_state_history/, '没有读历史表');
  for (const c of ['list', 'versions', 'diff', 'restore', 'prune']) {
    assert.match(src, new RegExp(`cmd === '${c}'`), `缺少 ${c} 子命令`);
  }
  const restoreFn = src.slice(src.indexOf('const restore ='), src.indexOf('const prune ='));
  // 别写复杂正则：第一版写成 /\['"]run/，被解析成「字面的 ['"] 四个字符」而不是
  // 「[ 加一个引号」，于是永远匹配不上——测试红了，人却以为是业务代码坏了
  assert.ok(restoreFn.includes("execFileSync('npm', ['run', 'backup']"), '回滚前没有强制备份');
  assert.match(restoreFn, /中止回滚/, '备份失败时没有中止');
});

test('回滚要走 upsertStateBatch，让回滚本身也可逆', () => {
  /*
    直接 UPDATE 表的话，被覆盖掉的「当前版本」就永远没了——
    回错了没法再回来。走正常写入路径的话，
    当前值会先被记进历史，回滚本身是可撤销的。
  */
  const src = read('scripts/state-history.mjs');
  const restoreFn = src.slice(src.indexOf('const restore ='), src.indexOf('const prune ='));
  assert.match(restoreFn, /upsertStateBatch/, '回滚没走正常写入路径');
  assert.ok(!/UPDATE app_state_latest/.test(restoreFn), '直接改表了，回滚变成不可逆');
});

test('清理有保底条数，不能把某个数据集清空', () => {
  /*
    只按时间清的话，一个很久没改动的数据集会被清得一个版本不剩——
    而那种数据集恰恰是「出问题最久才被发现」的那类。
  */
  const src = read('scripts/state-history.mjs');
  assert.match(src, /keep-min|keepMin/, '没有保底条数');
  assert.match(src, /rn <= /, '没有按数据集分组保留最近 N 个版本');
});
