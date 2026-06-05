-- ══════════════════════════════════════════════
-- 取消報名功能 — 補 DELETE 權限
-- 在 Supabase Dashboard → SQL Editor 執行一次即可
-- ══════════════════════════════════════════════

-- 允許登入的師父（authenticated）刪除報名紀錄
GRANT DELETE ON registrations TO authenticated;

-- 允許前台匿名使用者（anon）刪除報名紀錄（學員自助取消）
GRANT DELETE ON registrations TO anon;

-- anon DELETE 的 RLS 政策（允許刪除任何報名紀錄）
CREATE POLICY "anon can delete registrations"
  ON registrations FOR DELETE TO anon
  USING (true);
