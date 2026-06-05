@echo off
REM Deploy: Modal refactor - extract 4 modals from EventDetailPage

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === HEAD (commit to push) ===
git log -1 --oneline

echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
