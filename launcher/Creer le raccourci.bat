@echo off
rem Cree les raccourcis "Breath Logger" (Bureau + menu Demarrer).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"
echo.
pause
