@echo off
cd /d "%~dp0"
if exist ".git\index.lock" del /f ".git\index.lock"
git read-tree HEAD
git status --short
pause
