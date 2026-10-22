@echo off
rem Installs the sensor test (not the Breath Logger firmware) over USB.
rem Goes in BreathLogger\sensortest\. To get the Breath Logger back: ..\flash.bat
setlocal
cd /d "%~dp0"
for %%f in (..\firmware\bootloader.bin ..\firmware\partitions.bin ..\firmware\boot_app0.bin sensortest.bin) do (
  if not exist %%f (
    echo Fichier manquant : %%f
    goto end
  )
)
set PORT=%1
if "%PORT%"=="" set /p PORT=Port de l'appareil, ex. COM5 - Entree pour le chercher : 
set PORTARG=
if not "%PORT%"=="" set PORTARG=--port %PORT%
..\tools\esptool.exe --chip esp32s3 %PORTARG% --baud 921600 write-flash -z 0x0 ..\firmware\bootloader.bin 0x8000 ..\firmware\partitions.bin 0xe000 ..\firmware\boot_app0.bin 0x10000 sensortest.bin
if errorlevel 1 goto failed
echo.
echo Test capteurs installe. Lancer moniteur.bat pour voir les valeurs.
echo Pour revenir au Breath Logger : ..\flash.bat
goto end
:failed
echo.
echo ECHEC. A verifier :
echo  - la page Breath Logger et moniteur.bat sont fermes : ils occupent le port USB ;
echo  - le bon port : Gestionnaire de peripheriques, Ports COM ;
echo  - sinon : debrancher, maintenir le bouton BOOT en rebranchant, puis relancer.
:end
echo.
pause
