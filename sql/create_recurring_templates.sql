-- 定期活動範本表
-- 每筆範本定義一個週期性活動的基本設定
-- Batch 1：建表（自動產生邏輯在 Batch 2 實作）

CREATE TABLE IF NOT EXISTS recurring_templates (
  template_id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text    NOT NULL,          -- 活動名稱（不含日期）
  prepend_date         boolean DEFAULT true,      -- 建立時是否自動在前加 YYYY/MM/DD
  frequency            text    NOT NULL CHECK (frequency IN ('weekly','monthly')),
  day_of_week          smallint,                  -- 0=日 1=一 2=二 3=三 4=四 5=五 6=六（weekly 用）
  day_of_month         smallint,                  -- 1-31（monthly 用）
  location             text    DEFAULT '',
  location_tag         text    DEFAULT 'puyi',
  event_type           text    DEFAULT 'temple',
  walkin_mode          boolean DEFAULT false,
  kiosk_open           boolean DEFAULT true,
  offline_registration boolean DEFAULT false,
  show_on_activities   boolean DEFAULT false,
  auto_create          boolean DEFAULT false,     -- 是否開啟自動建立（Batch 2 的 pg_cron 用）
  active               boolean DEFAULT true,
  created_at           timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users can manage recurring_templates"
  ON recurring_templates
  FOR ALL
  USING (auth.role() = 'authenticated');
