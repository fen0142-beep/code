-- ═══════════════════════════════════════════════════════════
-- 小車領隊設定 — head_leader 表結構更新
-- 執行時機：批次 F 部署前
-- ═══════════════════════════════════════════════════════════

-- Step 1：加入 type 欄位（預設 'all'，向下相容既有資料）
ALTER TABLE head_leader
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'all';

-- Step 2：確保現有資料都有正確的 type 值
UPDATE head_leader SET type = 'all' WHERE type IS NULL OR type = '';

-- Step 3：移除原本只針對 event_id 的 unique constraint
--         （允許同一活動同時有 'all' 和 'small_car' 兩筆）
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'head_leader'::regclass
    AND contype = 'u'
    AND conkey = ARRAY(
      SELECT attnum
      FROM pg_attribute
      WHERE attrelid = 'head_leader'::regclass
        AND attname = 'event_id'
        AND NOT attisdropped
    );

  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE head_leader DROP CONSTRAINT ' || quote_ident(c_name);
    RAISE NOTICE '已移除舊約束 %', c_name;
  ELSE
    RAISE NOTICE '未找到僅 event_id 的 unique 約束（可能已更新）';
  END IF;
END $$;

-- Step 4：加入新的複合 unique constraint
ALTER TABLE head_leader
  DROP CONSTRAINT IF EXISTS head_leader_event_id_type_key;

ALTER TABLE head_leader
  ADD CONSTRAINT head_leader_event_id_type_key UNIQUE (event_id, type);

-- Step 5：確保 anon 可讀取（/leader 掃卡頁面需要）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'head_leader'
      AND policyname = 'anon can select head_leader'
  ) THEN
    CREATE POLICY "anon can select head_leader"
      ON head_leader FOR SELECT TO anon USING (true);
    RAISE NOTICE '已建立 anon SELECT policy';
  ELSE
    RAISE NOTICE 'anon SELECT policy 已存在，略過';
  END IF;
END $$;

-- Step 6：確保 anon 可讀 car_leaders（findLeaderByStudentId 需要）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'car_leaders'
      AND policyname = 'anon can select car_leaders'
  ) THEN
    CREATE POLICY "anon can select car_leaders"
      ON car_leaders FOR SELECT TO anon USING (true);
    RAISE NOTICE '已建立 car_leaders anon SELECT policy';
  ELSE
    RAISE NOTICE 'car_leaders anon SELECT policy 已存在，略過';
  END IF;
END $$;

GRANT SELECT ON head_leader TO anon;
GRANT SELECT ON car_leaders TO anon;
GRANT SELECT ON car_assignments TO anon;
GRANT SELECT ON car_members TO anon;
