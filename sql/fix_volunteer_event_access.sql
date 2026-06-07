-- ============================================================
-- 修正 volunteer_event_access 義工可自行擴權的問題
-- 日期：2026-06-07
-- 執行方式：貼到 Supabase Dashboard -> SQL Editor -> Run
--
-- 問題說明：
--   原政策 FOR ALL USING(true) WITH CHECK(true)
--   讓任何已登入的義工帳號，都能自行 INSERT 任意活動的存取權，
--   繞過師父的授權機制。
--
-- 修法：
--   admin 才能寫入（由 app_metadata.role 判斷）
--   義工只能讀自己被授權的活動
-- ============================================================

-- Step 1：移除過於寬鬆的舊政策
DROP POLICY IF EXISTS "volunteer_event_access: authenticated 完整存取" ON volunteer_event_access;

-- 以防萬一，也清掉其他可能存在的舊政策名稱
DROP POLICY IF EXISTS "authenticated full access" ON volunteer_event_access;
DROP POLICY IF EXISTS "Allow full access for authenticated" ON volunteer_event_access;

-- Step 2：admin 可以管理（新增、刪除、修改義工的活動授權）
CREATE POLICY "volunteer_event_access: admin 可管理"
  ON volunteer_event_access FOR ALL TO authenticated
  USING  (auth.jwt()->'app_metadata'->>'role' = 'admin')
  WITH CHECK (auth.jwt()->'app_metadata'->>'role' = 'admin');

-- Step 3：義工只能讀自己被授權的活動（不能寫）
CREATE POLICY "volunteer_event_access: 義工只能讀自己"
  ON volunteer_event_access FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());


-- ── 驗證（執行後可跑這幾行確認）────────────────────────────
/*
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'volunteer_event_access';
-- 預期：只剩兩筆：
--   "volunteer_event_access: admin 可管理"   (ALL, app_metadata check)
--   "volunteer_event_access: 義工只能讀自己" (SELECT, volunteer_id check)
*/
