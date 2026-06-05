@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git\index.lock (
  del /f /q .git\index.lock
)
if exist .git\HEAD.lock (
  del /f /q .git\HEAD.lock
)
echo === git add ===
git add src/pages/admin/EventsPage.jsx
git add src/App.jsx
git add src/pages/KioskPage.jsx
echo === git status ===
git status --short
echo === git commit ===
git commit -m "feat: V7 export/import activity templates"
echo === git push ===
git push
echo.
echo Done. Vercel auto-deploy in 1-2 min.
pause
