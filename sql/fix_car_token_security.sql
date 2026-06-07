-- ============================================================
-- Fix Car Token Security
-- Run after existing schema
-- ============================================================

-- 1. Remove car_assignments anon SELECT policy
DROP POLICY IF EXISTS "anon can read car_assignments" ON car_assignments;

-- 2. RPC: get car by token (with full JOIN data)
CREATE OR REPLACE FUNCTION get_car_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.access_token = p_token
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;

-- 3. RPC: get linked cars for leader (token-verified)
CREATE OR REPLACE FUNCTION get_leader_cars(p_token TEXT, p_car_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  result JSON;
BEGIN
  SELECT event_id INTO v_event_id
  FROM car_assignments WHERE access_token = p_token LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN '[]'::JSON;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return, ca.access_token,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = ANY(p_car_ids)
      AND ca.event_id = v_event_id
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;

-- 4. RPC: check in car member (token-verified)
CREATE OR REPLACE FUNCTION checkin_car_member(
  p_token TEXT,
  p_car_id UUID,
  p_registration_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  UPDATE car_members
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE car_id = p_car_id AND registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_member(TEXT, UUID, UUID, BOOLEAN) TO anon, authenticated;

-- 5. RPC: check in all car members (token-verified)
CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  UPDATE car_members
  SET checked_in_at = NOW()
  WHERE car_id = p_car_id AND checked_in_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_all_car(TEXT, UUID) TO anon, authenticated;

-- 6. RPC: check in monk (token-verified)
CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_monks ck
    JOIN car_assignments ca ON ca.car_id = ck.car_id
    WHERE ck.id = p_car_monk_id AND ca.access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;

-- 7. Remove car_members / car_monks anon UPDATE policies
DROP POLICY IF EXISTS "anon can update car_members" ON car_members;
DROP POLICY IF EXISTS "car_monks_anon_update" ON car_monks;
