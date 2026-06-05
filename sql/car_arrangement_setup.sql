-- ═══════════════════════════════════════════════════════════
-- 批次 D：排車系統
-- 執行前提：events、registrations、students 資料表已存在
-- ═══════════════════════════════════════════════════════════

-- 1. 車輛表（每台車的基本資料）
CREATE TABLE IF NOT EXISTS car_assignments (
  car_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  car_name     text        NOT NULL,
  seats        int         NOT NULL DEFAULT 20,
  car_type     text        NOT NULL DEFAULT 'large' CHECK (car_type IN ('large', 'small')),
  note         text,
  access_token text        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

-- 2. 車輛成員表（每人只能在一台車）
CREATE TABLE IF NOT EXISTS car_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          uuid NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (registration_id)   -- 一人只能在一台車
);

-- 3. 領隊表（每台車可有多位領隊）
CREATE TABLE IF NOT EXISTS car_leaders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          uuid NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (car_id, registration_id)
);

-- 4. 總領隊表（每場活動一位）
CREATE TABLE IF NOT EXISTS head_leader (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  registration_id uuid        REFERENCES registrations(registration_id) ON DELETE SET NULL,
  access_token    text        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  UNIQUE (event_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_car_assignments_event ON car_assignments (event_id);
CREATE INDEX IF NOT EXISTS idx_car_members_car       ON car_members (car_id);
CREATE INDEX IF NOT EXISTS idx_car_leaders_car       ON car_leaders (car_id);

-- 5. 啟用 RLS
ALTER TABLE car_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_leaders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE head_leader     ENABLE ROW LEVEL SECURITY;

-- 6. RLS 政策（authenticated = 師父/義工；anon = 前台，不需存取）
CREATE POLICY "authenticated can manage car_assignments"
  ON car_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage car_members"
  ON car_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage car_leaders"
  ON car_leaders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage head_leader"
  ON head_leader FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON car_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON car_members     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON car_leaders     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON head_leader     TO authenticated;
