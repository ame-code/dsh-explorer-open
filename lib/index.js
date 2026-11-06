import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installLegacy, isLegacyInstalled, refreshExplorer, removeLegacy } from './registry.js'
import { installPackage, removePackage } from './win11.js'

/** 启动器写、本插件读的待办文件。 */
const PENDING_DIR = join(homedir(), '.dsh', 'dsh-explorer-open')
const PENDING_FILE = join(PENDING_DIR, 'pending.json')

/** 页面询问「有没有新的右键请求」的接口。 */
export const REQUEST_PATH = '/api/plugins/dsh-explorer-open/request'

/** 页面轮询时必须带上的请求头，见 client.js。 */
const REQUEST_HEADER = 'x-dsh-explorer-open'

/** 超过这个时间的请求视为过期，不再执行。 */
const REQUEST_TTL_MS = 120_000

/** 同一路径连续请求（右键双击、菜单被重复触发）的合并窗口。 */
const DUPLICATE_WINDOW_MS = 1_500

/** 扫描待办文件的间隔。 */
const SCAN_MS = 300

/** 插件自带的启动器与图标；安装时复制到 PENDING_DIR，菜单指向那两份副本。 */
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER_SOURCE = join(PLUGIN_DIR, 'lib', 'launch.ps1')
const LAUNCHER_PATH = join(PENDING_DIR, 'launch.ps1')
const ICON_SOURCE = join(PLUGIN_DIR, 'assets', 'dsh.ico')
const ICON_PATH = join(PENDING_DIR, 'dsh.ico')
const CONFIG_FILE = join(PENDING_DIR, 'config.json')

/**
 * 把启动器和图标复制到固定位置，并写下 dsh 可执行文件的位置。
 * 菜单里写死的是这个固定位置的路径，这样插件目录被移动/删除后菜单仍然可用，
 * 也让注册表里不会出现一个指向开发目录的路径。
 * config.json 让启动器知道该唤起哪个 exe，不必猜安装目录。
 */
function ensureRuntime() {
  mkdirSync(PENDING_DIR, { recursive: true })
  for (const [source, target] of [
    [LAUNCHER_SOURCE, LAUNCHER_PATH],
    [ICON_SOURCE, ICON_PATH],
  ]) {
    const bytes = readFileSync(source)
    const current = existsSync(target) ? readFileSync(target) : undefined
    if (current === undefined || !current.equals(bytes)) writeFileSync(target, bytes)
  }
  const config = `${JSON.stringify({ exe: process.execPath }, null, 2)}\n`
  if (!existsSync(CONFIG_FILE) || readFileSync(CONFIG_FILE, 'utf8') !== config) {
    writeFileSync(CONFIG_FILE, config)
  }
  return { launcher: LAUNCHER_PATH, icon: ICON_PATH }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function removePending() {
  try {
    rmSync(PENDING_FILE, { force: true })
  } catch {
    // 下次扫描会再试
  }
}

function readPending() {
  if (!existsSync(PENDING_FILE)) return undefined
  try {
    const payload = JSON.parse(readFileSync(PENDING_FILE, 'utf8'))
    if (typeof payload?.folder !== 'string' || typeof payload?.at !== 'number') {
      removePending()
      return undefined
    }
    if (payload.file !== undefined && typeof payload.file !== 'string') {
      removePending()
      return undefined
    }
    return payload
  } catch {
    // 可能正好写了一半，留着下次再读
    return undefined
  }
}

export function apply(ctx) {
  /** 待页面取走的请求；同一时刻只保留最新的一条。 */
  let queue = []

  // 0. Win11 新式精简菜单：装上带包身份的原生扩展（旧式菜单见下一段）
  //    设 DSH_EXPLORER_OPEN_NO_MSIX=1 可跳过（离线自测时用，免得卸载真实安装的包）
  ctx.effect(() => {
    if (process.env.DSH_EXPLORER_OPEN_NO_MSIX === '1') return
    let disposed = false
    void (async () => {
      try {
        const result = installPackage()
        if (result.status === 'untrusted') {
          ctx.logger?.warn?.(
            `[dsh-explorer-open] 新式菜单未启用：签名证书尚未被信任，请以管理员身份运行 ${result.detail}`,
          )
          return
        }
        if (result.status === 'missing-msix' || result.status === 'failed') {
          ctx.logger?.warn?.(`[dsh-explorer-open] 新式菜单未启用: ${result.detail}`)
          return
        }
        ctx.logger?.info?.(`[dsh-explorer-open] 新式菜单已就绪 ${result.status} ${result.detail}`)
        if (result.status === 'installed') await refreshExplorer()
      } catch (error) {
        if (!disposed) ctx.logger?.warn?.(`[dsh-explorer-open] 安装新式菜单失败: ${error}`)
      }
    })()

    return () => {
      disposed = true
      try {
        removePackage()
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-explorer-open] 卸载新式菜单失败: ${error}`)
      }
    }
  })

  // 1. 注入右键菜单；插件停用时移除
  ctx.effect(() => {
    let disposed = false
    void (async () => {
      try {
        const { launcher, icon } = ensureRuntime()
        await installLegacy(launcher, icon)
        const ok = await isLegacyInstalled()
        ctx.logger?.info?.(`[dsh-explorer-open] 右键菜单已写入=${ok} (${launcher})`)
        await refreshExplorer()
      } catch (error) {
        if (!disposed) ctx.logger?.warn?.(`[dsh-explorer-open] 写入右键菜单失败: ${error}`)
      }
    })()

    return () => {
      disposed = true
      void removeLegacy()
        .then(() => refreshExplorer())
        .catch((error) => ctx.logger?.warn?.(`[dsh-explorer-open] 移除右键菜单失败: ${error}`))
    }
  })

  // 2. 扫描启动器留下的待办文件，转成内存里的请求
  ctx.effect(() => {
    let lastKey
    let lastAt = 0

    const tick = () => {
      const payload = readPending()
      if (payload === undefined) return
      removePending()

      if (Date.now() - payload.at > REQUEST_TTL_MS) return
      if (!isDirectory(payload.folder)) return
      // 文件右键：文件必须还在，否则只打开它所在的文件夹
      const file = payload.file !== undefined && isFile(payload.file) ? payload.file : undefined
      const key = `${payload.folder}\u0000${file ?? ''}`
      // 1.5 秒内对同一目标的重复请求只算一次
      if (key === lastKey && Date.now() - lastAt < DUPLICATE_WINDOW_MS) return

      lastKey = key
      lastAt = Date.now()
      // 只保留最新一条；页面每秒来取一次
      const request = { folder: payload.folder, token: payload.token ?? '', at: payload.at }
      if (file !== undefined) request.file = file
      queue = [request]
      ctx.logger?.info?.(`[dsh-explorer-open] 收到请求: ${file ?? payload.folder}`)
    }

    const timer = setInterval(tick, SCAN_MS)
    return () => clearInterval(timer)
  })

  // 3. 页面轮询这个接口领取请求
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'exact',
        path: REQUEST_PATH,
        resource: async (request) => {
          // 只认页面自己发的请求：跨站页面带不上这个头（会先触发预检）
          if (request?.headers?.get?.(REQUEST_HEADER) !== '1') {
            return new Response(JSON.stringify({ error: 'forbidden' }), {
              status: 403,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          }
          const now = Date.now()
          const taken = queue.filter((item) => now - item.at <= REQUEST_TTL_MS)
          queue = []
          const reply = { status: taken.length === 0 ? 'idle' : 'open', requests: taken }
          return new Response(JSON.stringify(reply), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
        },
      }),
    )
  })
}
