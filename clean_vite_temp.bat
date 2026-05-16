@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo.
echo === Clean vite temp files ===
echo Folder: %CD%
echo.
dir /B vite.config.js.timestamp-*.mjs 2>nul
echo.
del /Q /F vite.config.js.timestamp-*.mjs 2>nul
if errorlevel 1 (
  echo [ERROR] Delete failed. Close VS Code / dev server first.
) else (
  echo [OK] Cleaned.
)
echo.
pause
