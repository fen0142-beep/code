-- 新增小車「延後回程」旗標 + 個人提前/延後覆寫欄位
-- 2026-05-22
--
-- 設計：
--   car_assignments.late_return       — 小車整車延後回程（對稱 pre_depart）
--   registrations.pre_depart_override — 個人手動標記提前（其他交通的人用，因為不歸任何車）
--   registrations.late_return_override— 個人手動標記延後
--
-- 自動判別仍走 answers 掃描（getPreArriveInfo / getLateReturnInfo），
-- override 欄位專門讓師父在後台排車頁手動補標（尤其其他交通的人）。

ALTER TABLE car_assignments
  ADD COLUMN IF NOT EXISTS late_return BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN car_assignments.late_return IS '延後回程旗標：勾選後總領隊看板顯示「延後回程」badge，並從當天應到人數中排除（下山方向用）';

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS pre_depart_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_return_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN registrations.pre_depart_override IS '師父手動標記此人為提前出發（其他交通的人專用，因為不歸任何車）';
COMMENT ON COLUMN registrations.late_return_override IS '師父手動標記此人為延後回程';
