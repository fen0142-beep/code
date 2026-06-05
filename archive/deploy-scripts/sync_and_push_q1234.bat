@echo off
REM Sync with remote (rebase local commits on top) then push

cd /d "%~dp0"

echo === git fetch origin ===
git fetch origin

echo === git log origin/main vs HEAD ===
git log --oneline origin/main..HEAD
echo --- remote ahead ---
git log --oneline HEAD..origin/main

echo.
echo === git pull --rebase origin main ===
git pull --rebase origin main

echo === git log -3 ===
git log -3 --oneline

echo.
echo === git push ===
git push

echo.
echo Done. Vercel will auto-deploy in 1-2 minutes.
pause
