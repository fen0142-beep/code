-- ============================================================
-- 修正 registrations anon SELECT 過於開放的問題
-- 日期：2026-06-07
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 改動說明：
--   目前 "anon can select registrations" 政策是 USING(true)，
--   任何人可以查詢全場所有報名記錄（含 guest_phone）。
--
--   修法：
--   1. 建立 SECURITY DEFINER RPC kiosk_get_registrations_for_student
--      - 呼叫時必須提供 student_id，只回傳該學員相關的記錄
--      - 自動從 answers 移除 guest_phone（遮蔽電話號碼）
--   2. 移除開放的 anon SELECT 政策
--
--   前端 supabase.js 需同步更新（見配套說明）
-- ============================================================


-- ── Step 1：建立 Kiosk 專用 RPC ──────────────────────────────

CREATE OR REPLACE FUNCTION kiosk_get_registrations_for_student(
  p_student_id TEXT,
  p_event_ids  UUID[]
)
RETURNS TABLE (
  registration_id UUID,
  event_id        UUID,
  student_id      TEXT,
  host_student_id TEXT,
  answers         JSONB,
  is_driver       BOOLEAN,
  registered_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 限制：只回傳此 student_id 作為本人或代報者的記錄
  -- 並從 answers 移除 guest_phone（phone 是一次性欄位，不需要暴露給前台）
  RETURN QUERY
  SELECT
    r.registration_id,
    r.event_id,
    r.student_id,
    r.host_student_id,
    (r.answers - 'guest_phone') AS answers,   -- 遮掉親友電話
    r.is_driver,
    r.registered_at,
    r.updated_at
  FROM registrations r
  WHERE r.event_id = ANY(p_event_ids)
    AND (
      r.student_id      = p_student_id   -- 學員本人的報名
      OR r.host_student_id = p_student_id  -- 學員代報親友的紀錄
    );
END;
$$;

-- anon 和 authenticated 都可以呼叫（Kiosk 用 anon，後台用 authenticated）
GRANT EXECUTE ON FUNCTION kiosk_get_registrations_for_student(TEXT, UUID[]) TO anon, authenticated;


-- ── Step 2：移除開放的 anon SELECT 政策 ──────────────────────

DROP POLICY IF EXISTS "anon can select registrations" ON registrations;

-- authenticated 的全覆蓋政策保持不變（已存在，不需重建）
-- 確認 authenticated 政策還在：
-- SELECT policyname, cmd FROM pg_policies
-- WHERE tablename = 'registrations' AND roles @> '{authenticated}';


-- ── Step 3：驗證（執行後可跑這幾行確認）──────────────────────
/*
-- 確認 registrations 的 anon 政策只剩 INSERT
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'registrations' AND roles @> '{anon}';
-- 預期：只有 "anon can insert registrations"（INSERT）

-- 確認 RPC 存在
SELECT proname FROM pg_proc WHERE proname = 'kiosk_get_registrations_for_student';
-- 預期：1 筆
*/
