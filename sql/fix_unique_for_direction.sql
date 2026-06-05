-- 批次 4 修正：上下山分開排車後，同一個 registration_id 會同時存在上山與下山兩台車
-- 原本 car_members.registration_id 是全域唯一，要改成「同車內唯一」
-- 同步處理 car_leaders、car_monks（避免同一人/法師同時做兩個方向領隊或搭兩台車時也出錯）

-- ─── 1. car_members ────────────────────────────────────────
ALTER TABLE car_members DROP CONSTRAINT IF EXISTS car_members_registration_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_members_car_registration_unique'
  ) THEN
    ALTER TABLE car_members
      ADD CONSTRAINT car_members_car_registration_unique
      UNIQUE (car_id, registration_id);
  END IF;
END $$;

-- ─── 2. car_leaders ────────────────────────────────────────
ALTER TABLE car_leaders DROP CONSTRAINT IF EXISTS car_leaders_registration_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_leaders_car_registration_unique'
  ) THEN
    ALTER TABLE car_leaders
      ADD CONSTRAINT car_leaders_car_registration_unique
      UNIQUE (car_id, registration_id);
  END IF;
END $$;

-- ─── 3. car_monks ──────────────────────────────────────────
ALTER TABLE car_monks DROP CONSTRAINT IF EXISTS car_monks_monk_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_monks_car_monk_unique'
  ) THEN
    ALTER TABLE car_monks
      ADD CONSTRAINT car_monks_car_monk_unique
      UNIQUE (car_id, monk_id);
  END IF;
END $$;

-- 確認
SELECT conname, conrelid::regclass AS table_name
  FROM pg_constraint
 WHERE conrelid IN ('car_members'::regclass, 'car_leaders'::regclass, 'car_monks'::regclass)
   AND contype = 'u';
