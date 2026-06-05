@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git\index.lock del /f /q .git\index.lock
git add src/pages/KioskPage.jsx
git commit -m "feat: kiosk idle screen - card SVG illustration + crimson gold buttons"
git push
echo.
echo Done. Vercel auto-deploy in 1-2 min.
pause
