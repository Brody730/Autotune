@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Motor de pistas - Live Stage Assistant
if not exist ".venv\Scripts\python.exe" (
  echo  El motor no esta instalado todavia. Abre primero instalar.bat
  pause
  exit /b 1
)
.venv\Scripts\python.exe server.py
pause
