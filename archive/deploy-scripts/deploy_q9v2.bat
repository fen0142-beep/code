@echo off
REM Deploy: Q9v2 other-transport direction-aware checkin

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === rebuild index from HEAD ===
if exist .git\index del /f /q .git\index
git read-tree HEAD

echo === git add ===
git add src/lib/supabase.js
git add src/pages/CarCheckinPage.jsx
git add ../sql/add_car_member_checkin.sql

echo === amend last commit ===
git commit --amend -F ..\COMMIT_MSG_q9v2.txt

echo === HEAD ===
git log -1 --oneline

echo === git push force ===
git push --force

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
