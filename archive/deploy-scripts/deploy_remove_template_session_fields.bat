@echo off
cd /d %~dp0
git read-tree HEAD
git add src/pages/admin/TemplatesPage.jsx
git add src/pages/admin/EventDetailPage.jsx
git commit -F ..\COMMIT_MSG_remove_template_session_fields.txt
git push
