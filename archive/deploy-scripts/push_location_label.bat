@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git\index.lock del /f /q .git\index.lock
git add src/pages/admin/EventDetailPage.jsx
git add src/pages/ActivityDetailPage.jsx
git add src/pages/ActivitiesPage.jsx
git commit -m "feat: location label puyi uses VITE_TEMPLE_NAME env var"
git push
echo.
echo Done. Vercel auto-deploy in 1-2 min.
pause
