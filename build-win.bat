@echo off
chcp 65001 >nul
echo 正在调用 build-win.ps1 构建 Windows 安装包...
powershell -ExecutionPolicy Bypass -File "%~dp0build-win.ps1"
pause
