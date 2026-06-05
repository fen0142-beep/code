@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git\index.lock del /f /q .git\index.lock
git add src/pages/KioskPage.jsx
git add src/components/AdminLayout.jsx
git add src/pages/admin/LoginPage.jsx
git add src/pages/ActivitiesPage.jsx
git add src/components/BatchPrintModal.jsx
git add src/components/GuestRegistrationModal.jsx
git add src/components/QrCodeModal.jsx
git add src/pages/admin/EventsPage.jsx
git add .env.example
git commit -m "feat: replace hardcoded temple name with VITE_TEMPLE_NAME env var"
git push
echo.
echo Done. Vercel auto-deploy in 1-2 min.
pause
