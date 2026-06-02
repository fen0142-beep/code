-- 自由刷卡模式：學員刷卡即完成報名與報到，適合自由參加的活動
ALTER TABLE events ADD COLUMN IF NOT EXISTS walkin_mode boolean DEFAULT false;
