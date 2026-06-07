@echo off
cd /d %~dp0
git add sql/fix_car_token_security.sql
git add sql/MIGRATION_ORDER.md
git add src/lib/supabase.js
git add src/pages/CarCheckinPage.jsx
git commit -F ..\COMMIT_MSG_car_token.txt
git push
