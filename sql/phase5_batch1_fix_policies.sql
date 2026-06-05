-- Phase 5 Batch 1 補執行：重建 event_sessions / registration_session_checkins Policy
-- 若已存在先刪除，再重建（冪等執行）

-- ① 確保欄位存在（重複執行安全）
ALTER TABLE events ADD COLUMN IF NOT EXISTS multi_session BOOLEAN DEFAULT false;

-- ② 確保資料表存在（重複執行安全）
CREATE TABLE IF NOT EXISTS event_sessions (
  session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  time_period  TEXT NOT NULL CHECK (time_period IN ('morning','afternoon','evening')),
  dharma_name  TEXT NOT NULL DEFAULT '',
  time_start   TIME,
  time_end     TIME,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);

CREATE TABLE IF NOT EXISTS registration_session_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_id          UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES event_sessions(session_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reg_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_rsc_reg_id     ON registration_session_checkins(reg_id);
CREATE INDEX IF NOT EXISTS idx_rsc_session_id ON registration_session_checkins(session_id);

-- ③ RLS 啟用
ALTER TABLE event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;

-- ④ GRANT
GRANT ALL ON event_sessions TO authenticated, service_role;
GRANT SELECT ON event_sessions TO anon;
GRANT ALL ON registration_session_checkins TO authenticated, service_role;

-- ⑤ 先刪舊 Policy，再重建（避免 42710 衝突）
DROP POLICY IF EXISTS "event_sessions_select_anon" ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_select"      ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_insert"      ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_update"      ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_delete"      ON event_sessions;
DROP POLICY IF EXISTS "rsc_select"                 ON registration_session_checkins;
DROP POLICY IF EXISTS "rsc_insert"                 ON registration_session_checkins;
DROP POLICY IF EXISTS "rsc_delete"                 ON registration_session_checkins;

CREATE POLICY "event_sessions_select_anon" ON event_sessions
  FOR SELECT TO anon USING (true);

CREATE POLICY "event_sessions_select" ON event_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "event_sessions_insert" ON event_sessions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "event_sessions_update" ON event_sessions
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "event_sessions_delete" ON event_sessions
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "rsc_select" ON registration_session_checkins
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rsc_insert" ON registration_session_checkins
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "rsc_delete" ON registration_session_checkins
  FOR DELETE TO authenticated USING (true);
