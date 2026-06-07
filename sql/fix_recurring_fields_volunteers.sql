-- fix_recurring_fields_volunteers.sql
-- 修復 create_recurring_events_in_range：
-- 原版只 INSERT events，不複製 event_fields 和 volunteer_event_access
-- 本次補上：RETURNING event_id -> 複製動態欄位 + 義工存取設定

CREATE OR REPLACE FUNCTION create_recurring_events_in_range(
  p_template_id uuid,
  p_date_start  date,
  p_date_end    date
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  tmpl         recurring_templates%ROWTYPE;
  cur_date     date;
  event_name   text;
  new_event_id uuid;
  created_cnt  int := 0;
  field_rec    jsonb;
  vol_id       text;
  sort_idx     int;
BEGIN
  SELECT * INTO tmpl FROM recurring_templates WHERE template_id = p_template_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  cur_date := p_date_start;

  WHILE cur_date <= p_date_end LOOP
    IF (tmpl.frequency = 'weekly'  AND EXTRACT(DOW FROM cur_date)::int = tmpl.day_of_week)
    OR (tmpl.frequency = 'monthly' AND EXTRACT(DAY FROM cur_date)::int = tmpl.day_of_month)
    THEN
      IF tmpl.prepend_date THEN
        event_name := to_char(cur_date, 'YYYY/MM/DD') || ' ' || tmpl.name;
      ELSE
        event_name := tmpl.name;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM events
        WHERE template_id = p_template_id
          AND date_start  = cur_date
      ) THEN
        -- 建活動，並拿回 event_id
        INSERT INTO events (
          name, date_start, date_end,
          location, location_tag, event_type, status,
          walkin_mode, kiosk_open, offline_registration, show_on_activities,
          is_recurring, template_id
        ) VALUES (
          event_name, cur_date, cur_date,
          tmpl.location, tmpl.location_tag, tmpl.event_type, 'active',
          tmpl.walkin_mode, tmpl.kiosk_open, tmpl.offline_registration, tmpl.show_on_activities,
          true, p_template_id
        )
        RETURNING event_id INTO new_event_id;

        -- ── 複製動態欄位 ────────────────────────────────────────
        IF tmpl.fields IS NOT NULL AND jsonb_array_length(tmpl.fields) > 0 THEN
          sort_idx := 1;
          FOR field_rec IN SELECT * FROM jsonb_array_elements(tmpl.fields) LOOP
            INSERT INTO event_fields (
              event_id, field_key, field_label, field_type,
              options, show_if, sort_order, required,
              placeholder, dashboard_role, option_meta
            ) VALUES (
              new_event_id,
              field_rec->>'field_key',
              field_rec->>'field_label',
              field_rec->>'field_type',
              COALESCE(field_rec->'options', '[]'::jsonb),
              field_rec->'show_if',
              sort_idx,
              COALESCE((field_rec->>'required')::boolean, true),
              field_rec->>'placeholder',
              field_rec->>'dashboard_role',
              field_rec->'option_meta'
            );
            sort_idx := sort_idx + 1;
          END LOOP;
        END IF;

        -- ── 複製義工存取設定 ─────────────────────────────────────
        IF tmpl.volunteer_ids IS NOT NULL AND jsonb_array_length(tmpl.volunteer_ids) > 0 THEN
          FOR vol_id IN SELECT jsonb_array_elements_text(tmpl.volunteer_ids) LOOP
            INSERT INTO volunteer_event_access (volunteer_id, event_id)
            VALUES (vol_id, new_event_id)
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;

        created_cnt := created_cnt + 1;
      END IF;
    END IF;

    cur_date := cur_date + 1;
  END LOOP;

  RETURN created_cnt;
END;
$$;
