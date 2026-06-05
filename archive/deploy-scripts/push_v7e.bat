@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git\index.lock del /f /q .git\index.lock
git add src/pages/admin/EventsPage.jsx
git commit -m "feat: event list status tabs + ascending date sort"
git push
echo.
echo Done. Vercel auto-deploy in 1-2 min.
pause
