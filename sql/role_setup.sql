-- ============================================================
-- 後台角色設定 — 普宜精舍報名系統
-- 執行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 步驟 1：設定師父帳號為 admin ──────────────────────────────
-- （請確認 puyi23282@gmail.com 已可正常登入後台）

UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE email = 'puyi23282@gmail.com';

-- 執行後應顯示 "1 row affected"
-- 若 0 row affected，表示帳號 email 不符，請到 Authentication → Users 確認正確 email


-- ── 步驟 2：建立義工共用帳號 ──────────────────────────────────
-- 請先到 Supabase Dashboard → Authentication → Users → 右上角「Add user」
-- 填入以下資料（建議）：
--   Email   : volunteer@puyi.reg  （虛擬信箱，不會真的寄信）
--   Password : 自訂，現場告知義工知識長
--   勾選 "Auto Confirm User"（不需驗證信）
-- 建立完成後，執行下方 SQL 設定義工角色：

UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"volunteer"'
)
WHERE email = 'volunteer@puyi.reg';
-- 若用不同 email，請把上面的 email 改成實際填入的


-- ── 驗證：確認兩個帳號角色都設定正確 ──────────────────────────
SELECT email,
       raw_user_meta_data->>'role' AS role
FROM auth.users
WHERE email IN ('puyi23282@gmail.com', 'volunteer@puyi.reg')
ORDER BY email;
-- 應該看到：
--   nirvana1050408@gmail.com (如果有) | admin
--   puyi23282@gmail.com               | admin
--   volunteer@puyi.reg                | volunteer
