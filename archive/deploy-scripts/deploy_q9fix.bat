@echo off
REM Deploy: Q9 fix - append missing closing tags

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === rebuild index from HEAD ===
if exist .git\index del /f /q .git\index
git read-tree HEAD

echo === amend last commit ===
git add src/pages/CarCheckinPage.jsx
git commit --amend --no-edit

echo === HEAD ===
git log -1 --oneline

echo === git push force ===
git push --force

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
