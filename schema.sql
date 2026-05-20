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
  required    BOOLEAN NOT NULL DEFAULT false,
  -- 看板動態化（2026-05-18）：標記此欄位在即時看板的角色與選項 metadata
  dashboard_role TEXT
    CHECK (dashboard_role IS NULL OR dashboard_role IN ('identity','lunch_total','parking_kind')),
  option_meta    JSONB
);

-- 報名紀錄表
CREATE TABLE IF NOT EXISTS registrations (
  registration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id      TEXT REFERENCES students(student_id) ON DELETE SET NULL,  -- NULL = 訪客
  host_student_id TEXT,                                                     -- 訪客被誰代報（不加 FK 避免 PostgREST 歧義）
  answers         JSONB NOT NULL DEFAULT '{}',
  is_driver       BOOLEAN NOT NULL DEFAULT false,                           -- 小車自開場景（含車號欄位）= true
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),                       -- INSERT/UPDATE 都會推進；名單顯示用
  checked_in_at   TIMESTAMPTZ,
  terminal        TEXT,
  source          TEXT NOT NULL DEFAULT 'kiosk',                              -- kiosk=前台刷卡 / walkin=報到頁現場補報 / manual=後台手動
  UNIQUE (event_id, student_id)  -- 同一學員同一活動只能報名一次（訪客不受此限）
);

-- 自動更新 updated_at 的 trigger
CREATE OR REPLACE FUNCTION touch_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registrations_touch ON registrations;
CREATE TRIGGER trg_registrations_touch
  BEFORE UPDATE ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION touch_registrations_updated_at();

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
CREATE INDEX IF NOT EXISTS idx_registrations_updated_at ON registrations(event_id, updated_at DESC);
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
-- Phase 3 — 功德主管理（event_donors）
-- ============================================================

CREATE TABLE IF NOT EXISTS event_donors (
  donor_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id  TEXT,                                                   -- NULL = 訪客功德主
  name        TEXT NOT NULL,
  donor_item  TEXT,                                                   -- 功德項目（自由文字）
  seat        TEXT,                                                   -- 座位
  corsage     TEXT,                                                   -- 胸花
  offering    TEXT,                                                   -- 供具
  donor_note  TEXT,                                                   -- 備註
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_student
  ON event_donors(event_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_guest
  ON event_donors(event_id, name)       WHERE student_id IS NULL;
CREATE INDEX        IF NOT EXISTS idx_event_donors_event
  ON event_donors(event_id);
CREATE INDEX        IF NOT EXISTS idx_event_donors_student
  ON event_donors(student_id) WHERE student_id IS NOT NULL;

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

ALTER TABLE event_donors ENABLE ROW LEVEL SECURITY;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors TO anon;
GRANT ALL ON event_donors TO authenticated;


-- ============================================================
-- 完成！執行後可用以下查詢確認資料表已建立：
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
-- ============================================================
