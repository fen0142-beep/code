-- 每週五台北時間 12:00（UTC 04:00）自動建立下一天（周六）的共修活動
-- 執行前請確認 pg_cron 已啟用（Supabase Dashboard → Database → Extensions → pg_cron）

SELECT cron.schedule(
  'create-weekly-gonxiu',           -- 排程名稱（唯一）
  '0 4 * * 5',                      -- 每週五 UTC 04:00 = 台北 12:00
  $$
  INSERT INTO events (
    name,
    date_start,
    date_end,
    status,
    event_type,
    walkin_mode,
    kiosk_open,
    offline_registration,
    show_on_activities,
    is_recurring
  )
  VALUES (
    TO_CHAR(
      (NOW() AT TIME ZONE 'Asia/Taipei') + INTERVAL '1 day',
      'YYYY/MM/DD'
    ) || ' 周六晚間共修',
    ((NOW() AT TIME ZONE 'Asia/Taipei') + INTERVAL '1 day')::date,
    ((NOW() AT TIME ZONE 'Asia/Taipei') + INTERVAL '1 day')::date,
    'active',
    'temple',
    true,    -- walkin_mode：自由刷卡
    true,    -- kiosk_open：出現在刷卡報到頁
    false,   -- offline_registration
    false,   -- show_on_activities：預設不顯示在介紹頁，需要時手動勾
    true     -- is_recurring：標記為定期活動
  );
  $$
);

-- 若需要修改或刪除此排程：
-- SELECT cron.unschedule('create-weekly-gonxiu');
