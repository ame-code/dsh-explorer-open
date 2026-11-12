# dsh-explorer-open read-only diagnostic.
# Prints everything needed to tell why "Open with dsh" is missing from the
# Explorer context menu. Changes nothing: only reads registry, files and packages.
#
# Usage (PowerShell 7 or Windows PowerShell 5.1):
#   pwsh -NoProfile -ExecutionPolicy Bypass -File diagnose-windows.ps1
# or from the internet:
#   irm https://raw.githubusercontent.com/ame-code/dsh-explorer-open/main/scripts/diagnose-windows.ps1 | iex

$ErrorActionPreference = 'Continue'

function Write-Head([string] $title) {
	Write-Host ''
	Write-Host "== $title" -ForegroundColor Cyan
}

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$runtimeDir = Join-Path $dshHome 'dsh-explorer-open'

Write-Head 'system'
"os      : " + (Get-CimInstance Win32_OperatingSystem).Caption + ' (build ' + [Environment]::OSVersion.Version.Build + ')'
"pwsh    : " + $PSVersionTable.PSVersion
"user    : $env:USERNAME"
"elevated: " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ([Environment]::OSVersion.Version.Build -lt 22000) {
	Write-Host 'note    : this is not Windows 11 22000+, so only the classic menu applies.'
}

Write-Head 'dsh processes and install'
foreach ($p in (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*DeepSeek*' -or $_.ProcessName -like '*dsh*' })) {
	"process : {0} (pid {1}) -> {2}" -f $p.ProcessName, $p.Id, $p.Path
}
$candidates = @(
	(Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
	(Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe'),
	'D:\DeepSeek Harness\DeepSeek Harness.exe'
)
foreach ($c in $candidates) {
	if (Test-Path -LiteralPath $c) { "app     : $c (product " + (Get-Item -LiteralPath $c).VersionInfo.ProductVersion + ')' }
}
"DSH_HOME: $dshHome"

Write-Head 'profiles: bundles and installed plugin'
$profilesDir = Join-Path $dshHome 'profiles'
if (Test-Path -LiteralPath $profilesDir) {
	foreach ($dir in (Get-ChildItem -LiteralPath $profilesDir -Directory -ErrorAction SilentlyContinue)) {
		$manifest = Join-Path $dir.FullName 'package.json'
		if (-not (Test-Path -LiteralPath $manifest)) { "profile : $($dir.Name) (no package.json)"; continue }
		# -Encoding UTF8 必须显式指定：Windows PowerShell 5.1 默认按 ANSI(GBK) 读无 BOM 的 UTF-8，
		# 中文描述会变成乱码并让 ConvertFrom-Json 解析失败。
		$json = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 -ErrorAction SilentlyContinue | ConvertFrom-Json
		$dep = $json.dependencies.'dsh-explorer-open'
		$listed = @($json.dsh.profile.bundles) -contains 'dsh-explorer-open'
		"profile : $($dir.Name)"
		"  dependency : " + $(if ($dep) { $dep } else { '<absent>' })
		"  in bundles : $listed"
		$link = Join-Path $dir.FullName 'node_modules\dsh-explorer-open'
		if (Test-Path -LiteralPath $link) {
			$target = (Get-Item -LiteralPath $link -Force).Target
			"  node_modules: present" + $(if ($target) { " -> $target" } else { '' })
			$pluginManifest = Join-Path $link 'package.json'
			if (Test-Path -LiteralPath $pluginManifest) {
				$pm = Get-Content -LiteralPath $pluginManifest -Raw -Encoding UTF8 | ConvertFrom-Json
				"  version    : $($pm.version)  engines.dsh: $($pm.engines.dsh)"
			}
			"  native dir : " + $(if (Test-Path -LiteralPath (Join-Path $link 'native\DshOpenWith.msix')) { 'msix present' } else { 'MSIX MISSING' })
		}
		else {
			'  node_modules: MISSING'
		}
	}
}
else {
	"$profilesDir not found - dsh may never have started for this user."
}

Write-Head 'classic menu registry keys (HKCU)'
$keys = @(
	'HKCU\Software\Classes\Directory\Background\shell\OpenWithDsh',
	'HKCU\Software\Classes\Directory\shell\OpenWithDsh',
	'HKCU\Software\Classes\*\shell\OpenWithDsh'
)
foreach ($k in $keys) {
	$out = reg.exe query $k /s 2>&1
	if ($LASTEXITCODE -eq 0) {
		"key     : $k  [PRESENT]"
		$out | Where-Object { $_ -match '通过|OpenWithDsh|Icon|command|powershell|REG_' } | ForEach-Object { '  ' + $_.Trim() }
	}
	else {
		"key     : $k  [MISSING]"
	}
}

Write-Head 'desktop background key (informational, not installed by this plugin)'
$desktopKey = 'HKCU\Software\Classes\DesktopBackground\Shell\OpenWithDsh'
$null = reg.exe query $desktopKey 2>&1
'key     : ' + $desktopKey + $(if ($LASTEXITCODE -eq 0) { '  [PRESENT]' } else { '  [MISSING - right-clicking the desktop itself never shows the entry]' })

Write-Head 'runtime directory (launcher written by the plugin)'
if (Test-Path -LiteralPath $runtimeDir) {
	Get-ChildItem -LiteralPath $runtimeDir -File -ErrorAction SilentlyContinue | ForEach-Object {
		'file    : {0} ({1} bytes)' -f $_.Name, $_.Length
	}
	$cfg = Join-Path $runtimeDir 'config.json'
	if (Test-Path -LiteralPath $cfg) { 'config  : ' + (Get-Content -LiteralPath $cfg -Raw).Trim() }
	$trace = Join-Path $runtimeDir 'trace.log'
	if (Test-Path -LiteralPath $trace) {
		'trace   : last 5 lines'
		Get-Content -LiteralPath $trace -Tail 5 | ForEach-Object { '  ' + $_ }
	}
}
else {
	"$runtimeDir MISSING -> the host half of the plugin never ran its install effect."
}

Write-Head 'Windows 11 modern menu (MSIX package + certificate)'
$pkg = Get-AppxPackage -Name 'DshOpenWith.Local' -ErrorAction SilentlyContinue
if ($pkg) {
	"package : $($pkg.PackageFullName)"
	"  status    : $($pkg.Status)  signature: $($pkg.SignatureKind)"
	"  location  : $($pkg.InstallLocation)"
}
else {
	'package : NOT INSTALLED (modern menu entry cannot appear)'
}
$certs = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue | Where-Object { $_.Subject -like '*DshOpenWith*' }
if ($certs) { $certs | ForEach-Object { "trusted : $($_.Subject) [$($_.Thumbprint)]" } }
else { 'trusted : certificate NOT in LocalMachine\TrustedPeople (Add-AppxPackage will fail with 0x800B0109)' }

Write-Head 'dsh logs mentioning the plugin'
$logsDir = Join-Path $dshHome 'logs'
if (Test-Path -LiteralPath $logsDir) {
	$recent = Get-ChildItem -LiteralPath $logsDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
	foreach ($f in $recent) {
		$hits = Select-String -LiteralPath $f.FullName -Pattern 'dsh-explorer-open|incompatible|failed to import|Cannot find package' -ErrorAction SilentlyContinue | Select-Object -First 8
		if ($hits) {
			"log     : $($f.Name)"
			$hits | ForEach-Object { '  ' + $_.Line.Trim() }
		}
	}
	'logs    : ' + ($recent.Name -join ', ')
}
else {
	"$logsDir not found; falling back to *.log under DSH_HOME"
	$recent = Get-ChildItem -LiteralPath $dshHome -Filter '*.log' -Recurse -Depth 2 -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
	foreach ($f in $recent) {
		$hits = Select-String -LiteralPath $f.FullName -Pattern 'dsh-explorer-open|incompatible|failed to import|Cannot find package' -ErrorAction SilentlyContinue | Select-Object -First 8
		if ($hits) {
			"log     : $($f.FullName)"
			$hits | ForEach-Object { '  ' + $_.Line.Trim() }
		}
	}
	if (-not $recent) { 'no *.log files found' }
}

Write-Head 'what each result means'
@'
- all three registry keys MISSING + runtime directory MISSING
    -> the plugin is not installed/enabled in the running profile, or it failed to import.
       Check Settings > Plugins; the dsh startup log above names the import error.
- keys MISSING but runtime directory PRESENT
    -> the install effect ran but reg.exe failed; rerun dsh as the normal user (not elevated).
- keys PRESENT but no menu
    -> On Windows 11 the classic keys are only rendered inside the legacy menu:
       right-click, then "Show more options" (Shift+F10). They never appear in the
       new compact menu - that one needs the packaged COM/MSIX half.
       If the legacy menu shows nothing either, restart Windows Explorer from Task
       Manager (never taskkill it), or sign out and back in.
       A window running as Administrator never shows HKCU menu entries.
- package NOT INSTALLED / certificate untrusted
    -> only the Win11 modern menu is affected; run native\trust-cert.bat as Administrator,
       then disable/enable the plugin (or restart dsh) to retry the MSIX install.
'@
