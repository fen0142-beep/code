-- 新增小車（及大車）提前出發旗標
-- 2026-05-21 二度

ALTER TABLE car_assignments
  ADD COLUMN IF NOT EXISTS pre_depart BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN car_assignments.pre_depart IS '提前出發旗標：勾選後總領隊看板顯示「提前出發」badge，並從當天應到人數中排除';
