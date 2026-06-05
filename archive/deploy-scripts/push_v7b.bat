@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git\index.lock del /f /q .git\index.lock
echo === git add ===
git add src/pages/admin/EventsPage.jsx
echo === git commit ===
git commit -m "fix: export modal show draft+active events, not active-only"
echo === git push ===
git push
echo.
echo Done. Vercel auto-deploy in 1-2 min.
pause
