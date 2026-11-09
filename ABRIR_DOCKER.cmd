@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_docker.ps1"
set "SCRIPT_EXIT_CODE=%ERRORLEVEL%"
if not "%SCRIPT_EXIT_CODE%"=="0" pause
exit /b %SCRIPT_EXIT_CODE%
