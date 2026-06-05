@echo off
cd /d "%~dp0"
echo 清除 git 鎖定檔案...
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
del /f /q .git\MERGE_HEAD.lock 2>nul
del /f /q .git\objects\*.lock 2>nul
echo.
echo 執行 commit...
git add -A
git commit -m "feat: 條件顯示改為下拉選單，顯示名稱自動填入程式識別碼"
echo.
echo 推送到 GitHub...
git push origin main
echo.
echo 完成！
pause
