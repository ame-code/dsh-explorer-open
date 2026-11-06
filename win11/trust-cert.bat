@echo off
rem Double-click: elevate via UAC and trust the dsh-open-with cert (LocalMachine).
rem Result is also appended to trust-cert.log next to this file.
set SCRIPT=%~dp0trust-cert.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File %SCRIPT%'"
echo.
echo Requested elevation. If a UAC prompt appeared, click Yes.
echo A second window should stay open showing OK / FAILED.
pause
