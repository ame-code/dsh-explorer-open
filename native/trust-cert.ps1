# Trust the self-signed code-signing certificate that signed DshOpenWith.msix.
# Self-elevates when run without administrator rights, so trust-cert.bat can stay
# a one-liner. Every step is appended to %LOCALAPPDATA%\dsh-explorer-open-trust.log
# so a silent failure (UAC disabled, elevation blocked, wrong machine policy) can
# still be diagnosed afterwards.
# Keep this file pure ASCII: PowerShell 5.1 decodes a BOM-less .ps1 with the ANSI
# code page, so non-ASCII text would be mangled.
$ErrorActionPreference = 'Stop'

$logPath = Join-Path $env:LOCALAPPDATA 'dsh-explorer-open-trust.log'

function Write-Log([string]$Message) {
	$line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $Message
	try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch { }
	Write-Host $line
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Log ('start pid=' + $PID + ' admin=' + $isAdmin + ' user=' + $identity.Name)
Write-Log ('script=' + $PSCommandPath)

if (-not $isAdmin) {
	Write-Log 'not elevated; relaunching elevated'
	# PowerShell quotes array elements containing spaces on its own, so pass the
	# raw path and let it handle quoting instead of building a command string.
	$argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
	try {
		$child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait -PassThru
		Write-Log ('elevated child exit=' + $child.ExitCode)
		exit $child.ExitCode
	}
	catch {
		Write-Log ('ERROR: could not elevate: ' + $_.Exception.Message)
		Write-Host 'Run this script from an elevated PowerShell window instead.'
		exit 1
	}
}

$cer = Join-Path $PSScriptRoot 'dsh-open-with.cer'
if (-not (Test-Path -LiteralPath $cer)) {
	Write-Log ('ERROR: certificate not found: ' + $cer)
	exit 1
}

try {
	$thumb = (Get-PfxCertificate -FilePath $cer).Thumbprint
	Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
}
catch {
	Write-Log ('ERROR: import failed: ' + $_.Exception.Message)
	exit 1
}

$found = Get-ChildItem Cert:\LocalMachine\TrustedPeople |
	Where-Object { $_.Thumbprint -eq $thumb } |
	Select-Object -First 1

if ($null -eq $found) {
	Write-Log ('ERROR: certificate not found in LocalMachine\TrustedPeople after import: ' + $thumb)
	exit 1
}

Write-Log ('OK: certificate trusted (LocalMachine\TrustedPeople): ' + $thumb)
Write-Log 'Windows 11 modern context menu items can now load this package.'
exit 0
