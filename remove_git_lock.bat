@echo off
REM 清除卡住的 git index.lock
cd /d "%~dp0"
if exist ".git\index.lock" (
    del ".git\index.lock"
    echo Lock removed.
) else (
    echo No lock found.
)
pause
