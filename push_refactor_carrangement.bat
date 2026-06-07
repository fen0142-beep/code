@echo off
cd /d "%~dp0"
git add src/lib/carrangeHelpers.js src/lib/autoArrange.js src/components/PersonRow.jsx src/components/StatCard.jsx src/pages/admin/CarrangementDetailPage.jsx
git commit -F "..\COMMIT_MSG_refactor_carrangement.txt"
git push
