@echo off
cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === git read-tree (fix ghost files) ===
git read-tree HEAD

echo === git add ===
git add schema.sql
git add src/App.jsx
git add src/lib/supabase.js
git add src/pages/ActivitiesPage.jsx
git add src/pages/KioskPage.jsx
git add src/pages/admin/EventDetailPage.jsx
git add src/pages/admin/EventsPage.jsx
git add sql/add_volunteer_open.sql
git add src/pages/ActivityDetailPage.jsx

echo === git commit ===
git commit -F ..\COMMIT_MSG_v4v5.txt

echo === HEAD ===
git log -1 --oneline

echo.
echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
