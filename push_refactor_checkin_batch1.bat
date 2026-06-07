@echo off
cd /d "%~dp0"
git add src/lib/checkinHelpers.js src/components/ScanToast.jsx src/components/DirectionBadge.jsx src/pages/CarCheckinPage.jsx
git commit -F "..\COMMIT_MSG_refactor_checkin_b1.txt"
git push
