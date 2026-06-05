-- 活動介紹頁相關欄位 (2026-05-25)
-- 執行方式：在 Supabase Dashboard > SQL Editor 貼上執行

-- 1. events 表新增欄位
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS show_on_activities BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS offline_registration BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_tag TEXT DEFAULT 'zhongtai',
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. 建立 Storage bucket（已存在則略過）
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage 存取政策（先刪再建，避免重複執行報錯）
DROP POLICY IF EXISTS "allow_auth_upload"  ON storage.objects;
DROP POLICY IF EXISTS "allow_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "allow_auth_update"  ON storage.objects;
DROP POLICY IF EXISTS "allow_auth_delete"  ON storage.objects;

-- 已登入使用者可上傳
CREATE POLICY "allow_auth_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'event-covers');

-- 所有人可讀取（公開介紹頁用）
CREATE POLICY "allow_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'event-covers');

-- 已登入使用者可更新
CREATE POLICY "allow_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'event-covers');

-- 已登入使用者可刪除
CREATE POLICY "allow_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'event-covers');
