-- ============================================================
-- 一次完成三件事：
--   A. 把活動欄位「交通方式」選項改為包含「精舍搭車」「搭學員的車」
--   B. 在活動欄位中插入「上山共乘者」「下山共乘者」（條件顯示）
--   C. 把已報名的「信眾」上下山交通改為「精舍搭車」
--
-- 建議執行順序：
--   1. 先跑「預覽查詢」確認現況
--   2. 再跑「正式更新」
-- ============================================================


-- ============================================================
-- 【預覽】查看目前活動欄位結構
-- ============================================================
SELECT
  e.name        AS 活動名稱,
  ef.sort_order AS 順序,
  ef.field_key  AS 欄位key,
  ef.field_label AS 欄位名稱,
  ef.options    AS 選項
FROM events e
JOIN event_fields ef ON e.event_id = ef.event_id
ORDER BY e.name, ef.sort_order;


-- ============================================================
-- 【預覽】查看身分別=信眾的報名資料（確認影響範圍）
-- ============================================================
SELECT
  registration_id,
  answers->>'identity'       AS 身分別,
  answers->>'transport_up'   AS 上山交通_舊,
  answers->>'transport_down' AS 下山交通_舊
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;


-- ============================================================
-- 【正式更新 A+B】更新活動欄位設定
--   - 把 transport_up / transport_down 的選項更新
--   - 在每個有 transport_up 的活動裡插入 carpool_up / carpool_down
--   - 自動調整 sort_order，插到正確位置
-- ============================================================
DO $$
DECLARE
  ev      RECORD;
  s_up    int;
  s_down  int;
BEGIN
  FOR ev IN
    SELECT DISTINCT event_id FROM event_fields WHERE field_key = 'transport_up'
  LOOP

    -- A. 更新上下山交通方式選項
    UPDATE event_fields
    SET options = '["精舍搭車","搭學員的車","自行開車","其他"]'::jsonb
    WHERE event_id = ev.event_id
      AND field_key IN ('transport_up', 'transport_down');

    -- B. 插入共乘者欄位（若已存在則跳過）
    IF NOT EXISTS (
      SELECT 1 FROM event_fields
      WHERE event_id = ev.event_id AND field_key = 'carpool_up'
    ) THEN

      -- 取 transport_up 的 sort_order
      SELECT sort_order INTO s_up
      FROM event_fields
      WHERE event_id = ev.event_id AND field_key = 'transport_up';

      -- 把 transport_up 之後的欄位全部 +1，騰出位置
      UPDATE event_fields
      SET sort_order = sort_order + 1
      WHERE event_id = ev.event_id AND sort_order > s_up;

      -- 插入「上山共乘者」
      INSERT INTO event_fields
        (event_id, field_key, field_label, field_type, options, show_if, sort_order, required)
      VALUES
        (ev.event_id, 'carpool_up', '上山共乘者（學員姓名）', 'text',
         '[]'::jsonb, '{"transport_up":"搭學員的車"}'::jsonb, s_up + 1, false);

      -- 再取 transport_down 的 sort_order（已被上面的 +1 移過了）
      SELECT sort_order INTO s_down
      FROM event_fields
      WHERE event_id = ev.event_id AND field_key = 'transport_down';

      -- 把 transport_down 之後的欄位全部 +1
      UPDATE event_fields
      SET sort_order = sort_order + 1
      WHERE event_id = ev.event_id AND sort_order > s_down;

      -- 插入「下山共乘者」
      INSERT INTO event_fields
        (event_id, field_key, field_label, field_type, options, show_if, sort_order, required)
      VALUES
        (ev.event_id, 'carpool_down', '下山共乘者（學員姓名）', 'text',
         '[]'::jsonb, '{"transport_down":"搭學員的車"}'::jsonb, s_down + 1, false);

    END IF;
  END LOOP;
END $$;


-- ============================================================
-- 【正式更新 C】把身分別=信眾的報名，交通方式改為「精舍搭車」
-- ============================================================
UPDATE registrations
SET answers = (
  answers
  || jsonb_build_object(
       'transport_up',   '精舍搭車',
       'transport_down', '精舍搭車'
     )
) - 'plate_up' - 'plate_down'
WHERE answers->>'identity' = '信眾';


-- ============================================================
-- 【驗收】確認欄位結構與資料都正確
-- ============================================================

-- 確認欄位順序
SELECT
  e.name        AS 活動名稱,
  ef.sort_order AS 順序,
  ef.field_key  AS 欄位key,
  ef.field_label AS 欄位名稱,
  ef.show_if    AS 條件顯示
FROM events e
JOIN event_fields ef ON e.event_id = ef.event_id
ORDER BY e.name, ef.sort_order;

-- 確認信眾資料已更新
SELECT
  registration_id,
  answers->>'identity'       AS 身分別,
  answers->>'transport_up'   AS 上山交通_新,
  answers->>'transport_down' AS 下山交通_新
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;
