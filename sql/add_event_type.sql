-- ══════════════════════════════════════════════════════════
-- Phase 1：events 加活動類型 / 法會旗標
-- 並升級精舍模板，把停車方式改為 radio（不需要 / 機車 / 轎車）
-- 在 Supabase SQL Editor 執行一次
-- ══════════════════════════════════════════════════════════

-- ── 1. events 加兩個欄位 ────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'mountain'
    CHECK (event_type IN ('temple', 'mountain'));

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_dharma BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.event_type IS '活動類型：temple=精舍活動、mountain=回山活動';
COMMENT ON COLUMN events.is_dharma  IS '是否為法會（控制功德主管理顯示）';

-- ── 2. 升級精舍模板：parking_type 改為 radio ────────────────

UPDATE event_templates
SET fields = '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"parking_type","field_label":"停車方式","field_type":"radio","options":["不需要","機車","轎車"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null}
]'::jsonb
WHERE name = '精舍模板';

-- ── 3. 確認執行結果（執行後可貼上跑一下看欄位是否都到齊） ────
-- SELECT event_type, is_dharma FROM events LIMIT 1;
-- SELECT name, fields FROM event_templates WHERE name = '精舍模板';
