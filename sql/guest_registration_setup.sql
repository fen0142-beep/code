-- ══════════════════════════════════════════════
-- 訪客報名功能 — 資料庫調整
-- 在 Supabase Dashboard → SQL Editor 執行一次即可
-- ══════════════════════════════════════════════

-- 1. 允許 student_id 為 NULL（訪客沒有學員帳號）
ALTER TABLE registrations ALTER COLUMN student_id DROP NOT NULL;
