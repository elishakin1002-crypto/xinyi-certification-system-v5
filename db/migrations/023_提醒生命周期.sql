-- 提醒：从「只增不减的清单」改成「有生命周期的待办」
--
-- ── 为什么（2026-09-14 金恩来：「提醒越挂越多，也是个问题」）──────
--
-- 生产上点了一下，比"多"严重得多：
--
--     类型         条数   已读   已过期   最早那条
--     risk          126     0     126    2026-02-10
--     expire         78     0      57    2026-02-09
--     opportunity    24     0      22    2026-02-10
--     ──────────────────────────────────────────
--     合计          228     0     205    七个月前
--
-- **228 条，一条都没被读过，205 条已经过期。**
-- 这不是"提醒有点多"，是提醒栏已经彻底失效 ——
-- 人看一眼全是七个月前的过期条目，就再也不看了，
-- 于是真正要紧的那条也被一起埋掉。整个功能等于没有。
--
-- ── 加的四个字段各自解决什么 ──────────────────────────────────
--
--   status       open / done / archived。
--                原来只有 is_read 一个布尔 —— 而「我看过了」和「这件事办完了」
--                完全是两回事。没有"办完"这个状态，提醒就没有退出机制。
--
--   resolved_at  什么时候办完的。留着是为了能回答「这条逾期当时多久才处理」。
--
--   archived_at  什么时候自动归档的。归档不是删除：过期的提醒还要能查
--                （「上个月那条到期提醒是不是发过？」），只是不该再挤在待办里。
--
--   dedupe_key   同一件事的稳定标识。系统提醒本来就用确定性 id（AUTO-XXX-实体id）
--                做去重，但那是**前端**的约定，服务端这边没有任何保证。
--                落成一列并加唯一索引，去重才是库级别的事实。
--
-- is_read 保留不动：老代码和前端都在用，这次不动它，避免上线前大改。
-- 语义上 is_read 从此只表示"看过没"，"办没办完"看 status。

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS dedupe_key text;

-- 只认这三个状态。写错状态的代码要当场报错，不能悄悄存进去 ——
-- 一个拼错的 'Done' 会让这条提醒在两边都查不到，而且没有任何报错。
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_status_check;
ALTER TABLE reminders ADD CONSTRAINT reminders_status_check
  CHECK (status IN ('open', 'done', 'archived'));

-- 系统提醒的 id 本身就是确定性的（AUTO-AR-DUE-合同id-应收id），
-- 直接拿来当去重键；人手建的提醒没有去重需求，留空。
UPDATE reminders SET dedupe_key = id WHERE dedupe_key IS NULL AND id LIKE 'AUTO-%';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_dedupe
  ON reminders (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 待办列表的主查询：status='open' 按日期排。
CREATE INDEX IF NOT EXISTS idx_reminders_status_date
  ON reminders (status, reminder_date DESC NULLS LAST);

/*
  存量的 205 条过期提醒一次性归档。

  为什么是归档不是删除：其中一部分是真实发生过的业务事件
  （某份合同确实在 3 月到期过），删了就再也说不清当时提醒过没有。
  归档之后待办栏干净了，要查还查得到。

  宽限 3 天：刚过期一两天的还该催，不能到点就藏起来。
*/
UPDATE reminders
   SET status = 'archived', archived_at = NOW()
 WHERE status = 'open'
   AND reminder_date IS NOT NULL
   AND reminder_date < CURRENT_DATE - INTERVAL '3 days';

COMMENT ON COLUMN reminders.status IS 'open=待办 / done=已办完 / archived=过期自动归档。is_read 只表示看过没，与此无关';
COMMENT ON COLUMN reminders.dedupe_key IS '同一件事的稳定标识（系统提醒用确定性 id）。唯一索引保证同一件事只有一条';
