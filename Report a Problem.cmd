@echo off
setlocal
cd /d "%~dp0"
node "%~dp0src\cli.mjs" report-problem
echo.
pause
endlocal
