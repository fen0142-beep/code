-- ============================================================
-- 普宜精舍報名系統 — 完整資料庫建置 SQL
-- 在 Supabase Dashboard → SQL Editor 執行此檔案
-- 執行一次即可完成所有資料表、權限、索引設定
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. 建立資料表
-- ────────────────────────────────────────────────────────────

-- 學員表
CREATE TABLE IF NOT EXISTS students (
  student_id  TEXT PRIMARY KEY,
  qr_code     TEXT UNIQUE,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 學員班別表（一位學員可同時上多個班）
CREATE TABLE IF NOT EXISTS student_classes (
  id          BIGSERIAL PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  class_name  TEXT NOT NULL,
  group_name  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 活動表
CREATE TABLE IF NOT EXISTS events (
  event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  date_start  DATE,
  date_end    DATE,
  location    TEXT,
  event_type  TEXT NOT NULL DEFAULT 'mountain'
                CHECK (event_type IN ('temple', 'mountain')),
  is_dharma   BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'closed')),
  locked      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN events.locked     IS '是否鎖定報名（true = 前台只能查看，不能新增/修改/取消）';
COMMENT ON COLUMN events.event_type IS '活動類型：temple=精舍活動、mountain=回山活動';
COMMENT ON COLUMN events.is_dharma  IS '是否為法會（控制功德主管理顯示）';

-- 活動動態欄位表
CREATE TABLE IF NOT EXISTS event_fields (
  field_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type  TEXT NOT NULL
                CHECK (field_type IN ('radio','checkbox','boolean','text','date','time','plate','datetime')),
  options     JSONB,
  show_if     JSONB,
  sort_order  INT NOT NULL DEFAULT 0,
  required    BOOLEAN NOT NULL DEFAULT false
);

-- 報名紀錄表
CREATE TABLE IF NOT EXISTS registrations (
  registration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id      TEXT REFERENCES students(student_id) ON DELETE SET NULL,  -- NULL = 訪客
  host_student_id TEXT REFERENCES students(student_id) ON DELETE SET NULL,  -- 訪客被誰代報（用於排車）
  answers         JSONB NOT NULL DEFAULT '{}',
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at   TIMESTAMPTZ,
  terminal        TEXT,
  UNIQUE (event_id, student_id)  -- 同一學員同一活動只能報名一次（訪客不受此限）
);

-- 稽核日誌表
CREATE TABLE IF NOT EXISTS audit_log (
  log_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action  TEXT,
  target  TEXT,
  ip      TEXT,
  at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────
-- 2. 索引
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_registrations_event_id   ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_student_id ON registrations(student_id);
CREATE INDEX IF NOT EXISTS idx_registrations_host       ON registrations(host_student_id, event_id) WHERE host_student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_fields_event_id    ON event_fields(event_id);
CREATE INDEX IF NOT EXISTS idx_student_classes_student  ON student_classes(student_id);


-- ────────────────────────────────────────────────────────────
-- 3. 啟用 Row Level Security（RLS）
-- ────────────────────────────────────────────────────────────

ALTER TABLE students       ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_fields   ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 4. RLS 政策
-- ────────────────────────────────────────────────────────────

-- students
CREATE POLICY "anon can select students"
  ON students FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated full access on students"
  ON students FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- student_classes
CREATE POLICY "anon can select student_classes"
  ON student_classes FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated full access on student_classes"
  ON student_classes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- events（前台只看 active 活動）
CREATE POLICY "anon can select active events"
  ON events FOR SELECT TO anon USING (status = 'active');

CREATE POLICY "authenticated full access on events"
  ON events FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- event_fields
CREATE POLICY "anon can select event_fields"
  ON event_fields FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated full access on event_fields"
  ON event_fields FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- registrations
CREATE POLICY "anon can select registrations"
  ON registrations FOR SELECT TO anon USING (true);

CREATE POLICY "anon can insert registrations"
  ON registrations FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon can update registrations"
  ON registrations FOR UPDATE TO anon USING (true);

CREATE POLICY "anon can delete registrations"
  ON registrations FOR DELETE TO anon USING (true);

CREATE POLICY "authenticated full access on registrations"
  ON registrations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- audit_log
CREATE POLICY "authenticated full access on audit_log"
  ON audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ────────────────────────────────────────────────────────────
-- 5. GRANT 權限
-- ────────────────────────────────────────────────────────────

GRANT SELECT                    ON students        TO anon;
GRANT SELECT                    ON student_classes TO anon;
GRANT SELECT                    ON events          TO anon;
GRANT SELECT                    ON event_fields    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON registrations TO anon;

GRANT ALL ON students        TO authenticated;
GRANT ALL ON student_classes TO authenticated;
GRANT ALL ON events          TO authenticated;
GRANT ALL ON event_fields    TO authenticated;
GRANT ALL ON registrations   TO authenticated;
GRANT ALL ON audit_log       TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE student_classes_id_seq TO authenticated;

-- ============================================================
-- 完成！執行後可用以下查詢確認資料表已建立：
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
-- ============================================================
