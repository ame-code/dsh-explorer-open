import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 右键菜单显示文本，用户要求严格保持这个措辞。 */
export const MENU_TEXT = '通过 dsh 打开'

/**
 * 旧式（扩展）右键菜单的挂载点：
 * Directory\Background —— 在文件夹空白处右键（%V 是当前文件夹）；
 * Directory            —— 在文件夹图标上右键（%V 是被点中的文件夹）；
 * *                    —— 在任意文件上右键（%V 是该文件的完整路径，由启动器取所在目录）。
 * Win11 新式菜单由 MSIX 中的 IExplorerCommand 单独提供。
 */
/** 自测时可用环境变量指到一次性的假位置，避免动到真实菜单；默认就是真实的用户级 Classes。 */
const REG_BASE = process.env.DSH_EXPLORER_OPEN_REG_BASE || 'HKCU\\Software\\Classes'

const LEGACY_SHELL_KEYS = [
  `${REG_BASE}\\Directory\\Background\\shell\\OpenWithDsh`,
  `${REG_BASE}\\Directory\\shell\\OpenWithDsh`,
  `${REG_BASE}\\*\\shell\\OpenWithDsh`,
]

/** 旧式菜单里显示的图标。默认用插件自带的那份（安装时复制到固定位置）。 */
const FALLBACK_ICON_PATH = ''

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

async function reg(args) {
  const { stdout } = await run('reg.exe', args, { windowsHide: true })
  return stdout
}

async function keyExists(key) {
  try {
    await reg(['query', key])
    return true
  } catch {
    return false
  }
}

/** GUI 启动器在创建 PowerShell 时使用 CREATE_NO_WINDOW，避免控制台先出现再隐藏。 */
export function menuCommand(launcherPath) {
  // 追加 \\. 避免盘符根目录的结尾反斜杠转义闭引号；GUI 启动器会移除该后缀。
  return `"${launcherPath}" "%V\\."`
}

/**
 * 写入旧式右键菜单项。
 * %V 在 Background 键下是当前文件夹路径，在 Directory 键下是被点中的文件夹路径，
 * 在 * 键下是被点中的文件路径（启动器会取它所在的文件夹并一并记下这个文件）。
 * iconPath 为空时只写文字，不写图标。
 */
export async function installLegacy(launcherPath, iconPath = FALLBACK_ICON_PATH) {
  const command = menuCommand(launcherPath)
  for (const key of LEGACY_SHELL_KEYS) {
    await reg(['add', key, '/ve', '/d', MENU_TEXT, '/f'])
    if (iconPath) await reg(['add', key, '/v', 'Icon', '/d', iconPath, '/f'])
    await reg(['add', `${key}\\command`, '/ve', '/d', command, '/f'])
  }
}

/** 精确删除本插件写入的注册表键，不影响其他软件。 */
export async function removeLegacy() {
  for (const key of LEGACY_SHELL_KEYS) {
    try {
      await reg(['delete', key, '/f'])
    } catch {
      // 键本来就不存在，视为已清理干净
    }
  }
}

/** 用于确认启用/关闭是否真的生效。 */
export async function isLegacyInstalled() {
  const results = await Promise.all(LEGACY_SHELL_KEYS.map(keyExists))
  return results.every(Boolean)
}

/** 更新资源管理器，让右键菜单的改动立刻可见（失败不影响功能，只是可能要等一会）。 */
export async function refreshExplorer() {
  const script = [
    'Add-Type -Namespace GoW -Name Native -MemberDefinition \'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr i1, IntPtr i2);\';',
    '[GoW.Native]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)',
  ].join(' ')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-explorer-open-'))
  const file = join(dir, 'refresh.ps1')
  try {
    await writeFile(file, script, 'utf8')
    await run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file], {
      windowsHide: true,
      timeout: 10_000,
    })
  } catch {
    // 忽略：菜单项本身已经写好，资源管理器迟早会刷新
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Windows 11 的新式简洁右键菜单没有公开的注册接口，系统固定从扩展菜单读取。
 * 该键存在 = 用户手动关掉了新菜单、退回旧菜单。
 */
export async function isWin11NewMenu() {
  try {
    await reg(['query', 'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32'])
    return false
  } catch {
    return true
  }
}
