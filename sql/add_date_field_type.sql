-- 更新 event_fields.field_type 的 CHECK 約束，加入 date 與 time 型別
-- 在 Supabase SQL Editor 執行一次即可

-- 先刪除舊的 CHECK 約束（名稱可能因建立方式不同而異，兩條都試一下）
ALTER TABLE event_fields DROP CONSTRAINT IF EXISTS event_fields_field_type_check;
ALTER TABLE event_fields DROP CONSTRAINT IF EXISTS field_type_check;

-- 重建 CHECK 約束（含所有現有型別 + date + time）
ALTER TABLE event_fields
  ADD CONSTRAINT event_fields_field_type_check
  CHECK (field_type IN (
    'radio', 'checkbox', 'text', 'date', 'time', 'datetime',
    'boolean', 'plate'
  ));
