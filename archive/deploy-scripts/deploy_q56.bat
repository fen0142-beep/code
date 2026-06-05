@echo off
REM Deploy: Q5 small-car monks UI + Q6 volunteer car / fully effective late / visual checked fix

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === rebuild index from HEAD ===
if exist .git\index del /f /q .git\index
git read-tree HEAD

echo === git status (should be M on our 2 files) ===
git status -s

echo === git add (only our 2 changed files) ===
git add src/lib/supabase.js
git add src/pages/CarCheckinPage.jsx

echo === git commit ===
git commit -F ..\COMMIT_MSG_q56.txt

echo === HEAD ===
git log -1 --oneline

echo.
echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
