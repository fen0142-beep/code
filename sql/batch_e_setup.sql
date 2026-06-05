-- ═══════════════════════════════════════════════════════════
-- 批次 E：領隊報到頁
-- 讓 anon（公開領隊頁）能夠讀取排車資料
-- 執行前提：car_arrangement_setup.sql 已執行
-- ═══════════════════════════════════════════════════════════

-- 1. car_assignments：anon 可讀（token 驗證在應用層）
CREATE POLICY "anon can read car_assignments"
  ON car_assignments FOR SELECT TO anon USING (true);

-- 2. car_members：anon 可讀
CREATE POLICY "anon can read car_members"
  ON car_members FOR SELECT TO anon USING (true);

-- 3. car_leaders：anon 可讀
CREATE POLICY "anon can read car_leaders"
  ON car_leaders FOR SELECT TO anon USING (true);

-- 4. head_leader：anon 可讀
CREATE POLICY "anon can read head_leader"
  ON head_leader FOR SELECT TO anon USING (true);

-- 5. GRANT SELECT
GRANT SELECT ON car_assignments TO anon;
GRANT SELECT ON car_members     TO anon;
GRANT SELECT ON car_leaders     TO anon;
GRANT SELECT ON head_leader     TO anon;

-- 6. 確保 anon 可以更新 registrations.checked_in_at（若已存在則忽略錯誤）
--    領隊報到頁需要直接更新報到狀態
GRANT SELECT, INSERT, UPDATE ON registrations TO anon;
