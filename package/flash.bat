@echo off
rem Installs the Breath Logger firmware over USB: first install, or recovery when the
rem page cannot update the device. Later updates: from the page (Update firmware).
rem Usage: double-click, or "flash.bat COM5". Close the Breath Logger page first.
setlocal
cd /d "%~dp0"
for %%f in (bootloader partitions boot_app0 firmware) do (
  if not exist firmware\%%f.bin (
    echo Fichier manquant : firmware\%%f.bin
    goto end
  )
)
set PORT=%1
if "%PORT%"=="" set /p PORT=Port de l'appareil, ex. COM5 - Entree pour le chercher : 
set PORTARG=
if not "%PORT%"=="" set PORTARG=--port %PORT%
tools\esptool.exe --chip esp32s3 %PORTARG% --baud 921600 write-flash -z 0x0 firmware\bootloader.bin 0x8000 firmware\partitions.bin 0xe000 firmware\boot_app0.bin 0x10000 firmware\firmware.bin
if errorlevel 1 goto failed
echo.
echo Firmware installe. L'appareil redemarre.
goto end
:failed
echo.
echo ECHEC. A verifier :
echo  - la page Breath Logger est fermee : elle occupe le port USB ;
echo  - le bon port : Gestionnaire de peripheriques, Ports COM ;
echo  - sinon : debrancher, maintenir le bouton BOOT en rebranchant, puis relancer.
:end
echo.
pause
