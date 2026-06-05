-- ============================================================
-- Phase 5：多場次活動「場次共用子欄位」動態化
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-16
--
-- 目的：把原本寫死的「午齋 / 停車」改為可在後台設定的動態欄位，
--      同時保留向後相容（既有多場次活動自動 backfill 預設兩欄）。
-- ============================================================

-- ① 新表：event_session_fields（一個多場次活動共用一組子欄位）
CREATE TABLE IF NOT EXISTS event_session_fields (
  field_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL,
  field_label    TEXT NOT NULL,
  field_type     TEXT NOT NULL DEFAULT 'radio' CHECK (field_type IN ('radio','boolean','text')),
  options        JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_if_period JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [] = 所有時段；["morning"] = 只上午
  sort_order     INT  NOT NULL DEFAULT 0,
  required       BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_event_session_fields_event_id
  ON event_session_fields(event_id);

-- ② RLS + GRANT（沿用 event_sessions 模式）
ALTER TABLE event_session_fields ENABLE ROW LEVEL SECURITY;

GRANT ALL    ON event_session_fields TO authenticated, service_role;
GRANT SELECT ON event_session_fields TO anon;

DROP POLICY IF EXISTS "esf_select_anon"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_select_auth"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_insert_auth"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_update_auth"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_delete_auth"    ON event_session_fields;

CREATE POLICY "esf_select_anon" ON event_session_fields
  FOR SELECT TO anon          USING (true);
CREATE POLICY "esf_select_auth" ON event_session_fields
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "esf_insert_auth" ON event_session_fields
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "esf_update_auth" ON event_session_fields
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "esf_delete_auth" ON event_session_fields
  FOR DELETE TO authenticated USING (true);

-- ③ Backfill：所有既有 multi_session=true 的活動，
--    若還沒有任何 event_session_fields，自動補上預設的「午齋」+「停車」兩筆。
--    這確保前台原本的寫死行為（午齋 morning + 停車 all）平滑遷移。
INSERT INTO event_session_fields
  (event_id, field_key, field_label, field_type, options, show_if_period, sort_order, required)
SELECT
  e.event_id, 'lunch', '午齋', 'radio',
  '["需要","不需要"]'::jsonb,
  '["morning"]'::jsonb,
  1, true
FROM events e
WHERE e.multi_session = true
  AND NOT EXISTS (
    SELECT 1 FROM event_session_fields esf WHERE esf.event_id = e.event_id
  );

INSERT INTO event_session_fields
  (event_id, field_key, field_label, field_type, options, show_if_period, sort_order, required)
SELECT
  e.event_id, 'parking', '停車', 'radio',
  '["機車","轎車","不需要"]'::jsonb,
  '[]'::jsonb,
  2, true
FROM events e
WHERE e.multi_session = true
  AND NOT EXISTS (
    SELECT 1 FROM event_session_fields esf
    WHERE esf.event_id = e.event_id AND esf.field_key = 'parking'
  );

-- ④ 驗證：列出每個多場次活動的子欄位
-- SELECT e.name, esf.field_key, esf.field_label, esf.show_if_period
-- FROM events e
-- LEFT JOIN event_session_fields esf ON esf.event_id = e.event_id
-- WHERE e.multi_session = true
-- ORDER BY e.name, esf.sort_order;
