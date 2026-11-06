# Explorer context menu entry point.
# Kept pure ASCII on purpose: Windows PowerShell 5.1 decodes BOM-less .ps1
# files with the ANSI code page, so non-ASCII text would be mojibake.
param([Parameter(Position = 0)][string]$Target)

$ErrorActionPreference = 'SilentlyContinue'

# Normalise "%V": the shell may hand over a quoted path or a trailing separator.
$path = $Target
if ($null -ne $path) { $path = $path.Trim().Trim('"') }
if ($null -ne $path) { $path = $path.TrimEnd('\', '/') }

# A folder opens itself; a file opens the folder that contains it and is also
# handed to the page so the new session can start with a reference to it.
$folder = $null
$file = $null

if ($path) {
    if ([System.IO.Directory]::Exists($path)) {
        $folder = $path
    }
    elseif ([System.IO.File]::Exists($path)) {
        $file = $path
        $folder = [System.IO.Path]::GetDirectoryName($path)
    }
}

if (-not $folder) { exit 0 }

$root = Join-Path $env:USERPROFILE '.dsh\dsh-open-with'
if (-not [System.IO.Directory]::Exists($root)) { [void][System.IO.Directory]::CreateDirectory($root) }

$token = [guid]::NewGuid().ToString('N')
$payload = [ordered]@{
    folder = $folder
    token  = $token
    at     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
if ($file) { $payload.file = $file }

# Write to a unique temp file and rename, so the page never reads half a JSON.
$json = $payload | ConvertTo-Json -Compress
$temp = Join-Path $root ("pending.$token.tmp")
$final = Join-Path $root 'pending.json'
[System.IO.File]::WriteAllText($temp, $json, [System.Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temp -Destination $final -Force

# Find the DeepSeek Harness executable: the plugin writes config.json with the
# real path, then an environment variable, then a few well-known install spots.
$exe = $null
$config = Join-Path $root 'config.json'
if ([System.IO.File]::Exists($config)) {
    try { $exe = (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).exe } catch { $exe = $null }
}
if (-not $exe -and $env:DSH_OPEN_WITH_EXE) { $exe = $env:DSH_OPEN_WITH_EXE }

if (-not ($exe -and [System.IO.File]::Exists($exe))) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe'),
        'D:\DeepSeek Harness\DeepSeek Harness.exe'
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and [System.IO.File]::Exists($candidate)) { $exe = $candidate; break }
    }
}

if ($exe -and [System.IO.File]::Exists($exe)) { Start-Process -FilePath $exe }
