@echo off
REM Deploy: Q8 mobile nav fix + hide report info on down direction

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === rebuild index from HEAD ===
if exist .git\index del /f /q .git\index
git read-tree HEAD

echo === git status ===
git status -s

echo === git add ===
git add src/components/AdminLayout.jsx
git add src/pages/CarCheckinPage.jsx

echo === git commit ===
git commit -F ..\COMMIT_MSG_q8.txt

echo === HEAD ===
git log -1 --oneline

echo.
echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
