# Ask Windows for elevation and run trust-cert.ps1 in the elevated window.
# Called by the agent; the human only has to accept the UAC prompt.
# NOTE: keep this file pure ASCII.
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'trust-cert.ps1'
if (-not (Test-Path $target)) { Write-Host ('ERROR: missing ' + $target); exit 1 }
try {
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $target + '"')
  Write-Host 'UAC prompt requested. Click Yes on the Windows dialog.'
  exit 0
} catch {
  Write-Host ('ELEVATION_FAILED: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
