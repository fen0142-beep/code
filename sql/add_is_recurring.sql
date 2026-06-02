-- 定期活動標記：is_recurring=true 的活動由系統自動建立，在後台有獨立管理頁籤
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false;
