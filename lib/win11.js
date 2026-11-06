import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Windows 11 新式右键菜单只接受「带包身份（packaged identity）」的扩展。
 * 我们用稀疏 MSIX 包把原生 COM 组件（IExplorerCommand 实现）注册进那个菜单。
 * 包名与 native/AppxManifest.xml 里的 Identity/@Name 必须一致。
 */
export const PACKAGE_NAME = 'DshOpenWith.Local'

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const NATIVE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'native')
const MSIX_PATH = join(NATIVE_DIR, 'DshOpenWith.msix')
const VERSION_FILE = join(NATIVE_DIR, 'version.txt')

/** 证书不受信时 Add-AppxPackage 的报错码。 */
const UNTRUSTED_HRESULT = '0x800B0109'

function runPowerShell(script) {
  const result = spawnSync(
    POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, output }
}

/** 打包时写进 native/version.txt 的期望版本。 */
export function expectedVersion() {
  try {
    return readFileSync(VERSION_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

/** 当前用户已安装的包版本；没装返回空串。 */
export function installedVersion() {
  const { output } = runPowerShell(
    `(Get-AppxPackage -Name '${PACKAGE_NAME}' | Select-Object -First 1).Version`,
  )
  return output.trim()
}

/**
 * 安装/升级新式菜单用的 MSIX 包。
 * 返回 { status, detail }，status 取值：missing-msix / current / installed / untrusted / failed。
 */
export function installPackage() {
  if (!existsSync(MSIX_PATH)) return { status: 'missing-msix', detail: MSIX_PATH }

  const wanted = expectedVersion()
  const installed = installedVersion()
  if (installed !== '' && (wanted === '' || installed === wanted)) {
    return { status: 'current', detail: installed }
  }

  const { output } = runPowerShell(`Add-AppxPackage -Path '${MSIX_PATH}'`)
  if (output.includes(UNTRUSTED_HRESULT)) {
    return { status: 'untrusted', detail: join(NATIVE_DIR, 'trust-cert.bat') }
  }

  const now = installedVersion()
  if (now !== '' && (wanted === '' || now === wanted)) return { status: 'installed', detail: now }
  return { status: 'failed', detail: output || `status=${now || 'none'}` }
}

/** 卸载新式菜单用的 MSIX 包；返回是否已确认移除。 */
export function removePackage() {
  if (installedVersion() === '') return true
  runPowerShell(`Get-AppxPackage -Name '${PACKAGE_NAME}' | Remove-AppxPackage`)
  return installedVersion() === ''
}
