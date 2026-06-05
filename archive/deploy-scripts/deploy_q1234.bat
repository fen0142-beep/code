@echo off
REM Deploy: Q1 driver picker UI, Q2 dashboard monks, Q3 monk cross-uniqueness, Q4 late_return lock toggle

cd /d "%~dp0"

REM Reset git case-ghosts (Windows case-insensitive FS issue)
git read-tree HEAD

echo === git status ===
git status -s

echo === git add ===
git add src/pages/admin/CarrangementDetailPage.jsx
git add src/pages/CarCheckinPage.jsx

echo === git commit (msg from txt) ===
git commit -F ..\COMMIT_MSG_q1234.txt

echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
