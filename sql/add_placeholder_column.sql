-- 在 event_fields 加入 placeholder 欄位（text 欄位的灰底提示文字）
ALTER TABLE event_fields ADD COLUMN IF NOT EXISTS placeholder text;
