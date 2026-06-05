-- ============================================================
-- Phase 2 補強 — Migration
-- 在 Supabase Dashboard → SQL Editor 執行一次
-- ============================================================
-- 變更內容：
-- 1. registrations 加 updated_at (timestamptz) + trigger 自動更新
-- 2. registrations 加 is_driver (boolean)  — 小車場景，含「車號」欄位者自動為 true
-- 3. head_leader 解除 (event_id,type) unique 約束，改成 (event_id,type,registration_id) unique
--    讓「小車領隊」可以多人
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. registrations.updated_at + is_driver
-- ────────────────────────────────────────────────────────────

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS is_driver  BOOLEAN     NOT NULL DEFAULT false;

COMMENT ON COLUMN registrations.updated_at IS '最後異動時間（INSERT/UPDATE 都會更新，名單顯示用此欄）';
COMMENT ON COLUMN registrations.is_driver  IS '是否為司機（小車自開場景，含車號欄位的報名為 true）';

-- 既有資料 updated_at 補成 registered_at（保留歷史時序）
UPDATE registrations
   SET updated_at = registered_at
 WHERE updated_at IS NULL OR updated_at = registered_at;


-- ────────────────────────────────────────────────────────────
-- 2. trigger：UPDATE 時自動推進 updated_at
-- ────────────────────────────────────────────────────────────

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


-- ────────────────────────────────────────────────────────────
-- 3. head_leader 解除 (event_id,type) unique，改 (event_id,type,registration_id)
--    讓小車領隊可多人；總領隊仍可以多人（彈性）
-- ────────────────────────────────────────────────────────────

-- 找出舊的 unique constraint 名稱（依 Supabase 慣例多為 head_leader_event_id_type_key）
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname, conkey
      FROM pg_constraint
     WHERE conrelid = 'head_leader'::regclass
       AND contype  = 'u'
  LOOP
    -- 只在「兩欄」的 unique 約束（舊的 event_id+type）才砍
    -- 新的三欄 unique（event_id+type+registration_id）會被保留
    IF array_length(con.conkey, 1) = 2 THEN
      EXECUTE format('ALTER TABLE head_leader DROP CONSTRAINT %I', con.conname);
    END IF;
  END LOOP;
END $$;

-- 新的多欄 unique（同一活動同一類型，同一 registration_id 只能出現一次）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'head_leader'::regclass
       AND conname  = 'head_leader_event_type_reg_uniq'
  ) THEN
    ALTER TABLE head_leader
      ADD CONSTRAINT head_leader_event_type_reg_uniq
      UNIQUE (event_id, type, registration_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. 索引（加速 updated_at 排序）
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_registrations_updated_at
  ON registrations(event_id, updated_at DESC);


-- ============================================================
-- 完成！執行後可用以下查詢確認：
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'registrations'
--      AND column_name IN ('updated_at','is_driver');
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'head_leader'::regclass;
-- ============================================================
