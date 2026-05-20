-- ============================================================================
-- registrations 表新增 source 欄位
-- 用途：區分報名來源
--   - 'kiosk'  ：前台 KioskPage 學員自己刷卡報名（預設、含現有舊資料）
--   - 'walkin' ：報到頁現場補報（紅卡按「現場報名」按鈕）
--   - 'manual' ：後台手動新增
-- 影響：報到頁統計列顯示「現場 X」chip；後台 CSV / 名單可分流追蹤
-- 安全性：NOT NULL DEFAULT 'kiosk'，舊資料自動填 kiosk，不影響既有邏輯
-- ============================================================================

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'kiosk';

COMMENT ON COLUMN registrations.source IS
  'kiosk=前台刷卡 / walkin=報到頁現場補報 / manual=後台手動';

-- 驗證
SELECT source, COUNT(*) FROM registrations GROUP BY source;
