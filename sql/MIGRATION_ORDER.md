# SQL 遷移執行順序

> 若要在新環境重建資料庫，依照以下順序執行。
> 每個檔案都設計為可重複執行（`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`）。

## 第一階段：基礎架構

| 順序 | 檔案 | 說明 |
|------|------|------|
| 1 | `schema.sql` | 主要資料表（students、events、registrations 等） |
| 2 | `admin_setup.sql` | 管理員帳號與 anon 基本 GRANT |
| 3 | `role_setup.sql` | 角色定義（admin / volunteer） |
| 4 | `volunteer_access_setup.sql` | 義工存取權限 |
| 5 | `monk_setup.sql` | 法師資料表 |
| 6 | `relationship_setup.sql` | 學員關係連結 |

## 第二階段：報名功能

| 順序 | 檔案 | 說明 |
|------|------|------|
| 7 | `registration_tracking_setup.sql` | 報名追蹤欄位 |
| 8 | `cancel_registration_setup.sql` | 取消報名功能 |
| 9 | `guest_registration_setup.sql` | 訪客報名 |
| 10 | `batch_e_setup.sql` | 批次 E 設定 |

## 第三階段：車輛系統

| 順序 | 檔案 | 說明 |
|------|------|------|
| 11 | `car_arrangement_setup.sql` | 車輛安排主表 |
| 12 | `small_car_leader_setup.sql` | 小車領隊 |
| 13 | `add_direction_to_car_assignments.sql` | 上下山方向欄位 |
| 14 | `fix_unique_for_direction.sql` | 方向唯一值修正 |
| 15 | `add_car_member_checkin.sql` | 車輛報到功能 |
| 16 | `add_pre_depart.sql` | 提早出發設定 |
| 17 | `add_late_return.sql` | 晚回設定 |

## 第四階段：欄位擴充

| 順序 | 檔案 | 說明 |
|------|------|------|
| 18 | `add_field_types.sql` | 自訂欄位類型 |
| 19 | `add_boolean_field_type.sql` | 布林欄位類型 |
| 20 | `add_date_field_type.sql` | 日期欄位類型 |
| 21 | `add_event_type.sql` | 活動類型欄位 |
| 22 | `add_host_student_id.sql` | 主辦人學員 ID |
| 23 | `add_placeholder_column.sql` | 佔位欄位 |
| 24 | `add_activities_fields.sql` | 活動頁欄位 |
| 25 | `add_related_links.sql` | 相關連結 |
| 26 | `add_cover_image_position.sql` | 封面圖位置 |
| 27 | `add_kiosk_open.sql` | Kiosk 開放設定 |
| 28 | `add_volunteer_open.sql` | 義工報名開放 |
| 29 | `add_walkin_mode.sql` | 現場報名模式 |
| 30 | `add_registration_source.sql` | 報名來源 |

## 第五階段：模板與重複活動

| 順序 | 檔案 | 說明 |
|------|------|------|
| 31 | `add_templates_table.sql` | 活動模板表 |
| 32 | `add_phase2_b.sql` | Phase 2b 欄位補充 |
| 33 | `add_phase3.sql` | Phase 3（功德主表） |
| 34 | `phase5_batch1_sessions.sql` | Phase 5 場次 |
| 35 | `phase5_session_fields.sql` | Phase 5 場次欄位 |
| 36 | `phase5_batch1_fix_policies.sql` | Phase 5 RLS 修正 |
| 37 | `add_is_recurring.sql` | 重複活動標記 |
| 38 | `create_recurring_templates.sql` | 重複活動模板 |
| 39 | `template_session_fields_migration.sql` | 模板場次欄位遷移 |
| 40 | `registration_session_checkins.sql` | 場次報到 |

## 第六階段：資料修正與維護

| 順序 | 檔案 | 說明 |
|------|------|------|
| 41 | `class_normalization.sql` | 班別名稱正規化 |
| 42 | `update_fields_and_transport.sql` | 欄位與交通更新 |
| 43 | `batch_update_transport.sql` | 批次交通資料更新 |
| 44 | `update_default_templates.sql` | 預設模板更新 |
| 45 | `dashboard_role_migration.sql` | Dashboard 角色遷移 |
| 46 | `show_transport_to_public_migration.sql` | 交通資訊公開遷移 |
| 47 | `recurring_batch2.sql` | 重複活動批次 2 |
| 48 | `recurring_batch3.sql` | 重複活動批次 3 |
| 49 | `events_lock.sql` | 活動鎖定機制 |

## 定時任務（Cron）

| 檔案 | 說明 |
|------|------|
| `weekly_gonxiu_cron.sql` | 每週功修自動建立 |
| `clean_guest_phone_cron.sql` | 定期清理訪客電話 |

## ⚠️ 注意事項

- 2026-06-05 安全修正：`registrations` 移除 anon UPDATE/DELETE，`event_donors` 完全封鎖 anon，`students` 改用 RPC 函數。這些修正已直接套用於 Supabase，**不在以上 SQL 檔案中**，換環境時需另外執行 `fix_rls_clean.sql`（位於上層 `puyi-signup/` 目錄）。
