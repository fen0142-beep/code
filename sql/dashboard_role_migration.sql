-- ============================================================
-- 看板動態化（schema-driven dashboard）
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-18
--
-- 目的：把即時看板的「身份／午齋／停車」改為靠 metadata 觸發，
--      不再依賴寫死的 field_key（identity / need_lunch / parking_type）。
--
-- 加兩個欄位：
--   - dashboard_role：標記此欄位在看板擔任的角色
--                     (identity / lunch_total / parking_kind)
--   - option_meta   ：選項層級的 metadata，例如停車選項對應車種
--                     {"需要機車停車位":"motorcycle",
--                      "需要汽車停車位":"car",
--                      "不需要停車位":"none"}
--
-- 同步處理 event_fields（單場活動）與 event_session_fields（多場次）。
-- 既有資料不動；fallback 由前端負責。
-- ============================================================

-- ① event_fields：加 dashboard_role + option_meta
ALTER TABLE event_fields ADD COLUMN IF NOT EXISTS dashboard_role TEXT;
ALTER TABLE event_fields ADD COLUMN IF NOT EXISTS option_meta    JSONB;

ALTER TABLE event_fields
  DROP CONSTRAINT IF EXISTS event_fields_dashboard_role_check;
ALTER TABLE event_fields
  ADD CONSTRAINT event_fields_dashboard_role_check
  CHECK (
    dashboard_role IS NULL
    OR dashboard_role IN ('identity', 'lunch_total', 'parking_kind')
  );

COMMENT ON COLUMN event_fields.dashboard_role IS
  '看板角色：identity（身份統計）/ lunch_total（午齋總份數）/ parking_kind（停車車輛數，配合 option_meta）';
COMMENT ON COLUMN event_fields.option_meta IS
  '選項層級 metadata。parking_kind 時格式：{"<選項字串>":"motorcycle|car|none"}';


-- ② event_session_fields：同樣兩個欄位（多場次走同一套機制）
ALTER TABLE event_session_fields ADD COLUMN IF NOT EXISTS dashboard_role TEXT;
ALTER TABLE event_session_fields ADD COLUMN IF NOT EXISTS option_meta    JSONB;

ALTER TABLE event_session_fields
  DROP CONSTRAINT IF EXISTS event_session_fields_dashboard_role_check;
ALTER TABLE event_session_fields
  ADD CONSTRAINT event_session_fields_dashboard_role_check
  CHECK (
    dashboard_role IS NULL
    OR dashboard_role IN ('identity', 'lunch_total', 'parking_kind')
  );

COMMENT ON COLUMN event_session_fields.dashboard_role IS
  '看板角色：identity / lunch_total / parking_kind（語意同 event_fields）';
COMMENT ON COLUMN event_session_fields.option_meta IS
  '選項層級 metadata，格式同 event_fields.option_meta';


-- ③ 驗證：列出已加上 dashboard_role 的欄位
-- SELECT event_id, field_key, field_label, dashboard_role, option_meta
-- FROM event_fields
-- WHERE dashboard_role IS NOT NULL
-- ORDER BY event_id, sort_order;
