@echo off
cd /d %~dp0
set LOG=%~dp0deploy_rls_log.txt
echo === push_fix_rls_registrations %date% %time% === > "%LOG%"

echo.
echo [1/4] npm run build ...
npm run build >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] Build failed. Check deploy_rls_log.txt
  type "%LOG%"
  pause
  exit /b 1
)
echo [OK] Build success.

echo.
echo [2/4] git add ...
git add -A >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] git add failed.
  type "%LOG%"
  pause
  exit /b 1
)
echo [OK] git add success.

echo.
echo [3/4] git commit ...
git commit -F ..\COMMIT_MSG_fix_rls_registrations.txt >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [WARN] git commit returned non-zero (maybe nothing to commit - check log).
  type "%LOG%"
  pause
  exit /b 1
)
echo [OK] git commit success.

echo.
echo [4/4] git push ...
git push origin main >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] git push failed. Check deploy_rls_log.txt
  type "%LOG%"
  pause
  exit /b 1
)

echo.
echo === SUCCESS ===
echo Next step: run fix_rls_registrations_anon.sql in Supabase Dashboard
echo Log: %LOG%
pause
