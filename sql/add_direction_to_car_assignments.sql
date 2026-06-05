-- 批次 4：上下山分開排車
-- 為 car_assignments 新增 direction 欄位（'up' = 上山、'down' = 下山）
-- 現有資料一律視為「下山」(回山法會結束後分車回家)

-- Step 1：加欄位（先允許 NULL 才能無痛加到既有資料）
ALTER TABLE car_assignments
  ADD COLUMN IF NOT EXISTS direction text;

-- Step 2：把現有 NULL 全部設為 'down'
UPDATE car_assignments
   SET direction = 'down'
 WHERE direction IS NULL;

-- Step 3：補上 NOT NULL + CHECK + DEFAULT
ALTER TABLE car_assignments
  ALTER COLUMN direction SET NOT NULL,
  ALTER COLUMN direction SET DEFAULT 'down';

-- 移除舊的 CHECK（若存在）並重建
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'car_assignments_direction_check'
  ) THEN
    ALTER TABLE car_assignments DROP CONSTRAINT car_assignments_direction_check;
  END IF;
END $$;

ALTER TABLE car_assignments
  ADD CONSTRAINT car_assignments_direction_check
  CHECK (direction IN ('up', 'down'));

-- Step 4：補上索引（依 event_id + direction 查詢頻繁）
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_direction
  ON car_assignments (event_id, direction);

-- 確認
SELECT direction, COUNT(*) FROM car_assignments GROUP BY direction;
