@echo off
cd /d D:\Claude\projects\puyi-signup\code
git add src/components/DynamicForm.jsx src/pages/admin/EventDetailPage.jsx
git commit -m "feat: 新增 boolean 單一勾選欄位類型（報名三皈依/五戒等）"
git push
echo.
echo 完成！請到 Supabase SQL Editor 執行 add_boolean_field_type.sql
pause
