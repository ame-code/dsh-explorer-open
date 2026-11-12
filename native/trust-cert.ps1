# Trust the self-signed code-signing certificate that signed DshOpenWith.msix.
# Self-elevates when run without administrator rights, so trust-cert.bat can stay
# a one-liner. Keep this file pure ASCII: PowerShell 5.1 decodes a BOM-less .ps1
# with the ANSI code page, so non-ASCII text would be mangled.
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
	Write-Host 'Requesting administrator rights...'
	# PowerShell quotes array elements containing spaces on its own, so pass the
	# raw path and let it handle quoting instead of building a command string.
	$argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $PSCommandPath)
	try {
		Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList
	}
	catch {
		Write-Host ('ERROR: could not elevate: ' + $_.Exception.Message)
		exit 1
	}
	exit 0
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
