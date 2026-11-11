@echo off
chcp 65001 >nul
setlocal
title Instalar el Motor de pistas - Live Stage Assistant

rem Instalador para usuarios de la pagina web: no necesita el codigo del proyecto.
rem Descarga el motor desde la propia pagina y lo deja en tu carpeta de usuario.

if "%LSA_MOTOR_BASE%"=="" set "LSA_MOTOR_BASE=https://autotune-nu.vercel.app/motor"
set "DIR=%LOCALAPPDATA%\LiveStageAssistant\motor"

echo.
echo   MOTOR DE PISTAS - Live Stage Assistant
echo   ---------------------------------------
echo   Separa canciones en instrumentos dentro de tu PC.
echo.
echo   Se instalara en: %DIR%
echo   Descarga unos 3 GB y ocupa unos 6 GB. Puede tardar 10-20 minutos.
echo   No cierres esta ventana hasta que diga LISTO.
echo.
pause

if not exist "%DIR%" mkdir "%DIR%" || goto :error
cd /d "%DIR%" || goto :error
set "UV_PYTHON_INSTALL_DIR=%DIR%\python"
set "UV_CACHE_DIR=%DIR%\.uv-cache"

echo.
echo   [1/5] Descargando el motor...
for %%F in (server.py analyze.py requirements.txt) do (
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest '%LSA_MOTOR_BASE%/%%F' -OutFile '%%F'" || goto :error
)

if not exist "bin\uv.exe" (
  echo   [2/5] Descargando el instalador de Python...
  if not exist bin mkdir bin
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile 'bin\uv.zip'; Expand-Archive -Force 'bin\uv.zip' 'bin'; Remove-Item 'bin\uv.zip'" || goto :error
)

if not exist ".venv\Scripts\python.exe" (
  echo   [3/5] Preparando Python...
  bin\uv.exe venv --python 3.11 .venv || goto :error
)

echo   [4/5] Instalando el separador de instrumentos ^(lo mas tardado^)...
where nvidia-smi >nul 2>nul
if %errorlevel%==0 (
  echo         Tarjeta NVIDIA detectada: se usara para ir mas rapido.
  bin\uv.exe pip install --python .venv torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121 || goto :error
) else (
  echo         Sin tarjeta NVIDIA: funcionara, pero cada cancion tardara varios minutos.
  bin\uv.exe pip install --python .venv torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu || goto :error
)
bin\uv.exe pip install --python .venv -r requirements.txt || goto :error
rmdir /s /q .uv-cache 2>nul

echo   [5/5] Creando el acceso directo en el escritorio...
> "Motor de pistas.bat" (
  echo @echo off
  echo chcp 65001 ^>nul
  echo title Motor de pistas - Live Stage Assistant
  echo cd /d "%%~dp0"
  echo .venv\Scripts\python.exe server.py
  echo pause
)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Motor de pistas.lnk'); $s.TargetPath=(Join-Path (Get-Location) 'Motor de pistas.bat'); $s.WorkingDirectory=(Get-Location).Path; $s.Description='Motor de pistas de Live Stage Assistant'; $s.Save()"

echo.
echo   LISTO. El motor se abre ahora en otra ventana: dejala abierta
echo   mientras usas "Pistas" en la pagina.
echo   La proxima vez abre "Motor de pistas" desde tu escritorio.
echo.
start "" "%DIR%\Motor de pistas.bat"
pause
exit /b 0

:error
echo.
echo   No se pudo completar la instalacion. Revisa tu conexion a internet
echo   y el espacio libre en disco, y vuelve a abrir este instalador.
echo.
pause
exit /b 1
