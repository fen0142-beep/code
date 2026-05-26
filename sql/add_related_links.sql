-- V6: 活動相關連結
-- 在 Supabase Dashboard → SQL Editor 執行，或 deploy 前手動跑一次
ALTER TABLE events ADD COLUMN IF NOT EXISTS related_links JSONB DEFAULT '[]';
