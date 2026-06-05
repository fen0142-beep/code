@echo off
cd /d "%~dp0"
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock
echo === git push ===
git push
echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
