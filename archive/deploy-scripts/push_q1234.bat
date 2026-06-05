@echo off
REM Push the already-committed Q1234 changes (commit bb55785) to remote

cd /d "%~dp0"

echo === current HEAD ===
git log -1 --oneline

echo.
echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
