// 本机自测：不启动 dsh，直接跑宿主侧插件的三段 effect
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const DIR = join(homedir(), '.dsh', 'dsh-open-with')
const PENDING = join(DIR, 'pending.json')
const LAUNCHER = join(DIR, 'launch.ps1')

// 必须隔离，否则会把正在运行的 dsh 的 pending.json 抢走、并删掉真实的右键菜单键。
// 跑法：
//   USERPROFILE='E:\tmp\dsh-open-with-home' DSH_OPEN_WITH_TEST_HOME=1 \
//   DSH_OPEN_WITH_REG_BASE='HKCU\Software\Classes\__dsh_open_with_test' \
//     node test/host-test.mjs
if (!process.env.DSH_OPEN_WITH_REG_BASE) {
  console.error('拒绝运行：请设置 DSH_OPEN_WITH_REG_BASE，避免改到真实右键菜单。')
  process.exit(2)
}
if (process.env.DSH_OPEN_WITH_TEST_HOME !== '1') {
  console.error('拒绝运行：请把 USERPROFILE 指向隔离目录，并设 DSH_OPEN_WITH_TEST_HOME=1。')
  process.exit(2)
}

// ---- 假的 ctx ----
const disposers = []
const effects = []
const ctx = {
  logger: { info: (m) => console.log('  [info]', m), warn: (m) => console.log('  [warn]', m) },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  inject(names, fn) {
    effects.push(() => fn(webCtx))
  },
}

let registered
const webCtx = {
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  webServer: {
    register(route) {
      registered = route
      return () => { registered = undefined }
    },
  },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (cond, label) => console.log(cond ? `PASS ${label}` : `FAIL ${label}`)

rmSync(DIR, { recursive: true, force: true })
apply(ctx)
for (const run of effects) run()

await sleep(2500) // 等 install effect 写完注册表 / 复制启动器

ok(existsSync(LAUNCHER), '启动器已复制到固定位置')
ok(existsSync(join(DIR, 'dsh.ico')), '菜单图标已复制到固定位置')
const config = existsSync(join(DIR, 'config.json')) ? JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8')) : {}
ok(typeof config.exe === 'string' && config.exe.length > 0, `config.json 记下了 dsh 路径 (${config.exe})`)
ok(registered !== undefined && registered.path === '/api/plugins/dsh-open-with/request', '已注册请求接口')
console.log('  路由:', registered && JSON.stringify({ kind: registered.kind, path: registered.path }))

// 无请求头 → 403
const denied = await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request'))
ok(denied.status === 403, `无请求头被拒绝 (${denied.status})`)

// 正常轮询 → idle
const idle = await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))
const idleBody = await idle.json()
ok(idle.status === 200 && idleBody.status === 'idle' && idleBody.requests.length === 0, `空闲时返回 idle (${JSON.stringify(idleBody)})`)

// 写一个待办文件，等待扫描线程捡起来
mkdirSync(DIR, { recursive: true })
const folder = process.cwd()
writeFileSync(PENDING, JSON.stringify({ folder, token: 'test-token', at: Date.now() }))
await sleep(1200)
ok(!existsSync(PENDING), '待办文件已被取走并删除')

const open = await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))
const openBody = await open.json()
ok(openBody.status === 'open' && openBody.requests[0]?.folder === folder, `取到请求 (${JSON.stringify(openBody)})`)

// 再取一次 → 已清空
const again = await (await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))).json()
ok(again.status === 'idle', '请求只发一次')

// 过期的请求不再执行
writeFileSync(PENDING, JSON.stringify({ folder, token: 'old', at: Date.now() - 10 * 60_000 }))
await sleep(1200)
const stale = await (await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))).json()
ok(stale.status === 'idle', '过期请求被丢弃')

// 非目录的路径不执行
writeFileSync(PENDING, JSON.stringify({ folder: join(folder, 'package.json'), token: 'file', at: Date.now() }))
await sleep(1200)
const notFolder = await (await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))).json()
ok(notFolder.status === 'idle', 'folder 指向文件的请求被丢弃')

// 文件右键：folder + file 一起透传
const target = join(folder, 'package.json')
writeFileSync(PENDING, JSON.stringify({ folder, file: target, token: 'with-file', at: Date.now() }))
await sleep(1200)
const withFile = await (await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))).json()
ok(withFile.status === 'open' && withFile.requests[0]?.file === target, `文件请求透传 (${JSON.stringify(withFile.requests[0])})`)

// 文件已不存在 → 只打开文件夹，不带引用
writeFileSync(PENDING, JSON.stringify({ folder, file: join(folder, 'no-such-file.txt'), token: 'gone', at: Date.now() }))
await sleep(1200)
const gone = await (await registered.resource(new Request('http://127.0.0.1/api/plugins/dsh-open-with/request', { headers: { 'x-dsh-open-with': '1' } }))).json()
ok(gone.status === 'open' && gone.requests[0]?.file === undefined, `不存在的文件被忽略 (${JSON.stringify(gone.requests[0])})`)

// 关闭插件 → 注册表键消失
for (const dispose of disposers.reverse()) dispose()
await sleep(1500)
const { isLegacyInstalled } = await import('../lib/registry.js')
ok(!(await isLegacyInstalled()), '关闭后注册表键已移除')
ok(registered === undefined, '关闭后接口已注销')

console.log('DONE')
process.exit(0)
