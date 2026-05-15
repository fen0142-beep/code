-- ============================================================
-- Phase 5 Batch 1：多場次報名 — DB 建表
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-15
-- ============================================================

-- ① events 表新增 multi_session 欄位
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS multi_session BOOLEAN DEFAULT false;

-- ② 新表：event_sessions（場次設定）
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

-- ③ 新表：registration_session_checkins（多場次報到紀錄）
CREATE TABLE IF NOT EXISTS registration_session_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_id          UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES event_sessions(session_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reg_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_rsc_reg_id     ON registration_session_checkins(reg_id);
CREATE INDEX IF NOT EXISTS idx_rsc_session_id ON registration_session_checkins(session_id);

-- ④ RLS + GRANT
-- 注意：SQL Editor 建表需手動 GRANT，Dashboard 建表才自動處理
--   authenticated / service_role → 完整讀寫
--   anon → 只讀（前台 KioskPage 用 anon key 讀場次）
ALTER TABLE event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;

GRANT ALL ON event_sessions TO authenticated, service_role;
GRANT SELECT ON event_sessions TO anon;
GRANT ALL ON registration_session_checkins TO authenticated, service_role;

-- event_sessions：anon 可讀（前台）
CREATE POLICY "event_sessions_select_anon" ON event_sessions
  FOR SELECT TO anon USING (true);

-- event_sessions：authenticated 完整讀寫（後台）
CREATE POLICY "event_sessions_select" ON event_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "event_sessions_insert" ON event_sessions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "event_sessions_update" ON event_sessions
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "event_sessions_delete" ON event_sessions
  FOR DELETE TO authenticated USING (true);

-- registration_session_checkins：登入使用者可讀寫
CREATE POLICY "rsc_select" ON registration_session_checkins
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rsc_insert" ON registration_session_checkins
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "rsc_delete" ON registration_session_checkins
  FOR DELETE TO authenticated USING (true);
