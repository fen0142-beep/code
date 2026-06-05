@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo.
echo === Remove git index.lock ===
echo.
if exist ".git\index.lock" (
  del /Q /F ".git\index.lock"
  if exist ".git\index.lock" (
    echo [ERROR] Failed to remove. Close GitHub Desktop and any git GUI then retry.
  ) else (
    echo [OK] index.lock removed. Now reopen GitHub Desktop and Commit again.
  )
) else (
  echo [INFO] No index.lock found. Nothing to do.
)
echo.
pause
