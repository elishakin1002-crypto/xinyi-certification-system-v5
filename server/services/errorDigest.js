// 每日错误摘要：把前端收集到的错误主动推给技术负责人。
//
// ── 为什么必须是「推」，不是「看」 ────────────────────────────
// 这家公司没有专职运维，技术这边只有一个人，而且事很多。
// 任何需要「记得每天去打开某个页面看一眼」的方案，
// 实践中的结局都是前两天看、第三天忘、然后再也不看。
//
// 所以设计成：**系统每天来找你一次，没事就不吵**。
//
// ── 只报三类，其余一律不打扰 ──────────────────────────────────
//   ① 新出现的错误（昨天还没有，今天冒出来了）
//   ② 影响多人的（一个人碰到可能是他电脑的问题，三个人碰到就是系统的问题）
//   ③ 高频的（同一个错误一天几百次，说明有人正卡在那儿反复试）
//
// 已经标记 ack / fixed / ignored 的不再重复报 ——
// 报过一次还天天报，等于逼人把整个通知渠道静音。
const pool = require('../db/pool');
const { notifyAdmin } = require('./notifyService');

const THRESHOLD_USERS = 2;    // 影响到 2 个人以上
const THRESHOLD_COUNT = 20;   // 或者一天发生 20 次以上

/** 取今天值得报的错误。 */
const collectDigest = async () => {
  if (!pool.isEnabled()) return { rows: [], total: 0 };

  const res = await pool.query(`
    SELECT fingerprint, kind, message, source, route, count,
           COALESCE(array_length(user_ids, 1), 0) AS affected,
           first_seen_at, day
    FROM client_errors
    WHERE day = CURRENT_DATE
      AND status = 'new'
      AND (
        -- 今天第一次出现（不是从昨天延续下来的老问题）
        first_seen_at::date = CURRENT_DATE
        OR COALESCE(array_length(user_ids, 1), 0) >= $1
        OR count >= $2
      )
    ORDER BY affected DESC, count DESC
    LIMIT 10
  `, [THRESHOLD_USERS, THRESHOLD_COUNT]);

  const totalRes = await pool.query(
    `SELECT COALESCE(SUM(count), 0)::int AS n FROM client_errors WHERE day = CURRENT_DATE`
  );
  return { rows: res.rows || [], total: totalRes.rows?.[0]?.n || 0 };
};

const kindLabel = { js: '页面报错', promise: '操作静默失败', api: '接口错误', render: '渲染失败' };

const buildMessage = ({ rows, total }) => {
  if (rows.length === 0) return '';
  const lines = [`【信义系统】今天有 ${rows.length} 个错误需要你看一下（总发生 ${total} 次）`, ''];
  rows.forEach((r, i) => {
    const where = r.route ? ` · ${r.route}` : '';
    lines.push(`${i + 1}. ${kindLabel[r.kind] || r.kind}${where}`);
    lines.push(`   ${String(r.message).slice(0, 120)}`);
    /*
      「几个人碰到」放在「几次」前面 ——
      一个人碰 100 次多半是他自己卡在那儿反复试，
      3 个人各碰 1 次说明这是所有人都会踩的坑，后者优先级高得多。
    */
    lines.push(`   影响 ${r.affected || '?'} 人，发生 ${r.count} 次`);
    lines.push('');
  });
  lines.push('详情：http://124.223.209.102 → 系统自检');
  return lines.join('\n');
};

/**
 * 跑一次摘要。没有值得报的就**什么都不发** ——
 * 「今日无异常」这种消息发几天之后，人就会开始无视这个渠道，
 * 等真出事那天它也一起被无视了。
 */
const runErrorDigest = async () => {
  try {
    const digest = await collectDigest();
    const text = buildMessage(digest);
    if (!text) return { sent: false, reason: '今天没有需要打扰的错误' };
    /*
      走管理通道，不走工作群。
      2026-09-03 配通道时发现 webhook 指向的是企业全员群 ——
      13 个同事进来后会天天收到「Cannot read properties of undefined」，
      而他们既看不懂也帮不上忙，几次之后就会开始无视这个群。
    */
    const result = await notifyAdmin(text);
    return { sent: Boolean(result?.ok), reason: result?.reason || '', count: digest.rows.length };
  } catch (error) {
    console.warn('[errorDigest] 生成失败:', error?.message || error);
    return { sent: false, reason: error?.message || String(error) };
  }
};

module.exports = { runErrorDigest, collectDigest, buildMessage };
