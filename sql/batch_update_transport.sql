-- ============================================================
-- 批次更新：身分別為「信眾」的學員，上下山交通改為「精舍搭車」
-- 使用方式：
--   1. 先執行「第一步」，確認影響筆數與內容
--   2. 確認無誤後，再執行「第二步」正式更新
-- ============================================================


-- ★ 第一步：預覽（只查不改）
SELECT
  registration_id,
  answers->>'identity'      AS 身分別,
  answers->>'transport_up'  AS 上山交通_舊,
  answers->>'transport_down' AS 下山交通_舊
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;


-- ★ 第二步：正式更新（確認第一步結果正確後再執行）
--   - transport_up / transport_down 改為「精舍搭車」
--   - 順手移除 plate_up / plate_down（信眾不開車，不需要車牌）
UPDATE registrations
SET answers = (
  answers
  || jsonb_build_object(
       'transport_up',   '精舍搭車',
       'transport_down', '精舍搭車'
     )
) - 'plate_up' - 'plate_down'
WHERE answers->>'identity' = '信眾';


-- ★ 第三步：驗收（更新後再跑一次確認）
SELECT
  registration_id,
  answers->>'identity'      AS 身分別,
  answers->>'transport_up'  AS 上山交通_新,
  answers->>'transport_down' AS 下山交通_新
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;
