-- Q4 debug：列出 5/23 浴佛法會所有報名的 identity 值，找尾隨空格 / 變體
-- 用法：複製到 Supabase SQL Editor 跑

-- ① 用「值 + 字串長度」分組，看有沒有看起來一樣但長度不同的變體
SELECT
  r.answers->>'identity'                    AS identity_value,
  length(r.answers->>'identity')            AS char_len,
  octet_length(r.answers->>'identity')      AS byte_len,
  COUNT(*)                                  AS count
FROM registrations r
JOIN events e ON r.event_id = e.event_id
WHERE e.name LIKE '%浴佛%'
GROUP BY r.answers->>'identity', length(r.answers->>'identity'), octet_length(r.answers->>'identity')
ORDER BY count DESC;

-- ② 列出含「信眾」字樣但不完全等於「信眾」的那幾筆（看姓名）
SELECT
  r.student_id,
  COALESCE(s.name, r.answers->>'guest_name', '訪客') AS name,
  '[' || (r.answers->>'identity') || ']'             AS identity_quoted,
  length(r.answers->>'identity')                     AS len
FROM registrations r
JOIN events e ON r.event_id = e.event_id
LEFT JOIN students s ON r.student_id = s.student_id
WHERE e.name LIKE '%浴佛%'
  AND r.answers->>'identity' LIKE '%信眾%'
  AND r.answers->>'identity' != '信眾'
ORDER BY name;

-- ③ 算各身份原始計數（不去重 trim）vs trim 後計數
SELECT
  '原始 strict' AS mode,
  r.answers->>'identity'           AS val,
  COUNT(*)                         AS cnt
FROM registrations r
JOIN events e ON r.event_id = e.event_id
WHERE e.name LIKE '%浴佛%'
GROUP BY r.answers->>'identity'
UNION ALL
SELECT
  'TRIM 後合併' AS mode,
  TRIM(r.answers->>'identity')     AS val,
  COUNT(*)                         AS cnt
FROM registrations r
JOIN events e ON r.event_id = e.event_id
WHERE e.name LIKE '%浴佛%'
GROUP BY TRIM(r.answers->>'identity')
ORDER BY mode, val;
