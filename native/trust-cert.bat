@echo off
rem Trust the self-signed certificate that signed DshOpenWith.msix.
rem trust-cert.ps1 elevates itself through UAC; no nested quoting needed here.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0trust-cert.ps1"
