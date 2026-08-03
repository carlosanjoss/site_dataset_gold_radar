@echo off
title Radar Odio - Revisao Humana
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_sistema.ps1"
if errorlevel 1 (
  echo.
  echo O sistema encontrou um erro. Deixe esta janela aberta e informe a mensagem exibida.
  pause
)
