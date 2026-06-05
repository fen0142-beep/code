-- ============================================================
-- 義工存取設定 — 建立所需資料表
-- 請在 Supabase SQL Editor 執行此檔案
-- ============================================================

-- 1. 義工帳號資料表
--    義工登入後台時自動同步 email / display_name，
--    讓師父可在後台介面看到義工清單。
CREATE TABLE IF NOT EXISTS volunteer_profiles (
  id           UUID PRIMARY KEY,
  email        TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE volunteer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "volunteer_profiles: authenticated 可讀寫"
  ON volunteer_profiles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON volunteer_profiles TO authenticated;

-- 2. 義工活動存取表
--    記錄哪位義工可以看到哪場活動。
CREATE TABLE IF NOT EXISTS volunteer_event_access (
  volunteer_id UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_id, event_id)
);

ALTER TABLE volunteer_event_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "volunteer_event_access: authenticated 完整存取"
  ON volunteer_event_access FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON volunteer_event_access TO authenticated;
