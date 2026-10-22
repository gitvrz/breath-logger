@echo off
rem Shows what the sensor test prints. Quit with Ctrl+]
setlocal
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set /p PORT=Port de l'appareil, ex. COM5 - Entree pour choisir dans la liste : 
if "%PORT%"=="" set PORT=-
echo Quitter : Ctrl+]   Commandes : i, t, p, z puis Entree
..\tools\python\python.exe -m serial.tools.miniterm --echo --rts 0 --dtr 0 %PORT% 115200
pause
