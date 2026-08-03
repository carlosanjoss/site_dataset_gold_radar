@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_cloudflare.ps1"
if errorlevel 1 (
  echo.
  echo Ocorreu um erro. Leia a mensagem acima.
  pause
)
