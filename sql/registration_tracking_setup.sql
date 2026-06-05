-- registration_tracking_setup.sql
-- 報名異動追蹤功能
-- 請在 Supabase SQL Editor 執行此檔

-- ── ① 異動紀錄表 registration_changes ────────────────────────
CREATE TABLE IF NOT EXISTS registration_changes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid,                            -- 異動的報名 ID（取消後仍保留供參考）
  event_id         uuid        NOT NULL,
  event_name       text        NOT NULL DEFAULT '',  -- 活動名稱快照（不需 JOIN）
  student_name     text        NOT NULL DEFAULT '',  -- 學員/訪客姓名快照
  change_type      text        NOT NULL              -- 'created' | 'modified' | 'cancelled'
                   CHECK (change_type IN ('created','modified','cancelled')),
  old_answers      jsonb,                            -- 修改/取消前的答案
  new_answers      jsonb,                            -- 新增/修改後的答案
  changed_at       timestamptz NOT NULL DEFAULT now(),
  notified_at      timestamptz                       -- LINE 推送後標記，NULL = 尚未通知
);

CREATE INDEX IF NOT EXISTS idx_reg_changes_event
  ON registration_changes(event_id);

CREATE INDEX IF NOT EXISTS idx_reg_changes_unnotified
  ON registration_changes(notified_at) WHERE notified_at IS NULL;

-- RLS
ALTER TABLE registration_changes ENABLE ROW LEVEL SECURITY;

-- anon（前台學員刷卡）：只能新增
CREATE POLICY "anon can insert changes"
  ON registration_changes FOR INSERT TO anon WITH CHECK (true);

-- authenticated（師父後台）：完整存取
CREATE POLICY "authenticated full access on changes"
  ON registration_changes FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT INSERT ON registration_changes TO anon;
GRANT ALL ON registration_changes TO authenticated;

-- ── ② events 加 last_exported_at（最後一次匯出時間）────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS last_exported_at timestamptz;

-- ── ③ registrations 加 updated_at + 自動更新 trigger ──────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION update_registrations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrations_updated_at ON registrations;
CREATE TRIGGER trg_registrations_updated_at
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION update_registrations_updated_at();
