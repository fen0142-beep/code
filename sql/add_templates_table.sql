-- ══════════════════════════════════════════════════════════
-- 模板管理：建立 event_templates 資料表
-- 在 Supabase SQL Editor 執行一次
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_templates (
  template_id  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  fields       jsonb       NOT NULL DEFAULT '[]',
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;

-- 師父（authenticated）：完整存取
CREATE POLICY "authenticated full access on event_templates"
  ON event_templates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON TABLE event_templates TO authenticated;

-- ── 插入內建模板 ─────────────────────────────────────────

INSERT INTO event_templates (name, sort_order, fields) VALUES

('回山模板', 1, '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求"}
]'::jsonb),

('精舍模板', 2, '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"need_parking","field_label":"是否需要停車位","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null}
]'::jsonb);
