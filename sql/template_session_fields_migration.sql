-- ============================================================
-- 模板系統支援 session_fields（場次共用子欄位）
-- 建立日期：2026-05-19
--
-- 多場次活動的「場次共用子欄位」（event_session_fields）
-- 現在可以隨模板一起儲存／套用。模板套用到活動時：
--   - fields         → event_fields（覆蓋）
--   - session_fields → event_session_fields（覆蓋）
--
-- 舊模板沒設定 session_fields → 預設空陣列，套用模板時不動 event_session_fields
-- ============================================================

ALTER TABLE event_templates
  ADD COLUMN IF NOT EXISTS session_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN event_templates.session_fields IS
  '場次共用子欄位（多場次活動用）。結構同 event_session_fields，但少 event_id / field_id / sort_order（套用時由系統補）';
