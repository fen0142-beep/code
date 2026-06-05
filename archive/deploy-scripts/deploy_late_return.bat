@echo off
REM Deploy: late_return + per-person overrides + other-transport section
REM Run AFTER applying sql/add_late_return.sql in Supabase SQL editor.

cd /d "%~dp0"

REM Reset git case-ghosts (Windows case-insensitive FS issue)
git read-tree HEAD

echo === git status ===
git status -s

echo === git add ===
git add src/lib/supabase.js
git add src/pages/admin/CarrangementDetailPage.jsx
git add src/pages/CarCheckinPage.jsx
git add sql/add_late_return.sql

echo === git commit (msg from txt) ===
git commit -F ..\COMMIT_MSG_late_return.txt

echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
