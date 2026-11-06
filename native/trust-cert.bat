@echo off
rem Ask UAC to run trust-cert.ps1 elevated.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0trust-cert.ps1\"'"
