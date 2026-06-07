@echo off
cd /d "%~dp0"
git add src/components/ImagePositionEditor.jsx src/components/EventInfoTab.jsx src/components/EventRegistrationsTab.jsx src/pages/admin/EventDetailPage.jsx
git commit -F "..\COMMIT_MSG_refactor_eventdetail.txt"
git push
