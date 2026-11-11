@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Instalar el motor de pistas
echo.
echo  Instalando el motor de pistas (solo dentro de esta carpeta).
echo  Descarga unos 3 GB: puede tardar varios minutos.
echo.

set "UV_PYTHON_INSTALL_DIR=%~dp0python"
set "UV_CACHE_DIR=%~dp0.uv-cache"

if not exist "bin\uv.exe" (
  echo  [1/4] Descargando el instalador de Python ^(uv^)...
  mkdir bin 2>nul
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile 'bin\uv.zip'; Expand-Archive -Force 'bin\uv.zip' 'bin'; Remove-Item 'bin\uv.zip'" || goto :error
)

if not exist ".venv\Scripts\python.exe" (
  echo  [2/4] Creando el entorno de Python 3.11...
  bin\uv.exe venv --python 3.11 .venv || goto :error
)

echo  [3/4] Instalando PyTorch...
where nvidia-smi >nul 2>nul
if %errorlevel%==0 (
  echo        Tarjeta NVIDIA detectada: version con GPU.
  bin\uv.exe pip install --python .venv torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121 || goto :error
) else (
  echo        Sin tarjeta NVIDIA: version para procesador ^(mas lenta^).
  bin\uv.exe pip install --python .venv torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu || goto :error
)

echo  [4/4] Instalando Demucs, yt-dlp y el resto...
bin\uv.exe pip install --python .venv -r requirements.txt || goto :error

rmdir /s /q .uv-cache 2>nul
echo.
echo  Listo. Ahora abre iniciar.bat
echo.
pause
exit /b 0

:error
echo.
echo  Algo fallo en la instalacion. Revisa tu conexion a internet y vuelve a intentarlo.
pause
exit /b 1
