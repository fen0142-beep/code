-- 2026-05-19: 活動加上「對外公開排車資訊」開關
-- 勾選後，學員在前台刷卡可看到自己的車次（大車/小車）
-- 預設 false：避免排車還在編輯時就被學員看到

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS show_transport_to_public BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.show_transport_to_public IS
  '對外公開排車資訊：true 時學員在 KioskPage 刷卡可看到自己的車次（大車/小車、上下山方向）';
