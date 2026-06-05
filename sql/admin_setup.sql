-- ══════════════════════════════════════════════
-- 後台管理頁面 — 一次性設定 SQL
-- 在 Supabase Dashboard → SQL Editor 執行
-- ══════════════════════════════════════════════

-- 1. 替 registrations 加入「報到時間」欄位
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- 2. 確認 anon 角色對 students 有 SELECT 權限
GRANT SELECT ON students TO anon;
GRANT SELECT ON student_classes TO anon;

-- 3. authenticated 角色（師父登入後）對 registrations 可 UPDATE
--    （通常已包含在 RLS policy，這裡補一道 GRANT 確保無誤）
GRANT UPDATE ON registrations TO authenticated;

-- ── 完成後可用以下查詢確認欄位存在 ──
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'registrations'
-- ORDER BY ordinal_position;
