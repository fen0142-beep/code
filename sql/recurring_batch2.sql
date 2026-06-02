-- Batch 2：定期範本自動建立
-- 1. events 加 template_id
-- 2. pg_cron：每天台北 07:00 建未來 14 天內應存在但還沒建的活動

-- ── Step 1：events 加 template_id ────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES recurring_templates(template_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_template_id ON events(template_id);

-- ── Step 2：自動建立函式 ─────────────────────────────────────────
-- 計算 weekly/monthly 範本在指定日期範圍內的所有出現日期，
-- 跳過已存在同 template_id + date_start 的活動，batch insert。

CREATE OR REPLACE FUNCTION create_recurring_events_in_range(
  p_template_id uuid,
  p_date_start  date,
  p_date_end    date
)
RETURNS int   -- 回傳新建筆數
LANGUAGE plpgsql
AS $$
DECLARE
  tmpl         recurring_templates%ROWTYPE;
  cur_date     date;
  event_name   text;
  created_cnt  int := 0;
BEGIN
  SELECT * INTO tmpl FROM recurring_templates WHERE template_id = p_template_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  cur_date := p_date_start;

  WHILE cur_date <= p_date_end LOOP
    -- 判斷 cur_date 是否符合週期
    IF (tmpl.frequency = 'weekly'  AND EXTRACT(DOW FROM cur_date)::int = tmpl.day_of_week)
    OR (tmpl.frequency = 'monthly' AND EXTRACT(DAY FROM cur_date)::int = tmpl.day_of_month)
    THEN
      -- 組活動名稱
      IF tmpl.prepend_date THEN
        event_name := to_char(cur_date, 'YYYY/MM/DD') || ' ' || tmpl.name;
      ELSE
        event_name := tmpl.name;
      END IF;

      -- 跳過已存在的（同 template_id + date_start）
      IF NOT EXISTS (
        SELECT 1 FROM events
        WHERE template_id = p_template_id
          AND date_start  = cur_date
      ) THEN
        INSERT INTO events (
          name, date_start, date_end,
          location, location_tag, event_type, status,
          walkin_mode, kiosk_open, offline_registration, show_on_activities,
          is_recurring, template_id
        ) VALUES (
          event_name, cur_date, cur_date,
          tmpl.location, tmpl.location_tag, tmpl.event_type, 'active',
          tmpl.walkin_mode, tmpl.kiosk_open, tmpl.offline_registration, tmpl.show_on_activities,
          true, p_template_id
        );
        created_cnt := created_cnt + 1;
      END IF;
    END IF;

    cur_date := cur_date + 1;
  END LOOP;

  RETURN created_cnt;
END;
$$;

-- ── Step 3：pg_cron — 每天台北 07:00（UTC 23:00 前一天）跑 ────────
-- 對所有 auto_create=true && active=true 的範本，建未來 14 天內的活動

SELECT cron.schedule(
  'auto_create_recurring_events',
  '0 23 * * *',   -- UTC 23:00 = 台北 07:00
  $job$
  DO $$
  DECLARE
    tmpl recurring_templates%ROWTYPE;
  BEGIN
    FOR tmpl IN
      SELECT * FROM recurring_templates
      WHERE auto_create = true AND active = true
    LOOP
      PERFORM create_recurring_events_in_range(
        tmpl.template_id,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '14 days'
      );
    END LOOP;
  END;
  $$ LANGUAGE plpgsql;
  $job$
);
