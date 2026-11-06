# Install the signed dsh-open-with MSIX for the current user (no admin needed once the
# signing cert is trusted in LocalMachine\TrustedPeople).
# NOTE: keep this file pure ASCII.
param(
  [string]$Msix = (Join-Path $PSScriptRoot 'build\DshOpenWith.msix')
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Msix)) { Write-Host ("ERROR: msix not found: " + $Msix) -ForegroundColor Red; exit 1 }

$existing = Get-AppxPackage -Name 'DshOpenWith.Local'
if ($existing) {
  if ($existing.SignatureKind -eq 'None') {
    Write-Host 'Removing previous unsigned (development) registration...'
    $existing | Remove-AppxPackage
  } else {
    Write-Host 'Package already installed; reinstalling to pick up new content...'
    $existing | Remove-AppxPackage
  }
}

try {
  Add-AppxPackage -Path $Msix
} catch {
  Write-Host ('INSTALL_FAILED: ' + $_.Exception.Message + ' (' + $_.Exception.HResult + ')') -ForegroundColor Red
  Write-Host 'If the error is 0x800B0109, the signing cert is not trusted machine-wide yet: run trust-cert.bat as admin.'
  exit 1
}

$p = Get-AppxPackage -Name 'DshOpenWith.Local'
if ($p) {
  Write-Host ('OK: ' + $p.PackageFullName + '  signature=' + $p.SignatureKind + '  location=' + $p.InstallLocation) -ForegroundColor Green
  exit 0
}
Write-Host 'FAILED: package not found after install' -ForegroundColor Red
exit 1
