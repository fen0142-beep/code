@echo off
cd /d "%~dp0"
git add .env.example src/lib/supabase.js
git commit -F ..\COMMIT_MSG_minor_fixes.txt
git push
