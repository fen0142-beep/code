-- 更新 event_fields.field_type CHECK 約束，加入 boolean 類型
-- 在 Supabase Dashboard → SQL Editor 執行此檔

ALTER TABLE event_fields
DROP CONSTRAINT IF EXISTS event_fields_field_type_check;

ALTER TABLE event_fields
ADD CONSTRAINT event_fields_field_type_check
CHECK (field_type IN ('radio', 'checkbox', 'boolean', 'text', 'date', 'time', 'plate', 'datetime'));
