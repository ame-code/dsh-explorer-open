// 直接运行打包的原生程序，验证 GUI 子系统、子进程无控制台及参数传递。
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { menuCommand } from '../lib/registry.js'

if (process.platform !== 'win32') throw new Error('此集成测试需要 Windows')
const binary = resolve('native/dsh-launch.exe')
const pe = readFileSync(binary)
const header = pe.readUInt32LE(0x3c)
assert.equal(pe.readUInt16LE(header + 24 + 68), 2, '必须使用 Windows GUI 子系统')
const dir = mkdtempSync(join(tmpdir(), 'dsh launcher 中文 空格 '))
const exe = join(dir, 'dsh-launch.exe')
const resultPath = join(dir, 'result.json')
try {
  copyFileSync(binary, exe)
  // BOM 使 Windows PowerShell 5.1 能正确读取含中文目录的测试脚本。
  writeFileSync(join(dir, 'launch.ps1'), '\ufeff' + `param([string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'public static class Probe { [System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); }'
$data = @{ target = $Target; console = [Probe]::GetConsoleWindow().ToInt64() } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'result.json'), $data, [Text.UTF8Encoding]::new($false))
`)
  for (const target of ['C:\\', 'C:\\中文 目录\\file & $name(1).md', '\\\\server\\share\\', 'C:\\directory\\']) {
    rmSync(resultPath, { force: true })
    const command = menuCommand(exe).replace('%V', target)
    const args = command.slice(`"${exe}" `.length)
    const child = spawnSync(exe, [args], { argv0: `"${exe}"`, windowsVerbatimArguments: true, timeout: 10000 })
    assert.ifError(child.error)
    assert.equal(child.status, 0)
    const deadline = Date.now() + 15000
    while (!existsSync(resultPath) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
    assert.ok(existsSync(resultPath), 'PowerShell 必须执行到参数记录步骤')
    const result = JSON.parse(readFileSync(resultPath, 'utf8'))
    assert.equal(result.target, target)
    assert.equal(result.console, 0, 'PowerShell 不应分配控制台窗口')
    console.log(`PASS 无控制台且参数完整：${target}`)
  }
  console.log('PASS 原生启动器为 GUI 子系统')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
