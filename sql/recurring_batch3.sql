-- Batch 3：定期範本套用動態欄位 + 過期活動自動關閉

-- ── Step 1：recurring_templates 加 fields 欄位 ─────────────────────
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS fields jsonb DEFAULT '[]';

-- ── Step 2：pg_cron — 每天台北 07:00 自動關閉過期活動 ───────────────
-- 所有 date_end < 今天 且 status = 'active' 的活動，一律改為 closed

SELECT cron.schedule(
  'auto_close_past_events',
  '0 23 * * *',   -- UTC 23:00 = 台北 07:00
  $job$
  UPDATE events
  SET status = 'closed'
  WHERE date_end < CURRENT_DATE
    AND status = 'active';
  $job$
);

-- ── Step 3：recurring_templates 加 volunteer_ids ────────────────────
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS volunteer_ids jsonb DEFAULT '[]';
