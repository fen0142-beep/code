-- =============================================================
-- 訪客電話自動清除 — Supabase pg_cron
-- 建立日期：2026-05-17
-- 用途：活動結束 7 天後，自動把訪客報名 (registrations.answers.guest_phone) 刪掉
-- 個資原則：親友電話只用於活動期間聯絡，活動結束就不該再保留
-- =============================================================

-- ───────────────────────────────────────────────────────────────
-- Step 1：啟用 pg_cron extension（Supabase Dashboard → Database → Extensions
--         也可以勾選 UI 啟用；若已啟用，這行會自動跳過）
-- ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ───────────────────────────────────────────────────────────────
-- Step 2：先把可能已存在的同名任務移除（重跑這份 SQL 不會撞名）
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('clean-guest-phone');
EXCEPTION WHEN OTHERS THEN
  -- 第一次跑、還沒這個任務，會跳例外，直接吞掉
  NULL;
END $$;


-- ───────────────────────────────────────────────────────────────
-- Step 3：排程「每天 03:00（台北時間）清除過期訪客電話」
-- pg_cron 時間以 UTC 為準，台北 = UTC+8，所以 03:00 台北 = 19:00 UTC 前一天
-- 也就是 cron 表達式裡的 19:00 UTC
-- ───────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'clean-guest-phone',
  '0 19 * * *',  -- 每天 UTC 19:00 = 台北 03:00 凌晨
  $$
  UPDATE registrations r
     SET answers = r.answers - 'guest_phone'
    FROM events e
   WHERE r.event_id = e.event_id
     AND r.student_id IS NULL                                    -- 只動訪客 reg
     AND r.answers ? 'guest_phone'                               -- 真的有電話才更新
     AND e.date_end IS NOT NULL                                  -- 活動有設結束日
     AND e.date_end < (CURRENT_DATE - INTERVAL '7 days');        -- 結束超過 7 天
  $$
);


-- ───────────────────────────────────────────────────────────────
-- Step 4：驗證任務已建立（執行後應看到一筆 jobname=clean-guest-phone）
-- ───────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'clean-guest-phone';


-- ===============================================================
-- 維護指令備忘（需要時手動執行）
-- ===============================================================

-- ◉ 立刻手動跑一次（驗證 SQL 語法、想立刻清舊資料時用）
--   UPDATE registrations r
--      SET answers = r.answers - 'guest_phone'
--     FROM events e
--    WHERE r.event_id = e.event_id
--      AND r.student_id IS NULL
--      AND r.answers ? 'guest_phone'
--      AND e.date_end IS NOT NULL
--      AND e.date_end < (CURRENT_DATE - INTERVAL '7 days')
--   RETURNING r.registration_id, r.event_id;   -- 看清掉哪幾筆

-- ◉ 看最近一次執行紀錄
--   SELECT * FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'clean-guest-phone')
--    ORDER BY start_time DESC LIMIT 5;

-- ◉ 暫停任務（停用但保留設定）
--   UPDATE cron.job SET active = false WHERE jobname = 'clean-guest-phone';

-- ◉ 重啟任務
--   UPDATE cron.job SET active = true  WHERE jobname = 'clean-guest-phone';

-- ◉ 永久移除任務
--   SELECT cron.unschedule('clean-guest-phone');
