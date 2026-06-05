-- ============================================================
-- 新增欄位類型：plate（車牌）、datetime（日期時間）
-- 請在 Supabase SQL Editor 執行此檔案
-- ============================================================

-- 方案一：若 field_type 是 PostgreSQL 原生 enum 類型
-- （大多數情況請先試這個）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'field_type'
  ) THEN
    ALTER TYPE field_type ADD VALUE IF NOT EXISTS 'plate';
    ALTER TYPE field_type ADD VALUE IF NOT EXISTS 'datetime';
    RAISE NOTICE '✅ 已新增 plate、datetime 到 field_type enum';
  ELSE
    RAISE NOTICE '⚠️  找不到 field_type enum，請改用方案二';
  END IF;
END
$$;

-- ============================================================
-- 方案二：若 field_type 是 TEXT + CHECK constraint
-- 若方案一執行後沒效果，請把下方三行取消註解再執行
-- ============================================================
-- ALTER TABLE event_fields DROP CONSTRAINT IF EXISTS event_fields_field_type_check;
-- ALTER TABLE event_fields
--   ADD CONSTRAINT event_fields_field_type_check
--   CHECK (field_type IN ('radio', 'checkbox', 'text', 'date', 'time', 'plate', 'datetime'));
