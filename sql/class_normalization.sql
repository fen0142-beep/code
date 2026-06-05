-- ================================================================
-- 班級名稱統一化
-- 目標格式：日間初級班 / 夜間初級班 / 日間中級班 / 夜間中級班
--           日間高級班 / 夜間高級班 / 日間研經班 / 夜間研經班
--
-- 步驟 1：先確認現有班級名稱（執行後確認再做 UPDATE）
-- 步驟 2：執行 UPDATE
-- ================================================================

-- ── 步驟 1：查看現有名稱分佈 ──────────────────────────────────
SELECT class_name, COUNT(*) AS 人數
FROM student_classes
GROUP BY class_name
ORDER BY class_name;

-- ── 步驟 2：執行統一化 UPDATE ─────────────────────────────────
-- （確認步驟 1 的結果正確後再執行此段）

UPDATE student_classes
SET class_name = CASE
  -- 初級班 -------------------------------------------------------
  WHEN class_name ILIKE '%初級%日%'  OR
       class_name ILIKE '%日%初級%'  THEN '日間初級班'
  WHEN class_name ILIKE '%初級%夜%'  OR
       class_name ILIKE '%夜%初級%'  THEN '夜間初級班'
  -- 中級班 -------------------------------------------------------
  WHEN class_name ILIKE '%中級%日%'  OR
       class_name ILIKE '%日%中級%'  THEN '日間中級班'
  WHEN class_name ILIKE '%中級%夜%'  OR
       class_name ILIKE '%夜%中級%'  THEN '夜間中級班'
  -- 高級班 -------------------------------------------------------
  WHEN class_name ILIKE '%高級%日%'  OR
       class_name ILIKE '%日%高級%'  THEN '日間高級班'
  WHEN class_name ILIKE '%高級%夜%'  OR
       class_name ILIKE '%夜%高級%'  THEN '夜間高級班'
  -- 研經班 -------------------------------------------------------
  WHEN class_name ILIKE '%研經%日%'  OR
       class_name ILIKE '%日%研經%'  THEN '日間研經班'
  WHEN class_name ILIKE '%研經%夜%'  OR
       class_name ILIKE '%夜%研經%'  THEN '夜間研經班'
  -- 其餘不變（手動確認）
  ELSE class_name
END
WHERE class_name NOT IN (
  '日間初級班','夜間初級班',
  '日間中級班','夜間中級班',
  '日間高級班','夜間高級班',
  '日間研經班','夜間研經班'
);

-- ── 步驟 3：確認結果 ──────────────────────────────────────────
SELECT class_name, COUNT(*) AS 人數
FROM student_classes
GROUP BY class_name
ORDER BY class_name;
