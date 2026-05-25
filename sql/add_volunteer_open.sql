-- V5: 義工開放模式
-- 在 Supabase Dashboard → SQL Editor 執行，或 deploy 前手動跑一次
ALTER TABLE events ADD COLUMN IF NOT EXISTS volunteer_open BOOLEAN DEFAULT false;
