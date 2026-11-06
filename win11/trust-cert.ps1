# Trust the self-signed dsh-open-with cert in LocalMachine\TrustedPeople (needs admin).
# NOTE: keep this file pure ASCII - Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI.
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'trust-cert.log'
function Write-Log([string]$text) {
  try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $text) -Encoding UTF8 } catch {}
  Write-Host $text
}

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Log 'ERROR: administrator rights required. Run trust-cert.bat instead.'
  exit 1
}

$cer = Join-Path $PSScriptRoot 'build\dsh-open-with.cer'
if (-not (Test-Path $cer)) {
  Write-Log ('ERROR: cert not found: ' + $cer)
  exit 1
}

Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

$thumb = (Get-PfxCertificate -FilePath $cer).Thumbprint
$ok = Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' | Where-Object { $_.Thumbprint -eq $thumb }
if ($ok) {
  Write-Log ('OK: cert trusted in LocalMachine\TrustedPeople (' + $thumb + ')')
  exit 0
}
Write-Log 'FAILED: cert not present in LocalMachine\TrustedPeople'
exit 1
