@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo 未检测到 Node.js，请先安装 Node.js 18+：https://nodejs.org & pause & exit /b 1)
if not exist node_modules\yaml (
  echo 首次运行，正在安装依赖...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
start "" http://127.0.0.1:5180/
node server.js
pause
