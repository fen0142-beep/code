@echo off
cd /d "%~dp0"
echo === Step 1: clear git locks ===
if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\HEAD.lock" del /f /q ".git\HEAD.lock"
if exist ".git\MERGE_HEAD.lock" del /f /q ".git\MERGE_HEAD.lock"
echo.
echo === Step 2: clear case-insensitivity ghosts ===
git read-tree HEAD
echo.
echo === Step 3: status before commit ===
git status --short
echo.
echo === Step 4: stage and commit ===
git add -A
git commit -F ..\COMMIT_MSG_walkin_register.txt
echo.
echo === Step 5: push to origin/main ===
git push origin main
echo.
echo Done. Vercel auto-deploy should pick up shortly.
echo Remember: run sql/add_registration_source.sql in Supabase Studio first if not yet done.
pause
