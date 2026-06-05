-- 替 events 表加入「停止異動」欄位
-- 在 Supabase SQL Editor 執行此檔案

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN events.locked IS '是否鎖定報名（true = 前台只能查看，不能新增/修改/取消）';
