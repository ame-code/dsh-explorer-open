# 使用 MinGW-w64 构建不分配控制台的经典菜单启动器；无需重签 MSIX。
param([string]$Compiler = 'g++.exe')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
& $Compiler '-std=c++17' '-Os' '-s' '-static' '-municode' '-mwindows' '-Wall' '-Wextra' (Join-Path $project 'win11/src/launcher.cpp') '-o' (Join-Path $project 'native/dsh-launch.exe') '-lshell32'
if ($LASTEXITCODE -ne 0) { throw "Launcher build failed: $LASTEXITCODE" }
