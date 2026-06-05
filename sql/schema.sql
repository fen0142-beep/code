-- ============================================================
-- 普宜精舍報名系統 — 完整資料庫建置 SQL（v2，2026-05-23）
--
-- 適用情境：全新 Supabase 專案，一次執行即可建好所有資料表。
-- 執行方式：Supabase Dashboard → SQL Editor → 貼入 → Run
--
-- 涵蓋資料表（共 22 張）：
--   students, student_classes,
--   events, event_fields, event_templates,
--   event_sessions, event_session_fields,
--   registrations, registration_changes, registration_session_checkins,
--   audit_log, event_donors,
--   car_assignments, car_members, car_leaders, head_leader,
--   car_monks, temple_monks,
--   relationship_groups, relationship_members,
--   volunteer_profiles, volunteer_event_access
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. 學員資料
-- ════════════════════════════════════════════════════════════

-- 學員主表
CREATE TABLE IF NOT EXISTS students (
  student_id  TEXT        PRIMARY KEY,
  qr_code     TEXT        UNIQUE,
  name        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 學員班別（一位學員可同時上多個班）
CREATE TABLE IF NOT EXISTS student_classes (
  id          BIGSERIAL   PRIMARY KEY,
  student_id  TEXT        NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  class_name  TEXT        NOT NULL,
  group_name  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_classes_student ON student_classes(student_id);


-- ════════════════════════════════════════════════════════════
-- 2. 活動與欄位
-- ════════════════════════════════════════════════════════════

-- 活動主表
CREATE TABLE IF NOT EXISTS events (
  event_id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT        NOT NULL,
  date_start               DATE,
  date_end                 DATE,
  location                 TEXT,
  event_type               TEXT        NOT NULL DEFAULT 'mountain'
                             CHECK (event_type IN ('temple', 'mountain')),
  is_dharma                BOOLEAN     NOT NULL DEFAULT false,
  status                   TEXT        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'active', 'closed')),
  locked                   BOOLEAN     NOT NULL DEFAULT false,
  multi_session            BOOLEAN     NOT NULL DEFAULT false,
  show_transport_to_public BOOLEAN     NOT NULL DEFAULT false,
  last_exported_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN events.locked                   IS '是否鎖定報名（true = 前台只能查看，不能新增/修改/取消）';
COMMENT ON COLUMN events.event_type               IS '活動類型：temple=精舍活動、mountain=回山活動';
COMMENT ON COLUMN events.is_dharma                IS '是否為法會（控制功德主管理顯示）';
COMMENT ON COLUMN events.multi_session            IS '是否為多場次活動（梁皇寶懺等）';
COMMENT ON COLUMN events.show_transport_to_public IS '對外公開排車資訊：true 時學員在 KioskPage 刷卡可看到自己的車次';

-- 活動動態欄位
CREATE TABLE IF NOT EXISTS event_fields (
  field_id       UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID     NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key      TEXT     NOT NULL,
  field_label    TEXT     NOT NULL,
  field_type     TEXT     NOT NULL
                   CHECK (field_type IN ('radio','checkbox','boolean','text','date','time','plate','datetime')),
  options        JSONB,
  show_if        JSONB,
  sort_order     INT      NOT NULL DEFAULT 0,
  required       BOOLEAN  NOT NULL DEFAULT false,
  placeholder    TEXT,
  dashboard_role TEXT
                   CHECK (dashboard_role IS NULL OR dashboard_role IN ('identity','lunch_total','parking_kind')),
  option_meta    JSONB
);

COMMENT ON COLUMN event_fields.dashboard_role IS '看板角色：identity / lunch_total / parking_kind';
COMMENT ON COLUMN event_fields.option_meta    IS '選項層級 metadata，parking_kind 時格式：{"<選項>":"motorcycle|car|none"}';
COMMENT ON COLUMN event_fields.placeholder    IS 'text 欄位的灰底提示文字';

CREATE INDEX IF NOT EXISTS idx_event_fields_event_id ON event_fields(event_id);

-- 活動模板
CREATE TABLE IF NOT EXISTS event_templates (
  template_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  fields         JSONB       NOT NULL DEFAULT '[]',
  session_fields JSONB       NOT NULL DEFAULT '[]',
  sort_order     INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN event_templates.session_fields IS '場次共用子欄位（多場次活動用）；套用模板時同步覆蓋 event_session_fields';


-- ════════════════════════════════════════════════════════════
-- 3. 多場次活動
-- ════════════════════════════════════════════════════════════

-- 場次設定（multi_session=true 活動用）
CREATE TABLE IF NOT EXISTS event_sessions (
  session_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  time_period TEXT        NOT NULL CHECK (time_period IN ('morning','afternoon','evening')),
  dharma_name TEXT        NOT NULL DEFAULT '',
  time_start  TIME,
  time_end    TIME,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);

-- 場次共用子欄位（動態化，取代寫死的午齋/停車）
CREATE TABLE IF NOT EXISTS event_session_fields (
  field_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key      TEXT        NOT NULL,
  field_label    TEXT        NOT NULL,
  field_type     TEXT        NOT NULL DEFAULT 'radio'
                               CHECK (field_type IN ('radio','boolean','text')),
  options        JSONB       NOT NULL DEFAULT '[]',
  show_if_period JSONB       NOT NULL DEFAULT '[]',
  sort_order     INT         NOT NULL DEFAULT 0,
  required       BOOLEAN     NOT NULL DEFAULT true,
  dashboard_role TEXT
                   CHECK (dashboard_role IS NULL OR dashboard_role IN ('identity','lunch_total','parking_kind')),
  option_meta    JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, field_key)
);

COMMENT ON COLUMN event_session_fields.show_if_period IS '[] = 所有時段；["morning"] = 只上午場顯示';
COMMENT ON COLUMN event_session_fields.dashboard_role IS '看板角色：identity / lunch_total / parking_kind';

CREATE INDEX IF NOT EXISTS idx_event_session_fields_event_id ON event_session_fields(event_id);


-- ════════════════════════════════════════════════════════════
-- 4. 報名紀錄
-- ════════════════════════════════════════════════════════════

-- 報名主表
CREATE TABLE IF NOT EXISTS registrations (
  registration_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id           TEXT        REFERENCES students(student_id) ON DELETE SET NULL,  -- NULL = 訪客
  host_student_id      TEXT,       -- 訪客被誰代報（刻意不加 FK，避免 PostgREST PGRST201 歧義）
  answers              JSONB       NOT NULL DEFAULT '{}',
  is_driver            BOOLEAN     NOT NULL DEFAULT false,
  registered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at        TIMESTAMPTZ,
  checked_in_down_at   TIMESTAMPTZ,
  terminal             TEXT,
  source               TEXT        NOT NULL DEFAULT 'kiosk',
  pre_depart_override  BOOLEAN     NOT NULL DEFAULT false,
  late_return_override BOOLEAN     NOT NULL DEFAULT false,
  UNIQUE (event_id, student_id)
);

COMMENT ON COLUMN registrations.student_id           IS 'NULL = 訪客報名';
COMMENT ON COLUMN registrations.host_student_id      IS '代報者學員 ID（排車自動同車；刻意不加 FK）';
COMMENT ON COLUMN registrations.is_driver            IS '是否為司機（自開小車場景）';
COMMENT ON COLUMN registrations.updated_at           IS '最後異動時間（INSERT/UPDATE 都會更新）';
COMMENT ON COLUMN registrations.checked_in_at        IS '現場刷卡報到；上山方向其他交通也用此欄';
COMMENT ON COLUMN registrations.checked_in_down_at   IS '其他交通下山報到時間（上山用 checked_in_at）';
COMMENT ON COLUMN registrations.source               IS 'kiosk=前台刷卡 / walkin=報到頁現場補報 / manual=後台手動';
COMMENT ON COLUMN registrations.pre_depart_override  IS '師父手動標記提前出發（其他交通專用）';
COMMENT ON COLUMN registrations.late_return_override IS '師父手動標記延後回程';

-- 自動更新 updated_at
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
  FOR EACH ROW EXECUTE FUNCTION touch_registrations_updated_at();

CREATE INDEX IF NOT EXISTS idx_registrations_event_id   ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_student_id ON registrations(student_id);
CREATE INDEX IF NOT EXISTS idx_registrations_host       ON registrations(host_student_id, event_id) WHERE host_student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registrations_updated_at ON registrations(event_id, updated_at DESC);

-- 報名異動紀錄（LINE 推送用）
CREATE TABLE IF NOT EXISTS registration_changes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID,
  event_id        UUID        NOT NULL,
  event_name      TEXT        NOT NULL DEFAULT '',
  student_name    TEXT        NOT NULL DEFAULT '',
  change_type     TEXT        NOT NULL
                    CHECK (change_type IN ('created','modified','cancelled')),
  old_answers     JSONB,
  new_answers     JSONB,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reg_changes_event      ON registration_changes(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_changes_unnotified ON registration_changes(notified_at) WHERE notified_at IS NULL;

-- 多場次活動逐場報到紀錄
CREATE TABLE IF NOT EXISTS registration_session_checkins (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_id        UUID        NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id    UUID        NOT NULL REFERENCES event_sessions(session_id)     ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reg_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_rsc_reg_id     ON registration_session_checkins(reg_id);
CREATE INDEX IF NOT EXISTS idx_rsc_session_id ON registration_session_checkins(session_id);

COMMENT ON TABLE registration_session_checkins IS '多場次活動每場一筆報到紀錄（複合 UNIQUE = 同人同場不重複）';


-- ════════════════════════════════════════════════════════════
-- 5. 稽核日誌
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  log_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action  TEXT,
  target  TEXT,
  ip      TEXT,
  at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 6. 法會功德主管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_donors (
  donor_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id  TEXT,
  name        TEXT        NOT NULL,
  donor_item  TEXT,
  seat        TEXT,
  corsage     TEXT,
  offering    TEXT,
  donor_note  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN event_donors.student_id IS 'NULL = 訪客型功德主；刻意不加 FK 避免 PostgREST 歧義';

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_student ON event_donors(event_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_guest   ON event_donors(event_id, name)       WHERE student_id IS NULL;
CREATE INDEX        IF NOT EXISTS idx_event_donors_event   ON event_donors(event_id);
CREATE INDEX        IF NOT EXISTS idx_event_donors_student ON event_donors(student_id) WHERE student_id IS NOT NULL;

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
  FOR EACH ROW EXECUTE FUNCTION touch_event_donors_updated_at();


-- ════════════════════════════════════════════════════════════
-- 7. 排車系統
-- ════════════════════════════════════════════════════════════

-- 車輛主表
CREATE TABLE IF NOT EXISTS car_assignments (
  car_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  car_name     TEXT        NOT NULL,
  seats        INT         NOT NULL DEFAULT 20,
  car_type     TEXT        NOT NULL DEFAULT 'large' CHECK (car_type IN ('large', 'small')),
  direction    TEXT        NOT NULL DEFAULT 'down'  CHECK (direction IN ('up', 'down')),
  note         TEXT,
  access_token TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sort_order   INT         NOT NULL DEFAULT 0,
  pre_depart   BOOLEAN     NOT NULL DEFAULT false,
  late_return  BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN car_assignments.direction   IS 'up=上山、down=下山';
COMMENT ON COLUMN car_assignments.pre_depart  IS '整車提前出發（上山）：從應到人數排除';
COMMENT ON COLUMN car_assignments.late_return IS '整車延後回程（下山）：從應到人數排除';

CREATE INDEX IF NOT EXISTS idx_car_assignments_event           ON car_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_direction ON car_assignments(event_id, direction);

-- 車輛成員（同人可同時出現在上山車與下山車）
CREATE TABLE IF NOT EXISTS car_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          UUID        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id UUID        NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ,
  UNIQUE (car_id, registration_id)
);

COMMENT ON COLUMN car_members.checked_in_at IS '領隊報到頁方向級別報到時間（上山/下山各自獨立）';

CREATE INDEX IF NOT EXISTS idx_car_members_car ON car_members(car_id);

-- 車輛領隊（每台車可多位）
CREATE TABLE IF NOT EXISTS car_leaders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          UUID NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (car_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_car_leaders_car ON car_leaders(car_id);

-- 總領隊 / 小車領隊
CREATE TABLE IF NOT EXISTS head_leader (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  registration_id UUID        REFERENCES registrations(registration_id) ON DELETE SET NULL,
  type            TEXT        NOT NULL DEFAULT 'all',
  access_token    TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  UNIQUE (event_id, type, registration_id)
);

COMMENT ON COLUMN head_leader.type IS 'all=總領隊、small_car=小車領隊（可多人）';


-- ════════════════════════════════════════════════════════════
-- 8. 法師管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS temple_monks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  notes      TEXT,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_monks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id        UUID        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  monk_id       UUID        NOT NULL REFERENCES temple_monks(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ,
  UNIQUE(car_id, monk_id)
);

CREATE INDEX IF NOT EXISTS idx_car_monks_car_id  ON car_monks(car_id);
CREATE INDEX IF NOT EXISTS idx_car_monks_monk_id ON car_monks(monk_id);


-- ════════════════════════════════════════════════════════════
-- 9. 關係連結（同車同行）
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS relationship_groups (
  group_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relationship_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES relationship_groups(group_id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_members_group   ON relationship_members(group_id);
CREATE INDEX IF NOT EXISTS idx_rel_members_student ON relationship_members(student_id);


-- ════════════════════════════════════════════════════════════
-- 10. 義工帳號管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS volunteer_profiles (
  id           UUID        PRIMARY KEY,
  email        TEXT        NOT NULL DEFAULT '',
  display_name TEXT        NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS volunteer_event_access (
  volunteer_id UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_id, event_id)
);


-- ════════════════════════════════════════════════════════════
-- 11. Row Level Security（RLS）啟用
-- ════════════════════════════════════════════════════════════

ALTER TABLE students                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_fields                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_templates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sessions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_session_fields          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_changes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_donors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_assignments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_members                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_leaders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE head_leader                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE temple_monks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_monks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_event_access        ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- 12. RLS Policies
-- ════════════════════════════════════════════════════════════

-- students
CREATE POLICY "anon can select students"            ON students        FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on students"        ON students        FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- student_classes
CREATE POLICY "anon can select student_classes"     ON student_classes FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on student_classes" ON student_classes FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- events（前台只看 active 活動）
CREATE POLICY "anon can select active events"       ON events          FOR SELECT TO anon          USING (status = 'active');
CREATE POLICY "auth full access on events"          ON events          FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_fields
CREATE POLICY "anon can select event_fields"        ON event_fields    FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on event_fields"    ON event_fields    FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_templates（僅後台）
CREATE POLICY "auth full access on event_templates" ON event_templates FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_sessions
CREATE POLICY "anon can select event_sessions"      ON event_sessions  FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on event_sessions"  ON event_sessions  FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_session_fields
CREATE POLICY "anon can select esf"                 ON event_session_fields FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on esf"             ON event_session_fields FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- registrations
CREATE POLICY "anon can select registrations"       ON registrations   FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert registrations"       ON registrations   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update registrations"       ON registrations   FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete registrations"       ON registrations   FOR DELETE TO anon USING (true);
CREATE POLICY "auth full access on registrations"   ON registrations   FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- registration_changes（anon 只能 insert）
CREATE POLICY "anon can insert changes"             ON registration_changes FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth full access on changes"         ON registration_changes FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- registration_session_checkins
CREATE POLICY "auth full access on rsc"             ON registration_session_checkins FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- audit_log
CREATE POLICY "auth full access on audit_log"       ON audit_log       FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_donors
CREATE POLICY "anon can select event_donors"        ON event_donors    FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert event_donors"        ON event_donors    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update event_donors"        ON event_donors    FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete event_donors"        ON event_donors    FOR DELETE TO anon USING (true);
CREATE POLICY "auth full access on event_donors"    ON event_donors    FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_assignments（anon 可讀：領隊報到頁）
CREATE POLICY "anon can read car_assignments"       ON car_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on car_assignments" ON car_assignments FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_members（anon 可讀 + 更新 checked_in_at）
CREATE POLICY "anon can read car_members"           ON car_members     FOR SELECT TO anon USING (true);
CREATE POLICY "anon can update car_members"         ON car_members     FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on car_members"     ON car_members     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_leaders（anon 可讀）
CREATE POLICY "anon can read car_leaders"           ON car_leaders     FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on car_leaders"     ON car_leaders     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- head_leader（anon 可讀：/leader 掃卡頁）
CREATE POLICY "anon can select head_leader"         ON head_leader     FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on head_leader"     ON head_leader     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- temple_monks（anon 唯讀）
CREATE POLICY "temple_monks_anon_read"              ON temple_monks    FOR SELECT TO anon          USING (true);
CREATE POLICY "temple_monks_auth_all"               ON temple_monks    FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_monks（anon 可讀 + 更新，領隊頁打卡用）
CREATE POLICY "car_monks_anon_select"               ON car_monks       FOR SELECT TO anon USING (true);
CREATE POLICY "car_monks_anon_update"               ON car_monks       FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "car_monks_auth_all"                  ON car_monks       FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- relationship
CREATE POLICY "auth full access on rel_groups"      ON relationship_groups  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on rel_members"     ON relationship_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- volunteer
CREATE POLICY "auth full access on vol_profiles"    ON volunteer_profiles     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on vol_access"      ON volunteer_event_access FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════
-- 13. GRANT 權限
-- ════════════════════════════════════════════════════════════

-- anon（前台、領隊報到頁）
GRANT SELECT                         ON students                      TO anon;
GRANT SELECT                         ON student_classes               TO anon;
GRANT SELECT                         ON events                        TO anon;
GRANT SELECT                         ON event_fields                  TO anon;
GRANT SELECT                         ON event_sessions                TO anon;
GRANT SELECT                         ON event_session_fields          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON registrations                 TO anon;
GRANT INSERT                         ON registration_changes          TO anon;
GRANT SELECT                         ON car_assignments               TO anon;
GRANT SELECT, UPDATE                 ON car_members                   TO anon;
GRANT SELECT                         ON car_leaders                   TO anon;
GRANT SELECT                         ON head_leader                   TO anon;
GRANT SELECT                         ON temple_monks                  TO anon;
GRANT SELECT, UPDATE                 ON car_monks                     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors                  TO anon;

-- authenticated（師父 / 義工後台）
GRANT ALL ON students                      TO authenticated;
GRANT ALL ON student_classes               TO authenticated;
GRANT ALL ON events                        TO authenticated;
GRANT ALL ON event_fields                  TO authenticated;
GRANT ALL ON event_templates               TO authenticated;
GRANT ALL ON event_sessions                TO authenticated;
GRANT ALL ON event_session_fields          TO authenticated;
GRANT ALL ON registrations                 TO authenticated;
GRANT ALL ON registration_changes          TO authenticated;
GRANT ALL ON registration_session_checkins TO authenticated;
GRANT ALL ON audit_log                     TO authenticated;
GRANT ALL ON event_donors                  TO authenticated;
GRANT ALL ON car_assignments               TO authenticated;
GRANT ALL ON car_members                   TO authenticated;
GRANT ALL ON car_leaders                   TO authenticated;
GRANT ALL ON head_leader                   TO authenticated;
GRANT ALL ON temple_monks                  TO authenticated;
GRANT ALL ON car_monks                     TO authenticated;
GRANT ALL ON relationship_groups           TO authenticated;
GRANT ALL ON relationship_members          TO authenticated;
GRANT ALL ON volunteer_profiles            TO authenticated;
GRANT ALL ON volunteer_event_access        TO authenticated;

-- service_role（備份腳本用）
GRANT ALL ON event_sessions                TO service_role;
GRANT ALL ON registration_session_checkins TO service_role;
GRANT ALL ON event_session_fields          TO service_role;

-- sequence 權限
GRANT USAGE, SELECT ON SEQUENCE student_classes_id_seq TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 14. 預設模板（回山 + 精舍）
-- ════════════════════════════════════════════════════════════

INSERT INTO event_templates (name, sort_order, session_fields, fields) VALUES

('回山模板', 1, '[]'::jsonb, '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求","dashboard_role":null,"option_meta":null}
]'::jsonb),

('精舍模板', 2, '[]'::jsonb, '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"lunch_total","option_meta":null},
  {"field_key":"parking_type","field_label":"停車方式","field_type":"radio","options":["不需要","機車","轎車"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"parking_kind","option_meta":{"不需要":"none","機車":"motorcycle","轎車":"car"}},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null}
]'::jsonb)

ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- 15. 師父帳號角色設定（執行完 schema 後再做）
-- ════════════════════════════════════════════════════════════
--
-- ① 先到 Supabase → Authentication → Users → 「Add user」
--    建立師父的 email + 密碼帳號（勾 Auto Confirm）
--
-- ② 執行以下 SQL，把下方 email 改成師父帳號：
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_set(
--   COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"admin"'
-- )
-- WHERE email = 'your-email@example.com';
--
-- ③ 若需要義工共用帳號，同樣先 Add user，再執行：
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_set(
--   COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"volunteer"'
-- )
-- WHERE email = 'volunteer@your.branch';


-- ════════════════════════════════════════════════════════════
-- 完成！執行後用以下查詢確認所有資料表已建立（應看到 22 張）：
--
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- ════════════════════════════════════════════════════════════

COMMENT ON TABLE registration_session_checkins IS '多場次活動每場一筆報到紀錄（複合 UNIQUE = 同人同場不重複）';


-- ════════════════════════════════════════════════════════════
-- 5. 稽核日誌
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  log_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action  TEXT,
  target  TEXT,
  ip      TEXT,
  at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 6. 法會功德主管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_donors (
  donor_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id  TEXT,
  name        TEXT        NOT NULL,
  donor_item  TEXT,
  seat        TEXT,
  corsage     TEXT,
  offering    TEXT,
  donor_note  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN event_donors.student_id IS 'NULL = 訪客型功德主；刻意不加 FK 避免 PostgREST 歧義';

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_student ON event_donors(event_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_guest   ON event_donors(event_id, name)       WHERE student_id IS NULL;
CREATE INDEX        IF NOT EXISTS idx_event_donors_event   ON event_donors(event_id);
CREATE INDEX        IF NOT EXISTS idx_event_donors_student ON event_donors(student_id) WHERE student_id IS NOT NULL;

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
  FOR EACH ROW EXECUTE FUNCTION touch_event_donors_updated_at();


-- ════════════════════════════════════════════════════════════
-- 7. 排車系統
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS car_assignments (
  car_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  car_name     TEXT        NOT NULL,
  seats        INT         NOT NULL DEFAULT 20,
  car_type     TEXT        NOT NULL DEFAULT 'large' CHECK (car_type IN ('large', 'small')),
  direction    TEXT        NOT NULL DEFAULT 'down'  CHECK (direction IN ('up', 'down')),
  note         TEXT,
  access_token TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sort_order   INT         NOT NULL DEFAULT 0,
  pre_depart   BOOLEAN     NOT NULL DEFAULT false,
  late_return  BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN car_assignments.direction   IS 'up=上山、down=下山';
COMMENT ON COLUMN car_assignments.pre_depart  IS '整車提前出發（上山）：從應到人數排除';
COMMENT ON COLUMN car_assignments.late_return IS '整車延後回程（下山）：從應到人數排除';

CREATE INDEX IF NOT EXISTS idx_car_assignments_event           ON car_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_direction ON car_assignments(event_id, direction);

CREATE TABLE IF NOT EXISTS car_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          UUID        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id UUID        NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ,
  UNIQUE (car_id, registration_id)
);

COMMENT ON COLUMN car_members.checked_in_at IS '領隊報到頁方向級別報到時間（上山/下山各自獨立）';

CREATE INDEX IF NOT EXISTS idx_car_members_car ON car_members(car_id);

CREATE TABLE IF NOT EXISTS car_leaders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          UUID NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (car_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_car_leaders_car ON car_leaders(car_id);

CREATE TABLE IF NOT EXISTS head_leader (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  registration_id UUID        REFERENCES registrations(registration_id) ON DELETE SET NULL,
  type            TEXT        NOT NULL DEFAULT 'all',
  access_token    TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  UNIQUE (event_id, type, registration_id)
);

COMMENT ON COLUMN head_leader.type IS 'all=總領隊、small_car=小車領隊（可多人）';


-- ════════════════════════════════════════════════════════════
-- 8. 法師管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS temple_monks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  notes      TEXT,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_monks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id        UUID        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  monk_id       UUID        NOT NULL REFERENCES temple_monks(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ,
  UNIQUE(car_id, monk_id)
);

CREATE INDEX IF NOT EXISTS idx_car_monks_car_id  ON car_monks(car_id);
CREATE INDEX IF NOT EXISTS idx_car_monks_monk_id ON car_monks(monk_id);


-- ════════════════════════════════════════════════════════════
-- 9. 關係連結（同車同行）
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS relationship_groups (
  group_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relationship_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES relationship_groups(group_id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_members_group   ON relationship_members(group_id);
CREATE INDEX IF NOT EXISTS idx_rel_members_student ON relationship_members(student_id);


-- ════════════════════════════════════════════════════════════
-- 10. 義工帳號管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS volunteer_profiles (
  id           UUID        PRIMARY KEY,
  email        TEXT        NOT NULL DEFAULT '',
  display_name TEXT        NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS volunteer_event_access (
  volunteer_id UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_id, event_id)
);


-- ════════════════════════════════════════════════════════════
-- 11. Row Level Security（RLS）啟用
-- ════════════════════════════════════════════════════════════

ALTER TABLE students                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_fields                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_templates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sessions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_session_fields          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_changes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_donors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_assignments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_members                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_leaders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE head_leader                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE temple_monks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_monks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_event_access        ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- 12. RLS Policies
-- ════════════════════════════════════════════════════════════

CREATE POLICY "anon can select students"            ON students        FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on students"        ON students        FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select student_classes"     ON student_classes FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on student_classes" ON student_classes FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select active events"       ON events          FOR SELECT TO anon          USING (status = 'active');
CREATE POLICY "auth full access on events"          ON events          FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select event_fields"        ON event_fields    FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on event_fields"    ON event_fields    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on event_templates" ON event_templates FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select event_sessions"      ON event_sessions  FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on event_sessions"  ON event_sessions  FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select esf"                 ON event_session_fields FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on esf"             ON event_session_fields FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select registrations"       ON registrations   FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert registrations"       ON registrations   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update registrations"       ON registrations   FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete registrations"       ON registrations   FOR DELETE TO anon USING (true);
CREATE POLICY "auth full access on registrations"   ON registrations   FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can insert changes"             ON registration_changes FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth full access on changes"         ON registration_changes FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on rsc"             ON registration_session_checkins FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on audit_log"       ON audit_log       FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select event_donors"        ON event_donors    FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert event_donors"        ON event_donors    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update event_donors"        ON event_donors    FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete event_donors"        ON event_donors    FOR DELETE TO anon USING (true);
CREATE POLICY "auth full access on event_donors"    ON event_donors    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can read car_assignments"       ON car_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on car_assignments" ON car_assignments FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can read car_members"           ON car_members     FOR SELECT TO anon USING (true);
CREATE POLICY "anon can update car_members"         ON car_members     FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on car_members"     ON car_members     FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can read car_leaders"           ON car_leaders     FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on car_leaders"     ON car_leaders     FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon can select head_leader"         ON head_leader     FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on head_leader"     ON head_leader     FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "temple_monks_anon_read"              ON temple_monks    FOR SELECT TO anon          USING (true);
CREATE POLICY "temple_monks_auth_all"               ON temple_monks    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "car_monks_anon_select"               ON car_monks       FOR SELECT TO anon USING (true);
CREATE POLICY "car_monks_anon_update"               ON car_monks       FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "car_monks_auth_all"                  ON car_monks       FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on rel_groups"      ON relationship_groups  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on rel_members"     ON relationship_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on vol_profiles"    ON volunteer_profiles     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on vol_access"      ON volunteer_event_access FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════
-- 13. GRANT 權限
-- ════════════════════════════════════════════════════════════

GRANT SELECT                         ON students                      TO anon;
GRANT SELECT                         ON student_classes               TO anon;
GRANT SELECT                         ON events                        TO anon;
GRANT SELECT                         ON event_fields                  TO anon;
GRANT SELECT                         ON event_sessions                TO anon;
GRANT SELECT                         ON event_session_fields          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON registrations                 TO anon;
GRANT INSERT                         ON registration_changes          TO anon;
GRANT SELECT                         ON car_assignments               TO anon;
GRANT SELECT, UPDATE                 ON car_members                   TO anon;
GRANT SELECT                         ON car_leaders                   TO anon;
GRANT SELECT                         ON head_leader                   TO anon;
GRANT SELECT                         ON temple_monks                  TO anon;
GRANT SELECT, UPDATE                 ON car_monks                     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors                  TO anon;

GRANT ALL ON students                      TO authenticated;
GRANT ALL ON student_classes               TO authenticated;
GRANT ALL ON events                        TO authenticated;
GRANT ALL ON event_fields                  TO authenticated;
GRANT ALL ON event_templates               TO authenticated;
GRANT ALL ON event_sessions                TO authenticated;
GRANT ALL ON event_session_fields          TO authenticated;
GRANT ALL ON registrations                 TO authenticated;
GRANT ALL ON registration_changes          TO authenticated;
GRANT ALL ON registration_session_checkins TO authenticated;
GRANT ALL ON audit_log                     TO authenticated;
GRANT ALL ON event_donors                  TO authenticated;
GRANT ALL ON car_assignments               TO authenticated;
GRANT ALL ON car_members                   TO authenticated;
GRANT ALL ON car_leaders                   TO authenticated;
GRANT ALL ON head_leader                   TO authenticated;
GRANT ALL ON temple_monks                  TO authenticated;
GRANT ALL ON car_monks                     TO authenticated;
GRANT ALL ON relationship_groups           TO authenticated;
GRANT ALL ON relationship_members          TO authenticated;
GRANT ALL ON volunteer_profiles            TO authenticated;
GRANT ALL ON volunteer_event_access        TO authenticated;

GRANT ALL ON event_sessions                TO service_role;
GRANT ALL ON registration_session_checkins TO service_role;
GRANT ALL ON event_session_fields          TO service_role;

GRANT USAGE, SELECT ON SEQUENCE student_classes_id_seq TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 14. 預設模板（回山 + 精舍）
-- ════════════════════════════════════════════════════════════

INSERT INTO event_templates (name, sort_order, session_fields, fields) VALUES

('回山模板', 1, '[]'::jsonb, '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求","dashboard_role":null,"option_meta":null}
]'::jsonb),

('精舍模板', 2, '[]'::jsonb, '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"lunch_total","option_meta":null},
  {"field_key":"parking_type","field_label":"停車方式","field_type":"radio","options":["不需要","機車","轎車"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"parking_kind","option_meta":{"不需要":"none","機車":"motorcycle","轎車":"car"}},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null}
]'::jsonb)

ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- 15. 師父帳號角色設定（執行完 schema 後再做）
-- ════════════════════════════════════════════════════════════
--
-- ① 先到 Supabase → Authentication → Users → 「Add user」
--    建立師父的 email + 密碼帳號（勾 Auto Confirm）
--
-- ② 執行以下 SQL，把 email 改成師父帳號：
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_set(
--   COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"admin"'
-- )
-- WHERE email = 'your-email@example.com';
--
-- ③ 若需要義工共用帳號，同樣先 Add user，再執行：
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_set(
--   COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"volunteer"'
-- )
-- WHERE email = 'volunteer@your.branch';


-- ════════════════════════════════════════════════════════════
-- 完成！執行後用以下查詢確認所有資料表已建立（應看到 22 張）：
--
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- ════════════════════════════════════════════════════════════
