-- 前端错误上报。
--
-- ── 要解决什么 ────────────────────────────────────────────────
-- 同事踩了 bug 基本不会说。原因不是不配合：
--   ① 他不知道这算 bug 还是自己不会用
--   ② 说了要描述半天，还不一定说得清
--   ③ 他手上有活要干，绕过去比报告快
-- 结果就是问题一直在，而技术这边一无所知。
--
-- 而现在的可观测性是**零**：前端 JS 崩了、接口 500 了，
-- 全都只留在那个人的浏览器控制台里，服务端一个字都没有。
--
-- ── 为什么按指纹聚合，不是一条一行 ────────────────────────────
-- 前端错误最典型的形态是「一个渲染循环里每秒抛几十次」。
-- 一条一行的话，一个人的一次崩溃能写进去几千行，
-- 既打爆数据库，也让真正重要的那条淹掉。
--
-- 所以同一个指纹（错误类型+消息+位置）一天只占一行，累加 count。
-- 要看的是「有几种错、各发生了多少次、影响了几个人」，
-- 不是每一次的流水。

CREATE TABLE IF NOT EXISTS client_errors (
  id            TEXT PRIMARY KEY,
  -- 指纹：同一个 bug 的多次发生归到一行
  fingerprint   TEXT NOT NULL,
  day           DATE NOT NULL,

  kind          TEXT NOT NULL,        -- js / promise / api / render
  message       TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT '',   -- 文件:行:列，或接口路径
  stack         TEXT NOT NULL DEFAULT '',

  -- 上下文：光有错误信息定位不了问题，得知道谁在哪一步踩的
  route         TEXT NOT NULL DEFAULT '',   -- 出错时在哪个页面
  user_agent    TEXT NOT NULL DEFAULT '',
  app_version   TEXT NOT NULL DEFAULT '',

  count         INTEGER NOT NULL DEFAULT 1,
  -- 影响了几个人。一个人碰到 100 次和 10 个人各碰到 1 次，
  -- 严重程度完全不同，而只看 count 分不出来。
  user_ids      TEXT[] NOT NULL DEFAULT '{}',

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 处理状态：看过了/修了的不要每天再报一遍
  status        TEXT NOT NULL DEFAULT 'new',   -- new / ack / fixed / ignored
  note          TEXT NOT NULL DEFAULT ''
);

-- 同一天同一个指纹只有一行，靠它做 upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_errors_day_fp
  ON client_errors (day, fingerprint);

-- 「今天有哪些新错误」是最常查的一句
CREATE INDEX IF NOT EXISTS idx_client_errors_day_status
  ON client_errors (day DESC, status);

CREATE INDEX IF NOT EXISTS idx_client_errors_last_seen
  ON client_errors (last_seen_at DESC);
