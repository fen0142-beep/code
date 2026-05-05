-- ═══════════════════════════════════════════════════════════
-- 批次 C：關係連結系統
-- 執行前提：students 資料表已存在
-- ═══════════════════════════════════════════════════════════

-- 1. 群組表
CREATE TABLE IF NOT EXISTS relationship_groups (
  group_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  note       text,
  created_at timestamptz DEFAULT now()
);

-- 2. 群組成員表
CREATE TABLE IF NOT EXISTS relationship_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES relationship_groups(group_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (group_id, student_id)
);

-- 索引：依群組查成員
CREATE INDEX IF NOT EXISTS idx_rel_members_group
  ON relationship_members (group_id);

-- 索引：依學員查所屬群組
CREATE INDEX IF NOT EXISTS idx_rel_members_student
  ON relationship_members (student_id);

-- 3. 啟用 RLS
ALTER TABLE relationship_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_members ENABLE ROW LEVEL SECURITY;

-- 4. RLS 政策
--   anon（前台）：不需存取
--   authenticated（師父/義工）：完整存取

CREATE POLICY "authenticated can manage relationship_groups"
  ON relationship_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage relationship_members"
  ON relationship_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON relationship_groups  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON relationship_members TO authenticated;
