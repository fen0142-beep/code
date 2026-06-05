@echo off
cd /d "D:\Claude\projects\puyi-signup\code"
if errorlevel 1 (
  echo ERROR: folder not found
  pause
  exit /b 1
)
git add schema.sql SETUP.md
git commit -m "add schema.sql and SETUP.md"
git push
echo Done
pause
