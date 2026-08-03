@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desativar_site.ps1"
if errorlevel 1 (
  echo.
  echo Ocorreu um erro ao desativar o site.
  pause
)
