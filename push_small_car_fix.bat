@echo off
cd /d "%~dp0"
git add src/pages/CarCheckinPage.jsx
git commit -F "..\COMMIT_MSG_small_car_fix.txt"
git push
