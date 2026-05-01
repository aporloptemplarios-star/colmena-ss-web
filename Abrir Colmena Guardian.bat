@echo off
setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG_FILE=%~dp0logs\launcher-start.log"

echo [%date% %time%] Iniciando Colmena Guardian > "%LOG_FILE%"
echo Carpeta: %~dp0 >> "%LOG_FILE%"

if not exist "node_modules\.bin\electron.cmd" (
    echo No se encontro Electron en node_modules. >> "%LOG_FILE%"
    echo No se encontro Electron en node_modules.
    echo Usa una instalacion valida del proyecto antes de abrir el launcher.
    pause
    exit /b 1
)

if not exist ".env" (
    echo Falta .env en la carpeta del launcher. >> "%LOG_FILE%"
    echo Falta .env en la carpeta del launcher.
    pause
    exit /b 1
)

echo Electron encontrado. Abriendo app... >> "%LOG_FILE%"
start "Colmena Guardian" "%~dp0node_modules\.bin\electron.cmd" "%~dp0" >> "%LOG_FILE%" 2>&1
endlocal
