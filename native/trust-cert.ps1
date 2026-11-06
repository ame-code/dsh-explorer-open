# Trust the self-signed code-signing certificate that signed DshOpenWith.msix.
# Must run elevated. Keep this file pure ASCII: PowerShell 5.1 decodes a BOM-less
# .ps1 with the ANSI code page, so non-ASCII text would be mangled.
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'ERROR: this script must run as Administrator.'
  exit 1
}

$cer = Join-Path $PSScriptRoot 'dsh-open-with.cer'
if (-not (Test-Path -LiteralPath $cer)) {
  Write-Host ('ERROR: certificate not found: ' + $cer)
  exit 1
}

Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

$thumb = (Get-PfxCertificate -FilePath $cer).Thumbprint
Write-Host ('OK: certificate trusted (LocalMachine\TrustedPeople): ' + $thumb)
Write-Host 'Windows 11 modern context menu items can now load this package.'
