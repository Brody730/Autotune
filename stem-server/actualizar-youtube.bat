@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Actualizar el descargador de YouTube
echo  YouTube cambia seguido; si las descargas fallan, esto actualiza yt-dlp.
set "UV_CACHE_DIR=%~dp0.uv-cache"
bin\uv.exe pip install --python .venv -U "yt-dlp[default]"
rmdir /s /q .uv-cache 2>nul
pause
