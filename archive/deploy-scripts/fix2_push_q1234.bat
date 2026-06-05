@echo off
REM Fix duplicated tail in CarCheckinPage.jsx (remote b1f0f90 has 7 extra lines at EOF)
REM Working tree on disk is already the corrected 1338-line version.
REM This bat: clean locks, rebuild index, amend HEAD with disk version, force push.

cd /d "%~dp0"

echo === clean stale locks ===
if exist .git\index.lock del /f /q .git\index.lock
if exist .git\HEAD.lock del /f /q .git\HEAD.lock
if exist .git\index del /f /q .git\index

echo === rebuild index from HEAD ===
git read-tree HEAD

echo === sanity: disk file line count (should be 1338) ===
find /c /v "" src\pages\CarCheckinPage.jsx

echo === git status ===
git status -s

echo === git add the fixed file ===
git add src/pages/CarCheckinPage.jsx

echo === git commit --amend (keep msg) ===
git commit --amend --no-edit

echo === current HEAD ===
git log -1 --oneline

echo.
echo === git push --force-with-lease (b1f0f90 on remote will be replaced) ===
git push --force-with-lease

echo.
echo Done. Vercel will re-deploy in 1-2 minutes.
pause
