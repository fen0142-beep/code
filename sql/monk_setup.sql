-- ═══════════════════════════════════════════════════════
--  法師管理系統 — monk_setup.sql
--  執行前提：car_assignment_setup.sql 已執行（car_assignments 表存在）
-- ═══════════════════════════════════════════════════════

-- ─── 1. temple_monks — 法師名單 ────────────────────────
CREATE TABLE IF NOT EXISTS temple_monks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  notes       text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. car_monks — 每台車的法師指派 + 報到狀態 ────────
CREATE TABLE IF NOT EXISTS car_monks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id         uuid        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  monk_id        uuid        NOT NULL REFERENCES temple_monks(id) ON DELETE CASCADE,
  checked_in_at  timestamptz,
  UNIQUE(car_id, monk_id)
);

CREATE INDEX IF NOT EXISTS idx_car_monks_car_id  ON car_monks(car_id);
CREATE INDEX IF NOT EXISTS idx_car_monks_monk_id ON car_monks(monk_id);

-- ─── 3. RLS ────────────────────────────────────────────
ALTER TABLE temple_monks ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_monks    ENABLE ROW LEVEL SECURITY;

-- temple_monks：登入者完整存取，anon 唯讀
CREATE POLICY "temple_monks_auth_all"  ON temple_monks FOR ALL       TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "temple_monks_anon_read" ON temple_monks FOR SELECT    TO anon           USING (true);

-- car_monks：登入者完整存取，anon 可讀 + 可更新（供領隊頁打卡）
CREATE POLICY "car_monks_auth_all"     ON car_monks FOR ALL          TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "car_monks_anon_select"  ON car_monks FOR SELECT       TO anon           USING (true);
CREATE POLICY "car_monks_anon_update"  ON car_monks FOR UPDATE       TO anon           USING (true) WITH CHECK (true);

-- ─── 4. GRANT ──────────────────────────────────────────
GRANT SELECT               ON temple_monks TO anon;
GRANT SELECT, UPDATE       ON car_monks    TO anon;
GRANT ALL                  ON temple_monks TO authenticated;
GRANT ALL                  ON car_monks    TO authenticated;
