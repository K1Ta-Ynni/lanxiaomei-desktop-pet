@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto :missingnode
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing project dependencies...
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 goto :failed
)
set "ELECTRON_RUN_AS_NODE="
start "" "node_modules\electron\dist\electron.exe" "."
exit /b 0
:missingnode
echo Please install Node.js 22 or newer: https://nodejs.org/
pause
exit /b 1
:failed
echo Install failed. See README.md for mirror instructions.
pause
exit /b 1
