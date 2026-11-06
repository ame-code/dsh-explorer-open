# Remove the dsh-open-with MSIX identity package (no admin needed).
# NOTE: keep this file pure ASCII.
$ErrorActionPreference = 'Stop'
$p = Get-AppxPackage -Name 'DshOpenWith.Local'
if (-not $p) { Write-Host 'OK: not installed'; exit 0 }
$p | Remove-AppxPackage
$left = Get-AppxPackage -Name 'DshOpenWith.Local'
if ($left) { Write-Host 'FAILED: still installed' -ForegroundColor Red; exit 1 }
Write-Host 'OK: package removed' -ForegroundColor Green
exit 0
