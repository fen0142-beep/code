@echo off
REM Deploy: 新增活動介紹頁 /activities

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock

echo === git status ===
git status -s

echo === git add ===
git add src/lib/supabase.js
git add src/pages/admin/EventDetailPage.jsx
git add src/App.jsx
git add src/pages/ActivitiesPage.jsx
git add src/pages/ActivityDetailPage.jsx

echo === git commit ===
git commit -F ..\COMMIT_MSG_activities_page.txt

echo === HEAD ===
git log -1 --oneline

echo.
echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
