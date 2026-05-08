-- ══════════════════════════════════════════════════════════
-- Phase 2：registrations 加 host_student_id
-- 用於「學員代親友報名」的關聯：
--   親友 reg：student_id = NULL（仍是訪客模式）
--             host_student_id = 代報者學員編號
-- 排車邏輯依 host_student_id 自動把親友與代報者塞同車。
-- 在 Supabase SQL Editor 執行一次。
-- ══════════════════════════════════════════════════════════

-- 新增欄位（既有資料一律 NULL，向下相容）
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS host_student_id TEXT NULL
    REFERENCES students(student_id) ON DELETE SET NULL;

COMMENT ON COLUMN registrations.host_student_id IS
  '若為訪客且由某學員代報，記錄代報者 student_id（用於排車自動同車）';

-- 加索引（排車要依 event_id + host_student_id 撈出親友群）
CREATE INDEX IF NOT EXISTS idx_registrations_host
  ON registrations(host_student_id, event_id)
  WHERE host_student_id IS NOT NULL;

-- ── 確認執行結果 ────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'registrations' AND column_name = 'host_student_id';
