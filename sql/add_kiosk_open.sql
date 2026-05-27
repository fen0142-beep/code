-- Migration: add kiosk_open to events
-- 用途：解耦「活動介紹頁顯示」與「刷卡報名開放」
-- 執行一次即可，現有活動全部預設 true（不影響現狀）

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS kiosk_open BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN events.kiosk_open IS
  '是否顯示於前台 Kiosk 報名清單。false = 不開放刷卡報名（但可仍在 activities 頁顯示）';
