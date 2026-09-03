-- 同事的问题反馈。
--
-- ── 和 client_errors 的分工 ───────────────────────────────────
--   client_errors  机器自动抓的：JS 崩溃、接口报错。**同事不知情**
--   feedback       人主动说的：用不明白、结果不对、希望改进。**机器抓不到**
--
-- 两者缺一不可。最难查的一类问题恰恰是「系统没报错，但结果不是他要的」——
-- 自动采集看不见，只有人能说。
--
-- ── 为什么要结构化，不给一个大文本框 ──────────────────────────
-- 让人自由描述，收到的会是「合同那里有问题」「点了没反应」这种。
-- 看的人要来回追问三轮才知道说的是什么，
-- 而追问的成本高到最后就不追了 —— 反馈渠道名存实亡。
--
-- 表单替人问出三件事：**你想做什么 / 结果怎么样 / 在哪一页**。
-- 第三件自动填，前两件各一句话。目标是 30 秒填完 ——
-- 超过这个时间，人在忙的时候就不会填。

CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,

  -- 分类决定怎么处理，所以必须是选的不是写的
  --   bug      系统出错了
  --   confused 我不知道该怎么操作     ← 这类往往是设计问题，不是使用者的问题
  --   wrong    能用，但结果不对
  --   improve  希望能这样改
  kind          TEXT NOT NULL,

  -- 紧急程度也是选的。让人自己写「很急」「非常急」没法排序
  --   blocked  挡住干活了
  --   annoying 能绕过去但很烦
  --   later    不急，有空再说
  severity      TEXT NOT NULL DEFAULT 'annoying',

  intent        TEXT NOT NULL DEFAULT '',   -- 我当时想做什么
  actual        TEXT NOT NULL DEFAULT '',   -- 结果怎么样了
  expected      TEXT NOT NULL DEFAULT '',   -- 希望怎么样（改进类才填）

  -- 以下自动带上，不让人填。让人填这些等于把成本转嫁给最不该承担的人
  route         TEXT NOT NULL DEFAULT '',
  user_id       TEXT NOT NULL DEFAULT '',
  user_name     TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  app_version   TEXT NOT NULL DEFAULT '',

  -- 处理状态。new → ack（看到了）→ doing → done / wontfix
  status        TEXT NOT NULL DEFAULT 'new',
  reply         TEXT NOT NULL DEFAULT '',   -- 给提交人的回复
  handled_by    TEXT NOT NULL DEFAULT '',
  handled_at    TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 「还有哪些没处理」是最常查的
CREATE INDEX IF NOT EXISTS idx_feedback_status_created
  ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user
  ON feedback (user_id, created_at DESC);
