-- ============================================================
-- Phase 3 — 法會功德主管理
-- 在 Supabase Dashboard → SQL Editor 執行一次
-- ============================================================
-- 變更內容：
-- 1. 新增 event_donors 表（功德主名單，每場活動一張表）
-- 2. 兩個 partial unique：學員型 (event_id, student_id) / 訪客型 (event_id, name)
-- 3. RLS 政策、GRANT 權限（與 registrations 對齊）
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. event_donors
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_donors (
  donor_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id  TEXT,                                                   -- NULL = 訪客功德主
  name        TEXT NOT NULL,
  donor_item  TEXT,                                                   -- 功德項目（自由文字，例：消災功德主）
  seat        TEXT,                                                   -- 座位
  corsage     TEXT,                                                   -- 胸花
  offering    TEXT,                                                   -- 供具
  donor_note  TEXT,                                                   -- 備註
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  event_donors             IS '法會功德主名單（一場一筆，依 event_id + student_id 或 event_id + name 唯一）';
COMMENT ON COLUMN event_donors.student_id  IS '對應 students.student_id；NULL 代表訪客型功德主';
COMMENT ON COLUMN event_donors.donor_item  IS '功德項目（自由文字，由師父在匯入時填寫，顯示時若空白則整列不顯示）';

-- 不加 students FK，避免將來 registrations / event_donors 同時 nested 撞 PGRST201
-- （前端寫入時自行確認 student_id 有效）


-- ────────────────────────────────────────────────────────────
-- 2. unique 索引（partial，分學員型／訪客型）
-- ────────────────────────────────────────────────────────────

-- 學員型：同一活動同一位學員只能有一筆功德主紀錄
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_student
  ON event_donors(event_id, student_id)
  WHERE student_id IS NOT NULL;

-- 訪客型：同一活動同名訪客只能有一筆（同名不同人需師父手動處理）
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_guest
  ON event_donors(event_id, name)
  WHERE student_id IS NULL;

-- 一般查詢索引
CREATE INDEX IF NOT EXISTS idx_event_donors_event   ON event_donors(event_id);
CREATE INDEX IF NOT EXISTS idx_event_donors_student ON event_donors(student_id) WHERE student_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 3. trigger：UPDATE 時自動推進 updated_at
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_event_donors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_donors_touch ON event_donors;

CREATE TRIGGER trg_event_donors_touch
  BEFORE UPDATE ON event_donors
  FOR EACH ROW
  EXECUTE FUNCTION touch_event_donors_updated_at();


-- ────────────────────────────────────────────────────────────
-- 4. RLS（與 registrations 同策略，anon 可全權；上線後可緊縮）
-- ────────────────────────────────────────────────────────────

ALTER TABLE event_donors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can select event_donors"        ON event_donors;
DROP POLICY IF EXISTS "anon can insert event_donors"        ON event_donors;
DROP POLICY IF EXISTS "anon can update event_donors"        ON event_donors;
DROP POLICY IF EXISTS "anon can delete event_donors"        ON event_donors;
DROP POLICY IF EXISTS "authenticated full access on event_donors" ON event_donors;

CREATE POLICY "anon can select event_donors"
  ON event_donors FOR SELECT TO anon USING (true);

CREATE POLICY "anon can insert event_donors"
  ON event_donors FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon can update event_donors"
  ON event_donors FOR UPDATE TO anon USING (true);

CREATE POLICY "anon can delete event_donors"
  ON event_donors FOR DELETE TO anon USING (true);

CREATE POLICY "authenticated full access on event_donors"
  ON event_donors FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ────────────────────────────────────────────────────────────
-- 5. GRANT
-- ────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors TO anon;
GRANT ALL ON event_donors TO authenticated;


-- ============================================================
-- 完成！執行後可用以下查詢確認：
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'event_donors' ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'event_donors';
-- ============================================================
