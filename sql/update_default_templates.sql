-- ============================================================
-- 更新內建模板：精舍模板 / 回山模板，補上 dashboard_role + option_meta
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-18
--
-- 前置條件：先跑過 sql/dashboard_role_migration.sql
--          （但本檔只動 event_templates.fields 內的 jsonb，不依賴 DB schema）
--
-- 重要變更（精舍模板）：
--   - need_parking (boolean)        → parking_type (radio) + parking_kind 角色
--     原本是 boolean「是否需要停車位」，看板統計不出車輛數；
--     改 radio + 三選一，並用 option_meta 標記每個選項的車種
--   - identity / need_lunch / 新 parking_type 都加上 dashboard_role
--
-- 既有活動不受影響：本 UPDATE 只改模板本體，不會碰已建立的 event_fields
-- ============================================================

-- ① 精舍模板：四個 field 都重設
UPDATE event_templates
SET fields = '[
  {
    "field_key": "identity",
    "field_label": "身份別",
    "field_type": "radio",
    "options": ["信眾","義工"],
    "show_if": null,
    "required": true,
    "placeholder": null,
    "dashboard_role": "identity",
    "option_meta": null
  },
  {
    "field_key": "need_lunch",
    "field_label": "是否需要午齋",
    "field_type": "boolean",
    "options": [],
    "show_if": null,
    "required": true,
    "placeholder": null,
    "dashboard_role": "lunch_total",
    "option_meta": null
  },
  {
    "field_key": "parking_type",
    "field_label": "停車需求",
    "field_type": "radio",
    "options": ["機車","汽車","不需要"],
    "show_if": null,
    "required": true,
    "placeholder": null,
    "dashboard_role": "parking_kind",
    "option_meta": {
      "機車": "motorcycle",
      "汽車": "car",
      "不需要": "none"
    }
  },
  {
    "field_key": "volunteer_group",
    "field_label": "組別",
    "field_type": "radio",
    "options": ["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],
    "show_if": {"identity":"義工"},
    "required": true,
    "placeholder": null,
    "dashboard_role": null,
    "option_meta": null
  }
]'::jsonb
WHERE name = '精舍模板';

-- ② 回山模板：identity 加 dashboard_role，其他維持原樣
UPDATE event_templates
SET fields = '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求","dashboard_role":null,"option_meta":null}
]'::jsonb
WHERE name = '回山模板';

-- ③ 驗證：列出更新後的模板（看 dashboard_role / option_meta 是否進去）
-- SELECT name, jsonb_pretty(fields)
-- FROM event_templates
-- WHERE name IN ('精舍模板','回山模板');
