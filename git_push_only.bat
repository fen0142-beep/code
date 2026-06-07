@echo off
cd /d "D:\Claude\projects\puyi-signup\code"
echo Current directory: %CD%
echo.

echo [1] git add -A
git add -A
echo errorlevel after git add: %errorlevel%
echo.

echo [2] git commit
git commit -F "..\COMMIT_MSG_fix_rls_registrations.txt"
echo errorlevel after git commit: %errorlevel%
echo.

echo [3] git push
git push origin main
echo errorlevel after git push: %errorlevel%
echo.

echo === Done ===
pause
