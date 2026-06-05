-- 上下山各自獨立報到狀態
-- 2026-05-23
--
-- 背景：原本 checked_in_at 存在 registrations 表（每人每活動一筆），
--       上山報到後下山也會顯示「已到」。
--       改為在 car_members 加方向級別的 checked_in_at，
--       CarCheckinPage 改讀此欄，reportCounts 也從 car_members 計算。
--
-- registrations.checked_in_at 保留（KioskPage / CheckinPage 現場報到仍用）。

ALTER TABLE car_members
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

COMMENT ON COLUMN car_members.checked_in_at
  IS '領隊報到頁方向級別報到時間（上山/下山各自獨立）；
      registrations.checked_in_at 由 KioskPage 現場刷卡報到使用，兩者獨立。';

-- 其他交通（不歸大小車）的下山報到獨立欄位
-- 上山繼續用原 checked_in_at，下山用此欄
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS checked_in_down_at TIMESTAMPTZ;

COMMENT ON COLUMN registrations.checked_in_down_at
  IS '「其他交通」成員下山報到時間（上山用 checked_in_at，下山用此欄）';
