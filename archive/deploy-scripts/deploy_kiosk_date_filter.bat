@echo off
cd /d %~dp0
git read-tree HEAD
git add src/lib/supabase.js
git commit -F ..\COMMIT_MSG_kiosk_date_filter.txt
git push
