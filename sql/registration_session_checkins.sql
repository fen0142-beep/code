-- ============================================================
-- Phase 5 Batch 5：多場次活動逐場報到
-- 建立日期：2026-05-19
--
-- 規格依據：SPEC.md Phase 5 → 「報到頁（多場次版）」段落
--   每位學員每場一筆 check-in 紀錄；同人同場不重複（複合 PK 阻擋）。
--
-- 與單場次 registrations.checked_in_at 並存：
--   - 單場次活動：沿用 registrations.checked_in_at
--   - 多場次活動：寫入本表
--
-- 不會回填舊資料：報到頁上線後新報到才有紀錄
-- ============================================================

CREATE TABLE IF NOT EXISTS registration_session_checkins (
  reg_id        uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES event_sessions(session_id)     ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reg_id, session_id)
);

-- 用 session_id 查報到名單時加速
CREATE INDEX IF NOT EXISTS ix_rsc_session ON registration_session_checkins(session_id);

COMMENT ON TABLE registration_session_checkins IS
  'Phase 5：多場次活動每場一筆報到紀錄（複合 PK = 同人同場不重複）';
COMMENT ON COLUMN registration_session_checkins.checked_in_at IS
  '報到時間，預設 now()；取消報到 = 直接 DELETE';

-- ── RLS：跟 registrations 一致（公開讀寫，後續若有 RLS 強化再一起調）──
-- 目前 registrations 沒開啟 RLS，本表也比照處理。
-- ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;
